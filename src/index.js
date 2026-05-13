/**
 * sing-box 配置生成与动态调度引擎 (Template-Driven 版)
 * 特性：模板声明驱动、强类型校验、自动节点归类、无效引用清理
 */

// ==========================================
// [常量配置区]
// ==========================================

// 区域匹配关键字字典
const REGION_KEYWORDS = {
  "HK": ["HK", "香港", "HONGKONG", "HKG", "KONG"],
  "TW": ["TW", "台湾", "TAIWAN", "ROC", "台北"],
  "SG": ["SG", "新加坡", "SINGAPORE", "SIN", "狮城"],
  "JP": ["JP", "日本", "JAPAN", "TOKYO", "OSAKA", "东京", "大阪"],
  "US": ["US", "美国", "AMERICA", "LAX", "SFO", "United States"]
};

// 区域旗帜映射
const FLAG_MAP = { "HK": "🇭🇰", "SG": "🇸🇬", "JP": "🇯🇵", "US": "🇺🇸", "TW": "🇹🇼" };

// 杂质节点过滤正则
const BANNED_KEYWORDS = /过期|剩余|网址|官网|流量|到期|重置|有效|套餐|群组|通知|地址|购买|维护/i;

// ==========================================
// [核心功能模块]
// ==========================================

/**
 * 模块 A：轻量规则解析器
 * 负责解析模板中 selector 的 x_rule 字段
 * @param {string} ruleStr - 例如 "region+direct:HK,SG"
 * @returns {Object} 解析后的规则对象
 */
function parseRule(ruleStr) {
  if (!ruleStr) return null; // 返回 null 触发兼容性回退逻辑

  const [action, detail] = ruleStr.split(':');
  const regions = detail ? detail.split(',').map(r => r.trim()) : [];
  
  const isDirectIncluded = action.includes('+direct');
  const baseMode = action.replace('+direct', '');

  return {
    mode: baseMode,       // "main", "region", "all_regions", "direct_only", "keep"
    regions: regions,     // ["HK", "SG"]
    includeDirect: isDirectIncluded // boolean
  };
}

/**
 * 模块 B：配置引用合法性校验
 * 剔除 config 中不存在的 tag 引用，防止客户端启动崩溃
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
        console.warn(`[Validate] 剔除无效的 DNS 路由引用: [${s.tag}] -> "${s.detour}"`);
        delete s.detour;
      }
    });
  }
}

// ==========================================
// [主执行流程]
// ==========================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientToken = url.searchParams.get("token");
    const isDebug = url.searchParams.get("debug") === "1";

    // 0. 基础权限校验
    if (!env.AUTH_TOKEN || clientToken !== env.AUTH_TOKEN) {
      return new Response("Unauthorized Access", { status: 401 });
    }

    try {
      const debugLogs = [];
      const log = (msg) => { if (isDebug) { console.log(msg); debugLogs.push(msg); } };

      log("--- 启动配置生成引擎 ---");

      // 1. 获取远程模板 (main-profile.json)
      const githubUrl = `https://raw.githubusercontent.com/${env.GITHUB_USER}/${env.REPO_NAME}/${env.BRANCH || 'master'}/profiles/main-profile.json`;
      const configRes = await fetch(`${githubUrl}?t=${Date.now()}`, {
        headers: { 
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "SingBox-Config-Builder"
        }
      });
      if (!configRes.ok) throw new Error("远程模板拉取失败，请检查 GITHUB_TOKEN 配置。");
      let config = await configRes.json();

      // 2. 收集环境变量中的订阅链接
      const projectConfigs = Object.keys(env)
        .filter(k => k.startsWith("SUB_LINK_"))
        .map(k => ({ name: k.replace("SUB_LINK_", ""), url: env[k] }));

      const projectMap = new Map();
      const allRealNodes = [];

      // 3. 并发拉取并清洗节点数据
      await Promise.all(projectConfigs.map(async (p) => {
        try {
          const subUrl = p.url.includes('?') ? `${p.url}&t=${Date.now()}` : `${p.url}?t=${Date.now()}`;
          const res = await fetch(subUrl, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (Clash)" } });
          const data = await res.json();
          let nodes = (Array.isArray(data) ? data : (data.outbounds || []));

          // 3.1 强类型修复：处理 Go 语言强类型限制 (解决 Reality 协议中纯数字指纹报错)
          nodes = nodes.map(n => {
            if (n.tls?.utls?.fingerprint !== undefined) {
              n.tls.utls.fingerprint = String(n.tls.utls.fingerprint);
            }
            if (n.tls?.reality?.short_id !== undefined) {
              n.tls.reality.short_id = String(n.tls.reality.short_id);
            }
            return n;
          });

          // 3.2 节点基础质检：剔除高倍率与广告节点
          nodes = nodes.filter(n => {
            const tag = n.tag || "";
            const isHighRate = /(?:[1-9]\.[1-9]|[2-9]\.\d+)x/i.test(tag);
            const isAds = BANNED_KEYWORDS.test(tag);
            const isRealNode = n.type && !["selector", "urltest", "direct", "block", "dns"].includes(n.type);
            return !isHighRate && !isAds && isRealNode;
          });

          if (nodes.length > 0) {
            projectMap.set(p.name, nodes);
            allRealNodes.push(...nodes);
            log(`[节点加载] 机场 [${p.name}]: 成功加载 ${nodes.length} 个节点`);
          }
        } catch (e) {
          console.error(`[节点加载] 机场 [${p.name}] 拉取异常: ${e.message}`);
        }
      }));

      // 4. 按机场及区域构建自动化策略组 (urltest)
      const dynamicGroups = [];
      const regionalGroupsMap = { "HK": [], "SG": [], "JP": [], "US": [], "TW": [] };

      for (const [pName, nodes] of projectMap) {
        Object.keys(REGION_KEYWORDS).forEach(reg => {
          const matchedTags = nodes.filter(n => {
            const tagUpper = n.tag.toUpperCase();
            return REGION_KEYWORDS[reg].some(kw => tagUpper.includes(kw));
          }).map(n => n.tag);

          if (matchedTags.length > 0) {
            const groupTag = `${FLAG_MAP[reg]} ${reg}-${pName}`;
            dynamicGroups.push({
              tag: groupTag, 
              type: "urltest",
              outbounds: [...new Set(matchedTags)],
              url: "https://www.gstatic.com/generate_204", 
              interval: "9m", 
              tolerance: 150,
              interrupt_exist_connections: true
            });
            regionalGroupsMap[reg].push(groupTag);
          }
        });
      }

      log(`[策略构建] 已生成 ${dynamicGroups.length} 个区域级 urltest 分组`);

      // 5. 模板驱动注入逻辑 (处理 config.outbounds)
      const allGeneratedRegionalTags = Object.values(regionalGroupsMap).flat();

      config.outbounds = config.outbounds.map(group => {
        if (group.type !== "selector") return group;

        const ruleStr = group.x_rule;
        const rule = parseRule(ruleStr);
        let keys = ["🗽 节点选择"]; // 默认基准策略

        // 5.1 兼容性回退机制 (Fallback)
        if (!rule) {
          log(`[注入回退] 分组 "${group.tag}" 未声明 x_rule，执行兼容性回退匹配`);
          const t = group.tag;
          if (t === "🗽 节点选择") {
            const others = allRealNodes.filter(n => 
              !Object.values(REGION_KEYWORDS).flat().some(k => n.tag.toUpperCase().includes(k))
            ).map(n => n.tag);
            keys = [...allGeneratedRegionalTags, ...new Set(others)];
          } 
          else if (t === "🦚 PeacockTV" || t === "🅾️ OpenAI") keys.push(...regionalGroupsMap["US"]);
          else if (t === "🌀 Hamivideo") keys.push(...regionalGroupsMap["TW"]);
          else if (t === "📹️ Viu") keys.push(...regionalGroupsMap["HK"]);
          else if (t === "🎞 Emby") keys.push("🎯 全球直连", ...regionalGroupsMap["HK"], ...regionalGroupsMap["SG"], ...regionalGroupsMap["US"]);
          else if (t === "🍎 Apple" || t === "🐧 Tencent") keys.push("🎯 全球直连");
          else if (["🐟 漏网之鱼", "🌐 GLOBAL"].includes(t)) { /* 保持仅含总控 */ }
          else keys.push(...allGeneratedRegionalTags);
        } 
        // 5.2 模板声明执行
        else {
          log(`[规则注入] 分组 "${group.tag}" 命中规则: ${ruleStr}`);
          switch (rule.mode) {
            case 'keep':
              delete group.x_rule;
              return group; // 不做任何修改

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

        // 清理引擎专用字段，防止客户端校验报错
        if (group.x_rule) delete group.x_rule;
        
        // 去重并更新出站集合
        group.outbounds = [...new Set(keys)];
        return group;
      });

      // 6. 最终合并配置组装
      const seen = new Set();
      const uniqueNodes = allRealNodes.filter(n => !seen.has(n.tag) && seen.add(n.tag));
      
      // 合并顺序：基础模板策略组 -> 自动生成的 urltest 分区组 -> 去重后的落地节点
      config.outbounds = [
        ...config.outbounds.filter(o => o.type), 
        ...dynamicGroups, 
        ...uniqueNodes
      ];

      // 7. 执行最终引用校验 (清理空壳及悬空指针)
      validateReferences(config);

      // 8. 响应构建
      if (isDebug) {
        return new Response(JSON.stringify({ logs: debugLogs, config: config }, null, 2), {
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }

      return new Response(JSON.stringify(config, null, 2), {
        headers: { 
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        }
      });

    } catch (e) {
      return new Response(`Generator Engine Error: ${e.message}`, { status: 500 });
    }
  }
};
