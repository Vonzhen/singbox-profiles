/**
 * src/db.js
 * Cloudflare KV 数据库访问层 (Data Access Layer)
 * 负责多用户鉴权、数据隔离与全局配置的结构化读写
 */

// ==========================================
// 1. 安全与加密工具
// ==========================================

/**
 * 使用 Web Crypto API 对密码进行 SHA-256 哈希加密
 * 绝对不向 KV 写入明文密码
 */
export async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成安全的随机 Token (用于 Session 或 Client Token)
 */
export function generateToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
}

// ==========================================
// 2. 账户与鉴权体系 (User & Auth)
// ==========================================

// KV 结构: user:<username> -> { password_hash, role, status, client_token, created_at }
export async function getUser(env, username) {
  return await env.DB.get(`user:${username}`, { type: "json" });
}

export async function saveUser(env, username, userData) {
  await env.DB.put(`user:${username}`, JSON.stringify(userData));
}

// 登录态 Session 管理 (KV 结构: session:<session_id> -> username)
export async function createSession(env, sessionId, username) {
  // 设置 24 小时过期时间 (86400 秒)，利用 CF KV 的 TTL 自动清理过期会话
  await env.DB.put(`session:${sessionId}`, username, { expirationTtl: 86400 });
}

export async function getUserBySession(env, sessionId) {
  return await env.DB.get(`session:${sessionId}`);
}

export async function deleteSession(env, sessionId) {
  await env.DB.delete(`session:${sessionId}`);
}

// --- 核心优化：Token 反向映射查询 ---
// 为了让客户端拉取配置时达到 O(1) 的极速响应，我们将 Token 与用户名绑定
// KV 结构: token:<client_token> -> username
export async function linkTokenToUser(env, token, username) {
  await env.DB.put(`token:${token}`, username);
}

export async function getUserByClientToken(env, token) {
  const username = await env.DB.get(`token:${token}`);
  if (!username) return null;
  const user = await getUser(env, username);
  // 返回组合对象，方便引擎直接使用
  return user ? { username, ...user } : null;
}

// 获取系统内所有用户 (用于超级管理员的审核面板)
export async function listAllUsers(env) {
  const value = await env.DB.list({ prefix: "user:" });
  const users = [];
  for (const key of value.keys) {
    const userData = await env.DB.get(key.name, { type: "json" });
    users.push({ username: key.name.replace('user:', ''), ...userData });
  }
  return users;
}

// ==========================================
// 3. 用户数据物理隔离区 (Isolated User Data)
// ==========================================

// KV 结构: data:<username>:sub_links -> [ {name, url, enabled} ]
export async function getUserSubLinks(env, username) {
  return await env.DB.get(`data:${username}:sub_links`, { type: "json" }) || [];
}

export async function saveUserSubLinks(env, username, subLinks) {
  await env.DB.put(`data:${username}:sub_links`, JSON.stringify(subLinks));
}

// ==========================================
// 4. 全局指挥部 (Global Configuration)
// ==========================================

// KV 结构: global:config -> { REGION_KEYWORDS, BANNED_KEYWORDS, URLTEST_PARAMS, TEMPLATE_JSON }
export async function getGlobalConfig(env) {
  const config = await env.DB.get("global:config", { type: "json" });
  
  // 如果 KV 中尚未初始化，返回标准的默认骨架结构
  if (!config) {
    return {
      REGION_KEYWORDS: { HK: ["HK", "香港"], TW: ["TW", "台湾"], SG: ["SG", "新加坡"], JP: ["JP", "日本"], US: ["US", "美国"] },
      BANNED_KEYWORDS: "过期|剩余|网址|官网|流量|到期|重置|有效|套餐|群组|通知|地址|购买|维护",
      URLTEST_PARAMS: { url: "https://www.gstatic.com/generate_204", interval: "3m", tolerance: 150 },
      TEMPLATE_JSON: {}
    };
  }
  return config;
}

export async function saveGlobalConfig(env, config) {
  await env.DB.put("global:config", JSON.stringify(config));
}
