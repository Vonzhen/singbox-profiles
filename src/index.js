/**
 * sing-box 设计院自动化中枢
 * 首席绘图员：您的私人助理
 */

// --- 【设计院标准库：区域关键字】 ---
// 老板，如果您发现某个项目的节点名字比较奇葩（比如叫 "HK-极速"），
// 您就在下面对应的区域里加上关键字，大脑就能自动识别并归类。
const REGION_KEYWORDS = {
  "HK": ["HK", "香港", "HONGKONG", "HKG", "KONG"],
  "TW": ["TW", "台湾", "TAIWAN", "ROC", "台北"],
  "SG": ["SG", "新加坡", "SINGAPORE", "SIN", "狮城"],
  "JP": ["JP", "日本", "JAPAN", "TOKYO", "OSAKA", "东京", "大阪"],
  "US": ["US", "美国", "AMERICA", "LAX", "SFO", "SEA"]
};

const FLAG_MAP = { "HK": "🇭🇰", "SG": "🇸🇬", "JP": "🇯🇵", "US": "🇺🇸", "TW": "🇹🇼" };
const BANNED_KEYWORDS = /过期|剩余|网址|官网|流量|到期|重置|有效|套餐|群组|通知|地址|购买|维护/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientToken = url.searchParams.get("token");

    // --- 0. 行政准入核验 ---
    if (!env.AUTH_TOKEN || clientToken !== env.AUTH_TOKEN) {
      return new Response("Unauthorized Project Access", { status: 401 });
    }

    try {
      // --- 1. 调取档案室私密图纸 ---
      const githubUrl = `https://raw.githubusercontent.com/${env.GITHUB_USER}/${env.REPO_NAME}/${env.BRANCH || 'main'}/profiles/main-profile.json`;
      const configRes = await fetch(`${githubUrl}?t=${Date.now()}`, {
        headers: { 
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "Design-Institute-Engine"
        }
      });
      if (!configRes.ok) throw new Error("档案室图纸拉取失败，请检查环境变量。");
      let config = await configRes.json();

      // --- 2. 动态识别项目物资 (SUB_LINK_X) ---
      const projectConfigs = Object.keys(env)
        .filter(k => k.startsWith("SUB_LINK_"))
        .map(k => ({ name: k.replace("SUB_LINK_", ""), url: env[k] }));

      const projectMap = new Map();
      const allRealNodes = [];

      await Promise.all(projectConfigs.map(async (p) => {
        try {
          const subUrl = p.url.includes('?') ? `${p.url}&t=${Date.now()}` : `${p.url}?t=${Date.now()}`;
          const res = await fetch(subUrl, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (Clash)" } });
          const data = await res.json();
          let nodes = (Array.isArray(data) ? data : (data.outbounds || []));

          // 核心质检：过滤高倍率和杂质建材
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
          }
        } catch (e) { console.error(`项目 ${p.name} 供货异常`); }
      }));

      // --- 3. 生成精锐分包商组 (urltest) ---
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
              tag: groupTag, type: "urltest",
              outbounds: [...new Set(matchedTags)],
              url: "https://www.gstatic.com/generate_204", interval: "3m", tolerance: 150
            });
            regionalGroupsMap[reg].push(groupTag);
          }
        });
      }

      // --- 4. 【核心定制：景观动态注入算法】 ---
      const allGeneratedRegionalTags = Object.values(regionalGroupsMap).flat();

      config.outbounds = config.outbounds.map(group => {
        const t = group.tag;
        if (group.type !== "selector") return group;

        /**
         * 🎨 老板私人定制区：景观准入红线
         * 您可以根据需求，在这里精准指定每个“样板间”能看到哪些景观组。
         */
        let keys = ["🗽 节点选择"]; // 极致秩序：所有房间默认第一位都是总控

        if (t === "🗽 节点选择") {
          // 总控大厅：精选分包商组 + 零散节点
          const others = allRealNodes.filter(n => 
            !Object.values(REGION_KEYWORDS).flat().some(k => n.tag.toUpperCase().includes(k))
          ).map(n => n.tag);
          keys = [...allGeneratedRegionalTags, ...new Set(others)];
        } 
        else if (t === "🦚 PeacockTV" || t === "🅾️ OpenAI") {
          // 商务与美剧项目：只看美国景观
          keys.push(...regionalGroupsMap["US"]);
        }
        else if (t === "🌀 Hamivideo") {
          // 台湾专项项目：只看台湾景观
          keys.push(...regionalGroupsMap["TW"]);
        }
        else if (t === "📹️ Viu") {
          // 香港专项项目：只看香港景观
          keys.push(...regionalGroupsMap["HK"]);
        }
        else if (t === "🎞 Emby") {
          // 影音联动项目：直连 + 亚美精选区域
          keys.push("🎯 全球直连", ...regionalGroupsMap["HK"], ...regionalGroupsMap["SG"], ...regionalGroupsMap["US"]);
        }
        else if (t === "🍎 Apple" || t === "🐧 Tencent") {
          // 兼容项目：增加直连保障
          keys.push("🎯 全球直连");
        }
        else if (["🐟 漏网之鱼", "🌐 GLOBAL"].includes(t)) {
          // 兜底项目：保持绝对简洁，只留总调令
        }
        else {
          // 通用项目 (如 Netflix, YouTube)：五大区景观全数进驻
          keys.push(...allGeneratedRegionalTags);
        }

        group.outbounds = [...new Set(keys)];
        return group;
      });

      // --- 5. 最终交付与缓存管理 ---
      const seen = new Set();
      const uniqueNodes = allRealNodes.filter(n => !seen.has(n.tag) && seen.add(n.tag));
      config.outbounds = [...config.outbounds.filter(o => o.type), ...dynamicGroups, ...uniqueNodes];

      return new Response(JSON.stringify(config, null, 2), {
        headers: { 
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate"
        }
      });

    } catch (e) {
      return new Response(`Generator Error: ${e.message}`, { status: 500 });
    }
  }
};
