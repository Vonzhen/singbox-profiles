/**
 * src/engine.js
 * 纯正意图驱动版：保留区域二维隔离、加入授权控制网闸，执行 x_rule 注入
 */

function parseRule(ruleStr) {
  if (!ruleStr) return null;
  const [action, detail] = ruleStr.split(':');
  const regions = detail ? detail.split(',').map(r => r.trim()) : [];
  const isDirectIncluded = action.includes('+direct');
  const baseMode = action.replace('+direct', '');
  return { mode: baseMode, regions, includeDirect: isDirectIncluded };
}

function validateReferences(config) {
  const validTags = new Set();
  if (Array.isArray(config.outbounds)) {
    config.outbounds.forEach(o => validTags.add(o.tag));
  }
  config.outbounds.forEach(o => {
    if (Array.isArray(o.outbounds)) {
      o.outbounds = o.outbounds.filter(tag => {
        const isValid = validTags.has(tag);
        if (!isValid) console.warn(`[Validate] 剔除无效引用: [${o.tag}] -> "${tag}"`);
        return isValid;
      });
    }
  });
  if (config.dns && Array.isArray(config.dns.servers)) {
    config.dns.servers.forEach(s => {
      if (s.detour && !validTags.has(s.detour)) delete s.detour;
    });
  }
}

export async function generateConfig(userSubLinks, globalConfig, isDebug) {
  try {
    const debugLogs = [];
    const log = (msg) => { if (isDebug) { console.log(msg); debugLogs.push(msg); } };

    log("--- 启动配置生成引擎 (原版分离逻辑) ---");

    // ==========================================
    // 1. 获取远程模板
    // ==========================================
    const user = globalConfig.GITHUB_USER;
    const repo = globalConfig.GITHUB_REPO;
    const branch = globalConfig.GITHUB_BRANCH || 'master';
    const token = globalConfig.GITHUB_TOKEN;

    if (!user || !repo) {
      throw new Error("请先在管理面板中配妥 GitHub 仓库参数。");
    }

    const githubUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/profiles/main-profile.json`;
    log(`[GitHub] 正在连通：${githubUrl}`);

    const ghHeaders = { "User-Agent": "SingBox-Config-Builder" };
    if (token) {
      ghHeaders["Authorization"] = `token ${token}`;
      ghHeaders["Accept"] = "application/vnd.github.v3.raw";
    }

    const configRes = await fetch(`${githubUrl}?t=${Date.now()}`, { headers: ghHeaders });
    if (!configRes.ok) throw new Error(`远程骨架拉取失败: HTTP ${configRes.status}`);
    let config = await configRes.json();
    log(`[GitHub] 骨架捕获成功！`);

    // ==========================================
    // 2. 环境初始化
    // ==========================================
    const REGION_KEYWORDS = globalConfig.REGION_KEYWORDS || {};
    const FLAG_MAP = { "HK": "🇭🇰", "SG": "🇸🇬", "JP": "🇯🇵", "US": "🇺🇸", "TW": "🇹🇼" };
    const BANNED_REGEXP = new RegExp(globalConfig.BANNED_KEYWORDS || "过期|剩余|网址", "i");
    const URLTEST_PARAMS = globalConfig.URLTEST_PARAMS || { url: "https://www.gstatic.com/generate_204", interval: "3m", tolerance: 150 };

    const activeConfigs = (userSubLinks || []).filter(p => p.enabled && p.url);
    const projectMap = new Map();
    const allRealNodes = [];

    // ==========================================
    // 3. 并发拉取并清洗单节点数据
    // ==========================================
    await Promise.all(activeConfigs.map(async (p) => {
      try {
        const subUrl = p.url.includes('?') ? `${p.url}&t=${Date.now()}` : `${p.url}?t=${Date.now()}`;
        // 注意：移除了 cache: "no-store" 防报错
        const res = await fetch(subUrl, { headers: { "User-Agent": "Mozilla/5.0 (Clash)" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        let nodes = (Array.isArray(data) ? data : (data.outbounds || []));

        nodes = nodes.map(n => {
          if (n.tls?.utls?.fingerprint !== undefined) n.tls.utls.fingerprint = String(n.tls.utls.fingerprint);
          if (n.tls?.reality?.short_id !== undefined) n.tls.reality.short_id = String(n.tls.reality.short_id);
          return n;
        });

        nodes = nodes.filter(n => {
          const tag = n.tag || "";
          const isHighRate = /(?:[1-9]\.[1-9]|[2-9]\.\d+)x/i.test(tag);
          const isAds = BANNED_REGEXP.test(tag);
          const isRealNode = n.type && !["selector", "urltest", "direct", "block", "dns"].includes(n.type);
          return !isHighRate && !isAds && isRealNode;
        });

        if (nodes.length > 0) {
          // 保存节点，并绑定该机场 UI 上授权的引流区域 (兼容旧数据)
          const allowed = p.allowed_regions || Object.keys(REGION_KEYWORDS);
          projectMap.set(p.name, { nodes, allowed_regions: allowed });
          allRealNodes.push(...nodes);
          log(`[节点加载] 机场 [${p.name}]: 加载 ${nodes.length} 个干净节点。`);
        }
      } catch (e) {
        log(`[节点加载] 机场 [${p.name}] 异常: ${e.message}`);
      }
    }));

    // ==========================================
    // 4. 按机场及区域构建自动化策略组 (原汁原味二维隔离)
    // ==========================================
    const dynamicGroups = [];
    const regionalGroupsMap = {};
    Object.keys(REGION_KEYWORDS).forEach(reg => { regionalGroupsMap[reg] = []; });

    for (const [pName, pData] of projectMap) {
      const { nodes, allowed_regions } = pData;
      
      Object.keys(REGION_KEYWORDS).forEach(reg => {
        // 核心网闸补丁：如果当前区域不在该机场的 UI 授权名单里，彻底拦截它！
        if (!allowed_regions.includes(reg)) {
          return;
        }

        const matchedTags = nodes.filter(n => {
          const tagUpper = n.tag.toUpperCase();
          return REGION_KEYWORDS[reg].some(kw => tagUpper.includes(kw));
        }).map(n => n.tag);

        if (matchedTags.length > 0) {
          // 命名严格回归原版，如: 🇭🇰 HK-机场名
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

    log(`[策略构建] 已生成 ${dynamicGroups.length} 个独立的机场级区域 urltest 分组`);

    // ==========================================
    // 5. 模板驱动注入逻辑 (处理 x_rule，完全镜像原版)
    // ==========================================
    const allGeneratedRegionalTags = Object.values(regionalGroupsMap).flat();

    if (Array.isArray(config.outbounds)) {
      config.outbounds = config.outbounds.map(group => {
        if (group.type !== "selector") return group;

        const ruleStr = group.x_rule;
        const rule = parseRule(ruleStr);
        let keys = ["🗽 节点选择"];

        if (!rule) {
          log(`[注入回退] 分组 "${group.tag}" 执行兼容性回退`);
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
          else if (["🐟 漏网之鱼", "🌐 GLOBAL"].includes(t)) { /* 保持仅含总控 */ }
          else keys.push(...allGeneratedRegionalTags);
        } else {
          log(`[规则注入] 分组 "${group.tag}" 命中规则: ${ruleStr}`);
          switch (rule.mode) {
            case 'keep': delete group.x_rule; return group;
            case 'direct_only': keys = ["🎯 全球直连"]; break;
            case 'region':
              if (rule.includeDirect) keys.push("🎯 全球直连");
              rule.regions.forEach(r => { if (regionalGroupsMap[r]) keys.push(...regionalGroupsMap[r]); });
              break;
            case 'main':
              const others = allRealNodes.filter(n => 
                !Object.values(REGION_KEYWORDS).flat().some(k => n.tag.toUpperCase().includes(k))
              ).map(n => n.tag);
              keys = [...allGeneratedRegionalTags, ...new Set(others)];
              break;
            case 'all_regions':
            default: keys.push(...allGeneratedRegionalTags); break;
          }
        }

        if (group.x_rule) delete group.x_rule;
        group.outbounds = [...new Set(keys)];
        return group;
      });
    }

    // ==========================================
    // 6. 最终合并配置组装
    // ==========================================
    const seen = new Set();
    const uniqueNodes = allRealNodes.filter(n => !seen.has(n.tag) && seen.add(n.tag));
    
    config.outbounds = [
      ...(config.outbounds || []).filter(o => o.type), 
      ...dynamicGroups, 
      ...uniqueNodes
    ];

    validateReferences(config);

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
    return new Response(JSON.stringify({ error: e.message, logs: [e.message] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
