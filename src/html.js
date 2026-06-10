export function renderHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>singbox配置中枢</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
  <style>
    /* 基础全局样式 */
    body { background-color: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; }
    
    /* 组件样式复用 */
    .panel { background-color: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .input-box { background-color: #0f172a; border: 1px solid #334155; color: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 0.5rem; width: 100%; outline: none; transition: border-color 0.2s; }
    .input-box:focus { border-color: #3b82f6; }
    .btn-primary { background-color: #3b82f6; color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 500; transition: background-color 0.2s; cursor: pointer; }
    .btn-primary:hover { background-color: #2563eb; }
    .btn-danger { background-color: #ef4444; color: white; padding: 0.25rem 0.75rem; border-radius: 0.5rem; font-size: 0.875rem; cursor: pointer; }
    .btn-danger:hover { background-color: #dc2626; }
    
    /* 滚动条美化 */
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
          FlowProxy <span class="text-xl font-normal text-blue-400">控制中心</span>
        </h1>
        <p class="text-slate-400 mt-2 text-sm">Sing-Box 远程配置生成与分发引擎</p>
      </div>
      <button @click="saveSettings" :disabled="saving" class="btn-primary flex items-center gap-2">
        <span v-if="saving">同步中...</span>
        <span v-else>保存配置至 KV</span>
      </button>
    </header>

    <div class="panel">
      <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2">基础设置: 凭证与代码源</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-slate-400 mb-1">系统鉴权密钥 (AUTH_TOKEN)</label>
          <input type="password" v-model="config.AUTH_TOKEN" class="input-box" placeholder="客户端订阅 URL 所需 Token">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">GitHub 仓库分支</label>
          <input type="text" v-model="config.GITHUB.BRANCH" class="input-box" placeholder="例如: master 或 main">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">GitHub 用户名</label>
          <input type="text" v-model="config.GITHUB.USER" class="input-box" placeholder="GitHub Username">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">GitHub 仓库名</label>
          <input type="text" v-model="config.GITHUB.REPO" class="input-box" placeholder="例如: singbox-profiles">
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm text-slate-400 mb-1">GitHub Access Token (私有仓库必需)</label>
          <input type="password" v-model="config.GITHUB.TOKEN" class="input-box" placeholder="ghp_...">
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
        <h2 class="text-xl font-semibold">节点源: Sub-Store 订阅列表</h2>
        <button @click="addSubscription" class="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white">添加订阅源</button>
      </div>
      
      <div v-if="config.SUB_LINKS.length === 0" class="text-center text-slate-500 py-4">
        尚未配置节点订阅源。
      </div>
      
      <div v-for="(sub, index) in config.SUB_LINKS" :key="index" class="flex flex-wrap md:flex-nowrap items-center gap-3 bg-slate-800 p-3 rounded mb-2 border border-slate-700">
        <div class="w-full md:w-32">
          <input type="text" v-model="sub.name" class="input-box text-sm" placeholder="订阅别名">
        </div>
        <div class="flex-grow w-full">
          <input type="text" v-model="sub.url" class="input-box text-sm font-mono" placeholder="订阅 URL">
        </div>
        <div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end mt-2 md:mt-0">
          <label class="flex items-center cursor-pointer gap-2 text-sm">
            <input type="checkbox" v-model="sub.enabled" class="w-4 h-4 text-blue-600 bg-slate-900 border-slate-600 rounded focus:ring-blue-500">
            <span :class="sub.enabled ? 'text-green-400' : 'text-slate-500'">启用</span>
          </label>
          <button @click="removeSubscription(index)" class="btn-danger">删除</button>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="panel h-full mb-0">
        <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2">路由规则: 区域匹配字典</h2>
        <p class="text-xs text-slate-400 mb-4">使用半角逗号分隔关键字，引擎将依据此字典构建 UrlTest 策略组。</p>
        
        <div class="space-y-3">
          <div v-for="(keywords, reg) in regionStr" :key="reg" class="flex flex-col">
            <label class="text-sm font-medium text-slate-300 mb-1 flex items-center gap-2">
              <span class="w-8">{{ reg }}</span>
            </label>
            <input type="text" v-model="regionStr[reg]" class="input-box text-sm font-mono" placeholder="匹配关键字">
          </div>
        </div>
      </div>

      <div class="panel h-full mb-0">
        <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2">调度策略: 过滤与测速参数</h2>
        
        <div class="mb-5">
          <label class="block text-sm text-slate-400 mb-1">节点过滤正则 (屏蔽词)</label>
          <textarea v-model="config.BANNED_KEYWORDS" class="input-box text-sm font-mono h-20" placeholder="用于清洗无效节点的正则表达式"></textarea>
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-300 mb-3 border-b border-slate-700 pb-1">UrlTest 测速组参数</label>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">探测 URL</label>
              <input type="text" v-model="config.URLTEST_PARAMS.url" class="input-box text-sm font-mono">
            </div>
            <div class="flex gap-4">
              <div class="flex-1">
                <label class="block text-xs text-slate-400 mb-1">探测间隔 (Interval)</label>
                <input type="text" v-model="config.URLTEST_PARAMS.interval" class="input-box text-sm font-mono">
              </div>
              <div class="flex-1">
                <label class="block text-xs text-slate-400 mb-1">容忍延迟 (Tolerance)</label>
                <input type="number" v-model="config.URLTEST_PARAMS.tolerance" class="input-box text-sm font-mono">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel mt-6 border-blue-900 bg-blue-900/10">
      <h2 class="text-xl font-semibold mb-4 border-b border-blue-900/50 pb-2 text-blue-400">部署与测试</h2>
      
      <div class="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/50 p-4 rounded-lg border border-slate-800 mb-4">
        <div class="flex-grow w-full font-mono text-sm break-all text-green-400">
          {{ clientUrl }}
        </div>
        <button @click="copyUrl" class="btn-primary whitespace-nowrap bg-green-600 hover:bg-green-500">
          复制客户端订阅链接
        </button>
      </div>

      <div>
        <button @click="testEngine" :disabled="testing" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded mb-2 font-medium transition-colors text-sm">
          <span v-if="testing">引擎执行中...</span>
          <span v-else>执行引擎逻辑联调 (Debug)</span>
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
          // 初始默认状态结构
          config: {
            AUTH_TOKEN: "",
            GITHUB: { USER: "", REPO: "", BRANCH: "master", TOKEN: "" },
            SUB_LINKS: [],
            REGION_KEYWORDS: {},
            BANNED_KEYWORDS: "过期|剩余|网址|官网|流量|到期|重置|有效|套餐|群组|通知|地址|购买|维护",
            URLTEST_PARAMS: { url: "https://www.gstatic.com/generate_204", interval: "3m", tolerance: 150 }
          },
          // 前端字符串化状态绑定
          regionStr: { HK: "HK,香港", TW: "TW,台湾", SG: "SG,新加坡", JP: "JP,日本", US: "US,美国" }
        }
      },
      computed: {
        // 动态生成客户端订阅地址
        clientUrl() {
          const origin = window.location.origin;
          const token = this.config.AUTH_TOKEN || "UNSET_TOKEN";
          return \`\${origin}/api/generate?token=\${token}\`;
        }
      },
      async mounted() {
        // 组件挂载后拉取服务端配置
        await this.loadSettings();
      },
      methods: {
        // 请求 API: GET /api/settings
        async loadSettings() {
          try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            
            if (data && Object.keys(data).length > 0) {
              this.config = { ...this.config, ...data };
              if (data.GITHUB) this.config.GITHUB = { ...this.config.GITHUB, ...data.GITHUB };
              if (data.URLTEST_PARAMS) this.config.URLTEST_PARAMS = { ...this.config.URLTEST_PARAMS, ...data.URLTEST_PARAMS };
              
              if (data.REGION_KEYWORDS) {
                for (let k in data.REGION_KEYWORDS) {
                  this.regionStr[k] = data.REGION_KEYWORDS[k].join(', ');
                }
              }
            }
          } catch (e) {
            console.warn("KV 配置拉取失败，使用默认配置状态初始化前端。", e);
          }
        },

        // 请求 API: POST /api/settings
        async saveSettings() {
          if (!this.config.AUTH_TOKEN) {
            alert("必须设置系统鉴权密钥。");
            return;
          }
          this.saving = true;
          
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
              alert("配置已成功保存至 Cloudflare KV。");
            }
          } catch (e) {
            alert("保存请求异常: " + e.message);
          }
          this.saving = false;
        },

        // 状态更新: 增删订阅源
        addSubscription() {
          this.config.SUB_LINKS.push({ name: "", url: "", enabled: true });
        },
        removeSubscription(index) {
          this.config.SUB_LINKS.splice(index, 1);
        },

        // 剪贴板操作
        async copyUrl() {
          try {
            await navigator.clipboard.writeText(this.clientUrl);
            alert("已复制到剪贴板。");
          } catch (err) {
            alert("复制失败，请检查浏览器权限。");
          }
        },

        // 请求 API: GET /api/generate?debug=1
        async testEngine() {
          if (!this.config.AUTH_TOKEN) return alert("鉴权密钥未配置。");
          this.testing = true;
          this.testLogs = ["初始化请求上下文..."];
          
          try {
            const res = await fetch(\`/api/generate?token=\${this.config.AUTH_TOKEN}&debug=1\`);
            if (!res.ok) {
              const text = await res.text();
              throw new Error(text || "HTTP 状态异常");
            }
            const result = await res.json();
            
            if (result.logs) {
              this.testLogs = result.logs;
              this.testLogs.push(\`[Success] 引擎执行完毕，总计生成出站规则数: \${result.config.outbounds.length}\`);
            } else {
              this.testLogs.push("配置生成完成，但未捕获到 Debug 日志数据。");
            }
          } catch (e) {
            this.testLogs.push(\`[Error] 引擎异常断开: \${e.message}\`);
          }
          this.testing = false;
        }
      }
    });
  </script>
</body>
</html>`;
}
