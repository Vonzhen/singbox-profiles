/**
 * src/engine.js
 * 无状态配置生成与动态调度引擎
 * 接收网关解耦数据，执行节点清洗、分类与配置重组
 */

// ==========================================
// 1. 核心规则解析模块 (保持原版逻辑)
// ==========================================

/**
 * 解析模板中 selector 的 x_rule 字段
 * @param {string} ruleStr - 例如 "region+direct:HK,SG"
 */
function parseRule(ruleStr) {
  if (!ruleStr) return null;

  const [action, detail] = ruleStr.split(':');
  const regions = detail ? detail.split(',').map(r => r.trim()) : [];
  
  const isDirectIncluded = action.includes('+direct');
  const baseMode = action.replace('+direct', '');

  return {
    mode: baseMode,        // "main", "region", "all_regions", "direct_only", "keep"
    regions: regions,      // ["HK", "SG"]
    includeDirect: isDirectIncluded // boolean
  };
}

/**
 * 配置引用合法性校验，剔除不存在的出站 tag 引用
 * @param {Object} config - 最终生成的 sing-box 配置对象
 */
function validateReferences(config) {
  const validTags = new Set();
  
  // 1. 收集所有已注册的出站 Tag
  if (Array.isArray(config.outbounds)) {
    config.outbounds.forEach(o => validTags.add(o.tag));
  }

  // 2. 校验 Outbounds 内部的引用
  config.outbounds.forEach(o => {
    if (Array.isArray(o.outbounds)) {
      o.outbounds = o.outbounds.filter(tag => {
        const isValid = validTags.has(tag);
        if (!isValid) console.warn(`[Validate] 剔除无效的出站引用: [${o.tag}] -> "${tag}"`);
        return isValid;
      });
    }
  });

  // 3. 校验 DNS Detour 的引用
  if (config.dns && Array.isArray(config.dns.servers)) {
    config.dns.servers.forEach(s => {
      if (s.detour && !validTags.has(s.detour)) {
        console.warn(`[Validate] 剔除无效 的 DNS 路由引用: [${s.tag}] -> "${s.detour}"`);
        delete s.detour;
      }
    });
  }
}

// ==========================================
// 2. 主引擎执行逻辑 (对接多用户数据流)
// ==========================================

/**
 * 核心配置装配引擎
 * @param {Array} userSubLinks - 当前发起请求用户专属的机场订阅数组
 * @param {Object} globalConfig - 系统全局策略及底座模板
 * @param {boolean} isDebug - 是否开启调试日志模式
 */
export async function generateConfig(userSubLinks, globalConfig, isDebug) {
  try {
    const debugLogs = [];
    const log = (msg) => { if (isDebug) { console.log(msg); debugLogs.push(msg); } };

    log("--- 启动配置生成引擎 (多用户解耦版) ---");

    // 1. 提取并深拷贝全局底座模板，防止内存污染
    if (!globalConfig.TEMPLATE_JSON || Object.keys(globalConfig.TEMPLATE_JSON).length === 0) {
      throw new Error("全局底座模板为空，请先在所有者面板中配置核心规则模板。");
    }
    let config = JSON.parse(JSON.stringify(globalConfig.TEMPLATE_JSON));

    // 2. 提取全局常量与配置
    const REGION_KEYWORDS = globalConfig.REGION_KEYWORDS || {};
    const FLAG_MAP = { "HK": "🇭🇰", "SG": "🇸🇬", "JP": "🇯🇵", "US": "🇺🇸", "TW": "🇹🇼" };
    const BANNED_REGEXP = new RegExp(globalConfig.BANNED_KEYWORDS || "过期|剩余|网址|官网", "i");
    const URLTEST_PARAMS = globalConfig.URLTEST_PARAMS || { url: "https://www.gstatic.com/generate_204", interval: "3m", tolerance: 150 };

    // 3. 过滤当前用户启用的机场节点
    const activeConfigs = (userSubLinks || []).filter(p => p.enabled && p.url);
    const projectMap = new Map();
    const allRealNodes = [];

    log(`[上下文初始化] 当前用户激活订阅源数量: ${activeConfigs.length}`);

    // 4. 并发拉取并清洗单节点数据
    await Promise.all(activeConfigs.map(async (p) => {
      try {
        const subUrl = p.url.includes('?') ? `${p.url}&t=${Date.now()}` : `${p.url}?t=${Date.now()}`;
        const res = await fetch(subUrl, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (Clash)" } });
        if (!res.ok) throw new Error(`HTTP 状态码异常: ${res.status}`);
        
        const data = await res.json();
        let nodes = (Array.isArray(data) ? data : (data.outbounds || []));

        // 4.1 强类型修复：处理 Reality 协议中纯数字指纹等潜在类型报错
        nodes = nodes.map(n => {
          if (n.tls?.utls?.fingerprint !== undefined) {
            n.tls.utls.fingerprint = String(n.tls.utls.fingerprint);
          }
          if (n.tls?.reality?.short_id !== undefined) {
            n.tls.reality.short_id = String(n.tls.reality.short_id);
          }
          return n;
        });

        // 4.2 节点基础质检：剔除高倍率与匹配黑名单的广告、失效节点
        nodes = nodes.filter(n => {
          const tag = n.tag || "";
          const isHighRate = /(?:[1-9]\.[1-9]|[2-9]\.\d+)x/i.test(tag);
          const isAds = BANNED_REGEXP.test(tag);
          const isRealNode = n.type && !["selector", "urltest", "direct", "block", "dns"].includes(n.type);
          return !isHighRate && !isAds && isRealNode;
        });

        if (nodes.length > 0) {
          projectMap.set(p.name, nodes);
          allRealNodes.push(...nodes);
          log(`[节点加载] 订阅源 [${p.name}]: 成功加载 ${nodes.length} 个干净节点`);
        }
      } catch (e) {
        log(`[节点加载] 订阅源 [${p.name}] 数据拉取异常: ${e.message}`);
      }
    }));

    // 5. 按订阅源及区域构建自动化策略组 (urltest)
    const dynamicGroups = [];
    const regionalGroupsMap = {};
    Object.keys(REGION_KEYWORDS).forEach(reg => { regionalGroupsMap[reg] = []; });

    for (const [pName, nodes] of projectMap) {
      Object.keys(REGION_KEYWORDS).forEach(reg => {
        const matchedTags = nodes.filter(n => {
          const tagUpper = n.tag.toUpperCase();
          return REGION_KEYWORDS[reg].some(kw => tagUpper.includes(kw));
        }).map(n => n.tag);

        if (matchedTags.length > 0) {
          const groupTag = `${FLAG_MAP[reg] || ''} ${reg}-${pName}`.trim();
          dynamicGroups.push({
            tag: groupTag, 
            type: "urltest",
            outbounds: [...new Set(matchedTags)],
            url: URLTEST_PARAMS.url, 
            interval: URLTEST_PARAMS.interval, 
            tolerance: URLTEST_PARAMS.tolerance,
            interrupt_exist_connections: true
          });
          regionalGroupsMap[reg].push(groupTag);
        }
      });
    }

    log(`[策略构建] 已动态组装 ${dynamicGroups.length} 个区域级 urltest 分组`);

    // 6. 模板驱动注入逻辑 (处理 config.outbounds 占位符)
    const allGeneratedRegionalTags = Object.values(regionalGroupsMap).flat();

    if (Array.isArray(config.outbounds)) {
      config.outbounds = config.outbounds.map(group => {
        if (group.type !== "selector") return group;

        const ruleStr = group.x_rule;
        const rule = parseRule(ruleStr);
        let keys = ["🗽 节点选择"]; // 默认回退基准

        // 6.1 兼容性回退机制 (未配置 x_rule 时的逻辑)
        if (!rule) {
          const t = group.tag;
          if (t === "🗽 节点选择") {
            const others = allRealNodes.filter(n => 
              !Object.values(REGION_KEYWORDS).flat().some(k => n.tag.toUpperCase().includes(k))
            ).map(n => n.tag);
            keys = [...allGeneratedRegionalTags, ...new Set(others)];
          } 
          else if (t === "🦚 PeacockTV" || t === "🅾️ OpenAI") keys.push(...(regionalGroupsMap["US"] || []));
          else if (t === "🌀 Hamivideo") keys.push(...(regionalGroupsMap["TW"] || []));
          else if (t === "📹️ Viu") keys.push(...(regionalGroupsMap["HK"] || []));
          else if (t === "🎞 Emby") keys.push("🎯 全球直连", ...(regionalGroupsMap["HK"] || []), ...(regionalGroupsMap["SG"] || []), ...(regionalGroupsMap["US"] || []));
          else if (t === "🍎 Apple" || t === "🐧 Tencent") keys.push("🎯 全球直连");
          else if (["🐟 漏网之鱼", "🌐 GLOBAL"].includes(t)) { /* 保持原样 */ }
          else keys.push(...allGeneratedRegionalTags);
        } 
        // 6.2 模板声明规则执行
        else {
          switch (rule.mode) {
            case 'keep': 
              delete group.x_rule; 
              return group;

            case 'direct_only': 
              keys = ["🎯 全球直连"]; 
              break;

            case 'region':
              if (rule.includeDirect) keys.push("🎯 全球直连");
              rule.regions.forEach(r => { 
                if (regionalGroupsMap[r]) keys.push(...regionalGroupsMap[r]); 
              });
              break;

            case 'main':
              const others = allRealNodes.filter(n => 
                !Object.values(REGION_KEYWORDS).flat().some(k => n.tag.toUpperCase().includes(k))
              ).map(n => n.tag);
              keys = [...allGeneratedRegionalTags, ...new Set(others)];
              break;

            case 'all_regions':
            default:
              keys.push(...allGeneratedRegionalTags);
              break;
          }
        }

        // 清理引擎字段，防止客户端解析崩溃
        if (group.x_rule) delete group.x_rule;
        
        group.outbounds = [...new Set(keys)];
        return group;
      });
    }

    // 7. 最终物理合并与去重
    const seen = new Set();
    const uniqueNodes = allRealNodes.filter(n => !seen.has(n.tag) && seen.add(n.tag));
    
    config.outbounds = [
      ...(config.outbounds || []).filter(o => o.type), 
      ...dynamicGroups, 
      ...uniqueNodes
    ];

    // 8. 闭环指针合法性校验
    validateReferences(config);

    // 9. 编译响应格式化输出
    if (isDebug) {
      return new Response(JSON.stringify({ logs: debugLogs, config: config }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    return new Response(JSON.stringify(config, null, 2), {
      headers: { 
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });

  } catch (e) {
    return new Response(`Generator Engine Error: ${e.message}`, { status: 500 });
  }
}
