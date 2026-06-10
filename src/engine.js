// ==========================================
// [核心功能模块] (保持你的原样，不做任何逻辑修改)
// ==========================================
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
  if (Array.isArray(config.outbounds)) config.outbounds.forEach(o => validTags.add(o.tag));
  config.outbounds.forEach(o => {
    if (Array.isArray(o.outbounds)) {
      o.outbounds = o.outbounds.filter(tag => validTags.has(tag));
    }
  });
  if (config.dns && Array.isArray(config.dns.servers)) {
    config.dns.servers.forEach(s => {
      if (s.detour && !validTags.has(s.detour)) delete s.detour;
    });
  }
}

// ==========================================
// [主执行流程导出]
// ==========================================
export async function generateConfig(env, clientToken, isDebug) {
  try {
    const debugLogs = [];
    const log = (msg) => { if (isDebug) { console.log(msg); debugLogs.push(msg); } };

    // --- 【改变点 1】：从云端 KV 拉取唯一的真理配置 ---
    let settings = await env.DB.get("app_settings", { type: "json" });
    if (!settings) throw new Error("KV 存储中没有配置数据，请先访问主页进行初始化保存。");

    // 权限校验 (使用 KV 里的 AUTH_TOKEN)
    if (!settings.AUTH_TOKEN || clientToken !== settings.AUTH_TOKEN) {
      return new Response("Unauthorized Access", { status: 401 });
    }

    // 从 KV 加载动态常量
    const REGION_KEYWORDS = settings.REGION_KEYWORDS || {
      "HK": ["HK", "香港", "HONGKONG"], "TW": ["TW", "台湾", "TAIWAN"], 
      "SG": ["SG", "新加坡", "SINGAPORE"], "JP": ["JP", "日本", "JAPAN"], "US": ["US", "美国", "AMERICA"]
    };
    const FLAG_MAP = { "HK": "🇭🇰", "SG": "🇸🇬", "JP": "🇯🇵", "US": "🇺🇸", "TW": "🇹🇼" };
    const BANNED_REGEXP = new RegExp(settings.BANNED_KEYWORDS || "过期|剩余|网址|官网|流量", "i");

    log("--- 启动配置生成引擎 (基于 KV 动态配置) ---");

    // --- 【改变点 2】：利用 KV 里的 GitHub 凭证拉取大脑模板 ---
    const gh = settings.GITHUB;
    const githubUrl = `https://raw.githubusercontent.com/${gh.USER}/${gh.REPO}/${gh.BRANCH}/profiles/main-profile.json`;
    const configRes = await fetch(`${githubUrl}?t=${Date.now()}`, {
      headers: { 
        "Authorization": `token ${gh.TOKEN}`,
        "Accept": "application/vnd.github.v3.raw",
        "User-Agent": "SingBox-Config-Builder"
      }
    });
    if (!configRes.ok) throw new Error("远程模板拉取失败，请检查 GitHub 配置。");
    let config = await configRes.json();

    // --- 【改变点 3】：利用 KV 里的 Sub-Store 列表并发拉取 ---
    // 只过滤出 enabled 为 true 的机场
    const projectConfigs = (settings.SUB_LINKS || []).filter(p => p.enabled);
    const projectMap = new Map();
    const allRealNodes = [];

    // ===== 👇 以下逻辑完全继承你的原版代码，未做删减 👇 =====
    await Promise.all(projectConfigs.map(async (p) => {
      try {
        const subUrl = p.url.includes('?') ? `${p.url}&t=${Date.now()}` : `${p.url}?t=${Date.now()}`;
        const res = await fetch(subUrl, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (Clash)" } });
        const data = await res.json();
        let nodes = (Array.isArray(data) ? data : (data.outbounds || []));

        // 3.1 强类型修复
        nodes = nodes.map(n => {
          if (n.tls?.utls?.fingerprint !== undefined) n.tls.utls.fingerprint = String(n.tls.utls.fingerprint);
          if (n.tls?.reality?.short_id !== undefined) n.tls.reality.short_id = String(n.tls.reality.short_id);
          return n;
        });

        // 3.2 节点基础质检 (使用动态 BANNED_REGEXP)
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
          log(`[节点加载] 机场 [${p.name}]: 成功加载 ${nodes.length} 个节点`);
        }
      } catch (e) {
        log(`[节点加载] 机场 [${p.name}] 拉取异常: ${e.message}`);
      }
    }));

    // 4. 按机场及区域构建自动化策略组 (urltest)
    const dynamicGroups = [];
    const regionalGroupsMap = {};
    Object.keys(REGION_KEYWORDS).forEach(reg => regionalGroupsMap[reg] = []);

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
            url: settings.URLTEST_PARAMS?.url || "https://www.gstatic.com/generate_204", 
            interval: settings.URLTEST_PARAMS?.interval || "3m", 
            tolerance: settings.URLTEST_PARAMS?.tolerance || 150,
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

      if (!rule) {
        // 5.1 兼容性回退机制
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
        else if (t === "🎞 Emby") keys.push("🎯 全球直连", ...(regionalGroupsMap["HK"]||[]), ...(regionalGroupsMap["SG"]||[]), ...(regionalGroupsMap["US"]||[]));
        else if (t === "🍎 Apple" || t === "🐧 Tencent") keys.push("🎯 全球直连");
        else if (["🐟 漏网之鱼", "🌐 GLOBAL"].includes(t)) { /* 空 */ }
        else keys.push(...allGeneratedRegionalTags);
      } else {
        // 5.2 模板声明执行
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
          default:
            keys.push(...allGeneratedRegionalTags);
            break;
        }
      }

      if (group.x_rule) delete group.x_rule;
      group.outbounds = [...new Set(keys)];
      return group;
    });

    // 6. 最终合并配置组装
    const seen = new Set();
    const uniqueNodes = allRealNodes.filter(n => !seen.has(n.tag) && seen.add(n.tag));
    config.outbounds = [
      ...config.outbounds.filter(o => o.type), 
      ...dynamicGroups, 
      ...uniqueNodes
    ];

    // 7. 执行最终引用校验
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
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });

  } catch (e) {
    return new Response(`Generator Engine Error: ${e.message}`, { status: 500 });
  }
}
