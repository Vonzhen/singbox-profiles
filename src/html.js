export function renderHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>皇家设计院 · 三合一云端中枢</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
  <style>
    body { background-color: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; }
    .panel { background-color: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .input-box { background-color: #0f172a; border: 1px solid #334155; color: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 0.5rem; width: 100%; outline: none; transition: border-color 0.2s; }
    .input-box:focus { border-color: #3b82f6; }
    .btn-primary { background-color: #3b82f6; color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 500; transition: background-color 0.2s; cursor: pointer; }
    .btn-primary:hover { background-color: #2563eb; }
    .btn-danger { background-color: #ef4444; color: white; padding: 0.25rem 0.75rem; border-radius: 0.5rem; font-size: 0.875rem; cursor: pointer; }
    .btn-danger:hover { background-color: #dc2626; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #64748b; }
  </style>
</head>
<body>
  <div id="app" class="max-w-5xl mx-auto py-8 px-4" v-cloak>
    
    <header class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          🏛️ 皇家设计院 <span class="text-xl font-normal text-blue-400">| 云端控制中枢</span>
        </h1>
        <p class="text-slate-400 mt-2 text-sm">Sing-Box 配置生成与动态调度引擎 (可视化版)</p>
      </div>
      <button @click="saveSettings" :disabled="saving" class="btn-primary flex items-center gap-2">
        <span v-if="saving">⏳ 同步中...</span>
        <span v-else>💾 保存至边缘 KV</span>
      </button>
    </header>

    <div class="panel">
      <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 flex items-center gap-2">🔑 核心凭证与大脑源</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-slate-400 mb-1">系统管理员密钥 (AUTH_TOKEN)</label>
          <input type="password" v-model="config.AUTH_TOKEN" class="input-box" placeholder="用于客户端拉取订阅的 Token">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">GitHub 仓库分支 (Branch)</label>
          <input type="text" v-model="config.GITHUB.BRANCH" class="input-box" placeholder="如: master">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">GitHub 用户名 (User)</label>
          <input type="text" v-model="config.GITHUB.USER" class="input-box" placeholder="你的 GitHub ID">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">GitHub 仓库名 (Repo)</label>
          <input type="text" v-model="config.GITHUB.REPO" class="input-box" placeholder="如: singbox-profiles">
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm text-slate-400 mb-1">GitHub 访问令牌 (Token - 私有仓必备)</label>
          <input type="password" v-model="config.GITHUB.TOKEN" class="input-box" placeholder="ghp_xxxxxxxxxxxx">
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
        <h2 class="text-xl font-semibold flex items-center gap-2">✈️ Sub-Store 机场阵列</h2>
        <button @click="addAirport" class="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white">+ 添加机场</button>
      </div>
      
      <div v-if="config.SUB_LINKS.length === 0" class="text-center text-slate-500 py-4">
        暂无机场配置，请点击右上角添加。
      </div>
      
      <div v-for="(port, index) in config.SUB_LINKS" :key="index" class="flex flex-wrap md:flex-nowrap items-center gap-3 bg-slate-800 p-3 rounded mb-2 border border-slate-700">
        <div class="w-full md:w-32">
          <input type="text" v-model="port.name" class="input-box text-sm" placeholder="机场简称 (如: YToo)">
        </div>
        <div class="flex-grow w-full">
          <input type="text" v-model="port.url" class="input-box text-sm font-mono" placeholder="Sub-Store 订阅直链">
        </div>
        <div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end mt-2 md:mt-0">
          <label class="flex items-center cursor-pointer gap-2 text-sm">
            <input type="checkbox" v-model="port.enabled" class="w-4 h-4 text-blue-600 bg-slate-900 border-slate-600 rounded focus:ring-blue-500">
            <span :class="port.enabled ? 'text-green-400' : 'text-slate-500'">启航</span>
          </label>
          <button @click="removeAirport(index)" class="btn-danger">拆除</button>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="panel h-full mb-0">
        <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 flex items-center gap-2">🌍 区域路由匹配字典</h2>
        <p class="text-xs text-slate-400 mb-4">用英文逗号分隔匹配关键字，引擎会自动为这些地区建立 UrlTest 策略组。</p>
        
        <div class="space-y-3">
          <div v-for="(keywords, reg) in regionStr" :key="reg" class="flex flex-col">
            <label class="text-sm font-medium text-slate-300 mb-1 flex items-center gap-2">
              <span class="w-8">{{ getFlag(reg) }} {{ reg }}</span>
            </label>
            <input type="text" v-model="regionStr[reg]" class="input-box text-sm font-mono" placeholder="关键字1, 关键字2...">
          </div>
        </div>
      </div>

      <div class="panel h-full mb-0">
        <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 flex items-center gap-2">🛡️ 规则与调度微调</h2>
        
        <div class="mb-5">
          <label class="block text-sm text-slate-400 mb-1">杂质节点清洗正则 (黑名单)</label>
          <textarea v-model="config.BANNED_KEYWORDS" class="input-box text-sm font-mono h-20" placeholder="过期|剩余|维护..."></textarea>
          <p class="text-xs text-slate-500 mt-1">命中上述正则的节点将在组装前被无情丢弃。</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-300 mb-3 border-b border-slate-700 pb-1">UrlTest 测速组参数</label>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">探针 URL</label>
              <input type="text" v-model="config.URLTEST_PARAMS.url" class="input-box text-sm font-mono">
            </div>
            <div class="flex gap-4">
              <div class="flex-1">
                <label class="block text-xs text-slate-400 mb-1">测速间隔 (Interval)</label>
                <input type="text" v-model="config.URLTEST_PARAMS.interval" class="input-box text-sm font-mono">
              </div>
              <div class="flex-1">
                <label class="block text-xs text-slate-400 mb-1">容忍延迟 (Tolerance ms)</label>
                <input type="number" v-model="config.URLTEST_PARAMS.tolerance" class="input-box text-sm font-mono">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel mt-6 border-blue-900 bg-blue-900/10">
      <h2 class="text-xl font-semibold mb-4 border-b border-blue-900/50 pb-2 flex items-center gap-2 text-blue-400">🚀 交付与核心引擎联调</h2>
      
      <div class="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/50 p-4 rounded-lg border border-slate-800 mb-4">
        <div class="flex-grow w-full font-mono text-sm break-all text-green-400">
          {{ clientUrl }}
        </div>
        <button @click="copyUrl" class="btn-primary whitespace-nowrap bg-green-600 hover:bg-green-500">
          📋 复制订阅链接
        </button>
      </div>

      <div>
        <button @click="testEngine" :disabled="testing" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded mb-2 font-medium transition-colors text-sm">
          <span v-if="testing">⚙️ 引擎运转中，正在拼装图纸...</span>
          <span v-else>🔬 模拟客户端拉取请求 (Debug 测试)</span>
        </button>
        
        <div v-if="testLogs.length > 0" class="bg-[#0c0c0c] border border-slate-700 rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs text-slate-300">
          <div v-for="(log, i) in testLogs" :key="i" class="mb-1 pb-1 border-b border-slate-800/50 last:border-0">
            <span class="text-blue-500">[{{ new Date().toLocaleTimeString() }}]</span> {{ log }}
          </div>
        </div>
      </div>
    </div>

  </div>

  <script>
    const { createApp } = Vue;

    createApp({
      data() {
        return {
          saving: false,
          testing: false,
          testLogs: [],
          // 默认数据结构 (将被 KV 数据覆盖)
          config: {
            AUTH_TOKEN: "",
            GITHUB: { USER: "", REPO: "", BRANCH: "master", TOKEN: "" },
            SUB_LINKS: [],
            REGION_KEYWORDS: {},
            BANNED_KEYWORDS: "过期|剩余|网址|官网|流量|到期|重置|有效|套餐|群组|通知|地址|购买|维护",
            URLTEST_PARAMS: { url: "https://www.gstatic.com/generate_204", interval: "3m", tolerance: 150 }
          },
          // 用于前端双向绑定的字符串化字典
          regionStr: { HK: "HK,香港", TW: "TW,台湾", SG: "SG,新加坡", JP: "JP,日本", US: "US,美国" },
          flagMap: { "HK": "🇭🇰", "SG": "🇸🇬", "JP": "🇯🇵", "US": "🇺🇸", "TW": "🇹🇼" }
        }
      },
      computed: {
        clientUrl() {
          const origin = window.location.origin;
          const token = this.config.AUTH_TOKEN || "未设置密钥";
          return \`\${origin}/api/generate?token=\${token}\`;
        }
      },
      async mounted() {
        await this.loadSettings();
      },
      methods: {
        getFlag(reg) { return this.flagMap[reg] || "🏳️"; },
        
        async loadSettings() {
          try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            
            if (data && Object.keys(data).length > 0) {
              // 深度合并配置
              this.config = { ...this.config, ...data };
              if (data.GITHUB) this.config.GITHUB = { ...this.config.GITHUB, ...data.GITHUB };
              if (data.URLTEST_PARAMS) this.config.URLTEST_PARAMS = { ...this.config.URLTEST_PARAMS, ...data.URLTEST_PARAMS };
              
              // 还原区域字典为逗号分隔的字符串
              if (data.REGION_KEYWORDS) {
                for (let k in data.REGION_KEYWORDS) {
                  this.regionStr[k] = data.REGION_KEYWORDS[k].join(', ');
                }
              }
            }
          } catch (e) {
            console.warn("未能从 KV 加载初始配置，使用默认空架子。", e);
          }
        },

        async saveSettings() {
          if (!this.config.AUTH_TOKEN) {
            alert("⚠️ 必须设置系统管理员密钥！");
            return;
          }
          this.saving = true;
          
          // 在保存前，将字符串形式的字典清洗转换回数组
          let finalRegions = {};
          for (let k in this.regionStr) {
            finalRegions[k] = this.regionStr[k].split(',')
              .map(s => s.trim())
              .filter(s => s.length > 0);
          }
          this.config.REGION_KEYWORDS = finalRegions;

          try {
            const res = await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.config)
            });
            const result = await res.json();
            if (result.success) {
              alert("✅ 皇家档案馆指令：数据已成功写入边缘存储。");
            }
          } catch (e) {
            alert("❌ 保存异常: " + e.message);
          }
          this.saving = false;
        },

        addAirport() {
          this.config.SUB_LINKS.push({ name: "", url: "", enabled: true });
        },
        removeAirport(index) {
          this.config.SUB_LINKS.splice(index, 1);
        },

        async copyUrl() {
          try {
            await navigator.clipboard.writeText(this.clientUrl);
            alert("复制成功！请在 Sing-Box 客户端中新建远程配置并粘贴此链接。");
          } catch (err) {
            alert("复制失败，请手动全选复制。");
          }
        },

        async testEngine() {
          if (!this.config.AUTH_TOKEN) return alert("请先配置并保存系统密钥！");
          this.testing = true;
          this.testLogs = ["连接引擎核心通道中..."];
          
          try {
            // 请求 debug=1 获取附带日志的完整 JSON
            const res = await fetch(\`/api/generate?token=\${this.config.AUTH_TOKEN}&debug=1\`);
            if (!res.ok) {
              const text = await res.text();
              throw new Error(text || "HTTP 状态异常");
            }
            const result = await res.json();
            
            if (result.logs) {
              this.testLogs = result.logs;
              this.testLogs.push(\`[成功] 已装配 \${result.config.outbounds.length} 个出站节点与策略组。\`);
            } else {
              this.testLogs.push("配置装配成功，但引擎未返回 Debug 日志。");
            }
          } catch (e) {
            this.testLogs.push(\`[致命故障] \${e.message}\`);
          }
          this.testing = false;
        }
      }
    });
  </script>
</body>
</html>`;
}
