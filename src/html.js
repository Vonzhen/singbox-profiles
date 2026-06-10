/**
 * src/html.js
 * 前端可视化控制面板
 * 集成登录拦截、注册申请、多用户隔离看板及管理员审核体系
 */
export function renderHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowProxy 控制中心</title>
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
    .tab-btn { padding: 0.75rem 1.5rem; font-weight: 500; border-bottom: 2px solid transparent; cursor: pointer; transition: all 0.2s; color: #94a3b8; }
    .tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; }
    .tab-btn:hover:not(.active) { color: #e2e8f0; }
    [v-cloak] { display: none; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
  </style>
</head>
<body>
  <div id="app" class="max-w-5xl mx-auto py-8 px-4" v-cloak>
    
    <div v-if="!isLoggedIn" class="min-h-[60vh] flex flex-col items-center justify-center">
      <div class="bg-slate-800 border border-slate-700 p-8 rounded-xl shadow-xl w-full max-w-md">
        <h2 class="text-2xl font-bold text-white mb-2 text-center">FlowProxy 控制中心</h2>
        <p class="text-slate-400 text-xs text-center mb-6">无服务器多用户 Sing-Box 配置中枢</p>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-slate-400 mb-1">用户名</label>
            <input type="text" v-model="authForm.username" class="input-box" placeholder="输入用户名">
          </div>
          <div>
            <label class="block text-sm text-slate-400 mb-1">密码</label>
            <input type="password" v-model="authForm.password" class="input-box" placeholder="输入密码">
          </div>
          
          <div class="flex gap-3 pt-2">
            <button @click="handleLogin" :disabled="authLoading" class="flex-1 btn-primary text-center">
              {{ authLoading ? '验证中...' : '登录' }}
            </button>
            <button @click="handleRegister" :disabled="authLoading" class="flex-1 bg-slate-700 hover:bg-slate-600 text-white padding py-2 rounded-disabled rounded-lg text-sm font-medium transition-colors">
              申请注册
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="user.status === 'pending'" class="min-h-[50vh] flex flex-col items-center justify-center">
      <div class="bg-slate-800 border border-amber-900/50 p-8 rounded-xl text-center max-w-md">
        <div class="text-4xl mb-4">⏳</div>
        <h2 class="text-xl font-bold text-amber-400 mb-2">账号审核中</h2>
        <p class="text-slate-300 text-sm leading-relaxed mb-6">
          你好 <strong>{{ user.username }}</strong>，你的账户已成功建立。系统目前开启了严格的安全审计制，请联系系统所有者（Owner）通过你的激活申请。
        </p>
        <button @click="handleLogout" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm">
          退出当前账号
        </button>
      </div>
    </div>

    <div v-else-if="user.status === 'active'">
      
      <header class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            FlowProxy <span class="text-xl font-normal text-blue-400">控制中心</span>
          </h1>
          <div class="flex items-center gap-2 mt-1 text-xs text-slate-400">
            <span>当前用户: <strong class="text-slate-200">{{ user.username }}</strong></span>
            <span class="bg-slate-800 px-2 py-0.5 rounded text-blue-400 font-mono">{{ user.role.toUpperCase() }}</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <button @click="saveSettings" :disabled="saving" class="btn-primary">
            {{ saving ? '同步中...' : '保存修改' }}
          </button>
          <button @click="handleLogout" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm border border-slate-700">
            安全登出
          </button>
        </div>
      </header>

      <div class="flex border-b border-slate-700 mb-6">
        <button class="tab-btn" :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">✈️ 节点订阅源</button>
        <button v-if="user.role === 'owner'" class="tab-btn" :class="{ active: activeTab === 'global' }" @click="activeTab = 'global'">🌍 全局分流策略</button>
        <button v-if="user.role === 'owner'" class="tab-btn" :class="{ active: activeTab === 'template' }" @click="activeTab = 'template'">📄 核心规则模板</button>
        <button v-if="user.role === 'owner'" class="tab-btn" :class="{ active: activeTab === 'admin' }" @click="activeTab = 'admin'">👥 用户准入审核</button>
      </div>

      <div v-show="activeTab === 'config'">
        <div class="panel">
          <div class="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
            <h2 class="text-xl font-semibold text-white">个人节点源: Sub-Store 机场阵列</h2>
            <button @click="addSubscription" class="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white">+ 添加订阅源</button>
          </div>
          <div v-if="sub_links.length === 0" class="text-center text-slate-500 py-6 text-sm">尚未配置节点，请点击右上角添加。</div>
          
          <div v-for="(sub, index) in sub_links" :key="index" class="flex flex-wrap md:flex-nowrap items-center gap-3 bg-slate-800 p-3 rounded mb-2 border border-slate-700">
            <div class="w-full md:w-32">
              <input type="text" v-model="sub.name" class="input-box text-sm" placeholder="机场别名">
            </div>
            <div class="flex-grow w-full">
              <input type="text" v-model="sub.url" class="input-box text-sm font-mono" placeholder="Sub-Store 节点订阅直链">
            </div>
            <div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
              <label class="flex items-center cursor-pointer gap-2 text-sm">
                <input type="checkbox" v-model="sub.enabled" class="w-4 h-4 text-blue-600 bg-slate-900 border-slate-600 rounded">
                <span :class="sub.enabled ? 'text-green-400' : 'text-slate-500'">启用</span>
              </label>
              <button @click="removeSubscription(index)" class="btn-danger">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div v-show="activeTab === 'global' && user.role === 'owner'">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="panel h-full mb-0">
            <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 text-white">区域匹配关键字字典</h2>
            <p class="text-xs text-slate-400 mb-4">使用半角逗号分隔，引擎将自动为匹配到的落地节点匹配并建立 UrlTest 自动化组。</p>
            <div class="space-y-3">
              <div v-for="(keywords, reg) in regionStr" :key="reg" class="flex flex-col">
                <label class="text-sm font-medium text-slate-300 mb-1">{{ reg }} 区域</label>
                <input type="text" v-model="regionStr[reg]" class="input-box text-sm font-mono">
              </div>
            </div>
          </div>
          <div class="panel h-full mb-0">
            <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 text-white">垃圾节点清洗与测速阈值</h2>
            <div class="mb-5">
              <label class="block text-sm text-slate-400 mb-1">无效节点屏蔽正则 (BANNED_KEYWORDS)</label>
              <textarea v-model="globalConfig.BANNED_KEYWORDS" class="input-box text-sm font-mono h-20"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-2 border-b border-slate-700 pb-1">UrlTest 组全局探针参数</label>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs text-slate-400 mb-1">探测 URL</label>
                  <input type="text" v-model="globalConfig.URLTEST_PARAMS.url" class="input-box text-sm font-mono">
                </div>
                <div class="flex gap-4">
                  <div class="flex-1">
                    <label class="block text-xs text-slate-400 mb-1">探测间隔 (Interval)</label>
                    <input type="text" v-model="globalConfig.URLTEST_PARAMS.interval" class="input-box text-sm font-mono">
                  </div>
                  <div class="flex-1">
                    <label class="block text-xs text-slate-400 mb-1">容差延迟 (Tolerance ms)</label>
                    <input type="number" v-model="globalConfig.URLTEST_PARAMS.tolerance" class="input-box text-sm font-mono">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-show="activeTab === 'template' && user.role === 'owner'">
        <div class="panel">
          <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 text-white">Sing-Box 骨架大脑模板 (TEMPLATE_JSON)</h2>
          <p class="text-xs text-slate-400 mb-4">在此处编排你的原生 DNS 服务器、DNS 规则及出站分流规则。在出站组内可直接声明占位符实现依赖注入。</p>
          <textarea v-model="templateStr" class="input-box font-mono text-sm leading-relaxed h-[500px]" spellcheck="false" placeholder="输入原生 Sing-box 配置 JSON..."></textarea>
        </div>
      </div>

      <div v-show="activeTab === 'admin' && user.role === 'owner'">
        <div class="panel">
          <h2 class="text-xl font-semibold mb-4 border-b border-slate-700 pb-2 text-white">系统账户审计清单</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm border-collapse">
              <thead>
                <tr class="border-b border-slate-700 text-slate-400">
                  <th class="py-2 px-4">用户名</th>
                  <th class="py-2 px-4">系统权限</th>
                  <th class="py-2 px-4">状态标识</th>
                  <th class="py-2 px-4">注册时间</th>
                  <th class="py-2 px-4 text-right">安全审计操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in adminUsers" :key="u.username" class="border-b border-slate-800 hover:bg-slate-800/40">
                  <td class="py-3 px-4 font-medium text-white">{{ u.username }}</td>
                  <td class="py-3 px-4"><span class="text-xs px-2 py-0.5 rounded bg-slate-700">{{ u.role }}</span></td>
                  <td class="py-3 px-4">
                    <span :class="u.status === 'active' ? 'text-green-400' : 'text-amber-400'" class="text-xs font-semibold">
                      ● {{ u.status === 'active' ? '已授权活跃' : '待激活审核' }}
                    </span>
                  </td>
                  <td class="py-3 px-4 text-slate-400 text-xs">{{ formatDate(u.created_at) }}</td>
                  <td class="py-3 px-4 text-right">
                    <button v-if="u.status === 'pending'" @click="approveUser(u.username)" class="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-1 rounded">
                      准许激活入网
                    </button>
                    <span v-else class="text-xs text-slate-500">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel mt-6 border-blue-950 bg-blue-950/20">
        <h2 class="text-xl font-semibold mb-4 border-b border-blue-900/50 pb-2 text-blue-400">底层生成引擎接口联调</h2>
        <div class="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/50 p-4 rounded-lg border border-slate-800 mb-4">
          <div class="flex-grow w-full font-mono text-sm break-all text-green-400 select-all">
            {{ clientUrl }}
          </div>
          <button @click="copyUrl" class="btn-primary whitespace-nowrap bg-green-600 hover:bg-green-500">复制订阅直链</button>
        </div>
        <div>
          <button @click="testEngine" :disabled="testing" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded text-sm font-medium transition-colors">
            {{ testing ? '配置实时拼装运算中...' : '模拟当前用户拉取请求 (Debug 测试)' }}
          </button>
          <div v-if="testLogs.length > 0" class="mt-3 bg-[#0c0c0c] border border-slate-700 rounded-lg p-3 h-52 overflow-y-auto font-mono text-xs text-slate-300">
            <div v-for="(log, i) in testLogs" :key="i" class="mb-1 pb-1 border-b border-slate-900/50 last:border-0">
              <span class="text-blue-500">[{{ i+1 }}]</span> {{ log }}
            </div>
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
          isLoggedIn: false,
          authLoading: false,
          saving: false,
          testing: false,
          activeTab: 'config',
          authForm: { username: '', password: '' },
          user: { username: '', role: '', status: '', client_token: '' },
          
          // 核心业务隔离数据
          sub_links: [],
          
          // 全局共有底座配置
          globalConfig: {
            BANNED_KEYWORDS: "",
            URLTEST_PARAMS: { url: "", interval: "", tolerance: 150 }
          },
          templateStr: "",
          regionStr: { HK: "", TW: "", SG: "", JP: "", US: "" },
          
          // 管理端审计数据
          adminUsers: [],
          testLogs: []
        }
      },
      computed: {
        clientUrl() {
          if (!this.user.client_token) return '账号未激活，无法分发直链';
          return \`\${window.location.origin}/api/generate?token=\${this.user.client_token}\`;
        }
      },
      async mounted() {
        await this.checkAuthStatus();
      },
      methods: {
        formatDate(isoStr) { return isoStr ? new Date(isoStr).toLocaleString() : '-'; },
        
        async checkAuthStatus() {
          try {
            const res = await fetch('/api/me');
            if (res.status === 200) {
              this.user = await res.json();
              this.isLoggedIn = true;
              if (this.user.status === 'active') {
                await this.loadSettings();
                if (this.user.role === 'owner') await this.loadAdminUsers();
              }
            } else {
              this.isLoggedIn = false;
            }
          } catch (e) { this.isLoggedIn = false; }
        },

        async handleLogin() {
          if (!this.authForm.username || !this.authForm.password) return alert("请完整填入账户凭证");
          this.authLoading = true;
          try {
            const res = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.authForm)
            });
            const data = await res.json();
            if (res.ok && data.success) {
              await this.checkAuthStatus();
            } else {
              alert(data.error || "登录失败，凭证异常");
            }
          } catch (e) { alert("网络交互异常"); }
          this.authLoading = false;
        },

        async handleRegister() {
          if (!this.authForm.username || !this.authForm.password) return alert("请完整填入账户凭证");
          this.authLoading = true;
          try {
            const res = await fetch('/api/auth/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.authForm)
            });
            const data = await res.json();
            if (res.ok && data.success) {
              if (data.isFirstUser) {
                alert("🎉 初始化建站成功！你是系统首位所有者(Owner)，已自动完成激活动作，请直接执行登录。");
              } else {
                alert("📌 注册申请已提交。系统当前处于安全审查状态，请联系管理员审核。");
              }
            } else {
              alert(data.error || "注册阻断");
            }
          } catch (e) { alert("注册异常"); }
          this.authLoading = false;
        },

        async handleLogout() {
          await fetch('/api/auth/logout', { method: 'POST' });
          this.isLoggedIn = false;
          this.user = {};
          this.authForm = { username: '', password: '' };
        },

        async loadSettings() {
          try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            this.sub_links = data.sub_links || [];
            
            if (this.user.role === 'owner') {
              this.globalConfig.BANNED_KEYWORDS = data.BANNED_KEYWORDS || "";
              this.globalConfig.URLTEST_PARAMS = data.URLTEST_PARAMS || { url: "", interval: "", tolerance: 150 };
              this.templateStr = data.TEMPLATE_JSON ? JSON.stringify(data.TEMPLATE_JSON, null, 2) : "";
              if (data.REGION_KEYWORDS) {
                for (let k in this.regionStr) {
                  this.regionStr[k] = data.REGION_KEYWORDS[k] ? data.REGION_KEYWORDS[k].join(', ') : "";
                }
              }
            }
          } catch (e) { console.error("加载配置失败", e); }
        },

        async saveSettings() {
          this.saving = true;
          let payload = { sub_links: this.sub_links };

          if (this.user.role === 'owner') {
            if (this.templateStr.trim() !== "") {
              try {
                payload.TEMPLATE_JSON = JSON.parse(this.templateStr);
              } catch (err) {
                alert("❌ 保存失败：【核心规则模板】存在 JSON 语法错误！\\n" + err.message);
                this.activeTab = 'template';
                this.saving = false;
                return;
              }
            }
            let finalRegions = {};
            for (let k in this.regionStr) {
              finalRegions[k] = this.regionStr[k].split(',').map(s => s.trim()).filter(s => s.length > 0);
            }
            payload.REGION_KEYWORDS = finalRegions;
            payload.BANNED_KEYWORDS = this.globalConfig.BANNED_KEYWORDS;
            payload.URLTEST_PARAMS = this.globalConfig.URLTEST_PARAMS;
          }

          try {
            const res = await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (res.ok) alert("数据同步成功，边缘计算存储已锁定。");
          } catch (e) { alert("网络提交异常"); }
          this.saving = false;
        },

        async loadAdminUsers() {
          try {
            const res = await fetch('/api/admin/users');
            if (res.ok) this.adminUsers = await res.json();
          } catch (e) { console.error(e); }
        },

        async approveUser(target_username) {
          try {
            const res = await fetch('/api/admin/approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target_username })
            });
            if (res.ok) {
              alert(\`已成功激活用户 [\${target_username}] 准入许可。\`);
              await this.loadAdminUsers();
            }
          } catch (e) { alert("审核过账故障"); }
        },

        addSubscription() { this.sub_links.push({ name: "", url: "", enabled: true }); },
        removeSubscription(index) { this.sub_links.splice(index, 1); },
        
        async copyUrl() {
          if (!this.user.client_token) return;
          try {
            await navigator.clipboard.writeText(this.clientUrl);
            alert("客户端分发链接已复制到系统剪贴板。");
          } catch (err) { alert("浏览器阻断，请手动全选复制。"); }
        },

        async testEngine() {
          this.testing = true;
          this.testLogs = ["建立边缘模拟连接通道..."];
          try {
            const res = await fetch(\`/api/generate?token=\${this.user.client_token}&debug=1\`);
            const result = await res.json();
            if (res.ok && result.logs) {
              this.testLogs = result.logs;
            } else {
              this.testLogs.push("配置编译成功，透传未返回 Debug 级状态记录。");
            }
          } catch (e) { this.testLogs.push("致命缺陷：引擎计算通道中断。"); }
          this.testing = false;
        }
      }
    });
  </script>
</body>
</html>`;
}
