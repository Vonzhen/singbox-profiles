/**
 * src/index.js
 * 主路由分发器与安全网关接口
 */

import { generateConfig } from './engine.js';
import { renderHTML } from './html.js';
import * as db from './db.js';

// ==========================================
// 辅助工具函数
// ==========================================

// 解析请求头中的 Cookie
function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((res, c) => {
    const [key, val] = c.trim().split('=').map(decodeURIComponent);
    try { return Object.assign(res, { [key]: JSON.parse(val) }); } catch (e) { return Object.assign(res, { [key]: val }); }
  }, {});
}

// 统一的 JSON 响应格式
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// 鉴权中间件：获取当前登录用户
async function getCurrentUser(request, env) {
  const cookies = parseCookies(request);
  const sessionId = cookies['session_id'];
  if (!sessionId) return null;
  
  const username = await db.getUserBySession(env, sessionId);
  if (!username) return null;
  
  const user = await db.getUser(env, username);
  return user ? { username, ...user } : null;
}

// ==========================================
// 主执行流程
// ==========================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // 屏蔽浏览器的图标报错请求
      if (path === "/favicon.ico") return new Response(null, { status: 204 });
      
      // ----------------------------------------
      // 1. 前端页面路由 (不受鉴权保护，由页面内部判断跳转)
      // ----------------------------------------
      if (method === "GET" && path === "/") {
        return new Response(renderHTML(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // ----------------------------------------
      // 2. 客户端订阅拉取接口 (无状态 Token 鉴权)
      // ----------------------------------------
      if (method === "GET" && path === "/api/generate") {
        const clientToken = url.searchParams.get("token");
        const isDebug = url.searchParams.get("debug") === "1";

        if (!clientToken) return new Response("Missing token", { status: 401 });

        // 核心改造：通过 Token 反向查找用户
        const user = await db.getUserByClientToken(env, clientToken);
        if (!user || user.status !== 'active') {
          return new Response("Unauthorized or pending access", { status: 403 });
        }

        // 提取该用户的隔离数据和全局数据，传递给引擎
        const userSubLinks = await db.getUserSubLinks(env, user.username);
        const globalConfig = await db.getGlobalConfig(env);

        // 调用引擎 (引擎部分将在后续微调以接收这些分离的数据)
        return await generateConfig(userSubLinks, globalConfig, isDebug);
      }

      // ----------------------------------------
      // 3. 登录与注册接口 (Auth APIs)
      // ----------------------------------------
      if (path.startsWith("/api/auth/")) {
        const body = method === "POST" ? await request.json() : {};
        
        // --- 注册 ---
        if (path === "/api/auth/register" && method === "POST") {
          const { username, password } = body;
          if (!username || !password) return jsonResponse({ error: "参数不完整" }, 400);
          
          const existingUser = await db.getUser(env, username);
          if (existingUser) return jsonResponse({ error: "用户已存在" }, 400);

          const allUsers = await db.listAllUsers(env);
          const isFirstUser = allUsers.length === 0;
          
          // 第一个注册的用户直接成为 owner 并激活
          const newUser = {
            password_hash: await db.hashPassword(password),
            role: isFirstUser ? 'owner' : 'member',
            status: isFirstUser ? 'active' : 'pending',
            client_token: null, // 审核通过后生成
            created_at: new Date().toISOString()
          };

          if (isFirstUser) {
            newUser.client_token = db.generateToken();
            await db.linkTokenToUser(env, newUser.client_token, username);
          }

          await db.saveUser(env, username, newUser);
          return jsonResponse({ success: true, isFirstUser });
        }

        // --- 登录 ---
        if (path === "/api/auth/login" && method === "POST") {
          const { username, password } = body;
          const user = await db.getUser(env, username);
          
          if (!user) return jsonResponse({ error: "用户不存在或密码错误" }, 401);
          
          const inputHash = await db.hashPassword(password);
          if (inputHash !== user.password_hash) {
            return jsonResponse({ error: "用户不存在或密码错误" }, 401);
          }

          // 登录成功，下发 Session
          const sessionId = db.generateToken();
          await db.createSession(env, sessionId, username);

          return jsonResponse({ success: true, role: user.role, status: user.status }, 200, {
            'Set-Cookie': `session_id=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`
          });
        }

        // --- 登出 ---
        if (path === "/api/auth/logout" && method === "POST") {
          const cookies = parseCookies(request);
          if (cookies['session_id']) await db.deleteSession(env, cookies['session_id']);
          return jsonResponse({ success: true }, 200, {
            'Set-Cookie': `session_id=; HttpOnly; Path=/; Max-Age=0`
          });
        }
      }

      // ----------------------------------------
      // 4. 需要登录态的内部控制台接口 (Settings & Admin)
      // ----------------------------------------
      const currentUser = await getCurrentUser(request, env);
      if (!currentUser) return jsonResponse({ error: "未登录" }, 401);

      // --- 获取当前用户信息与状态 ---
      if (path === "/api/me" && method === "GET") {
        return jsonResponse({ 
          username: currentUser.username, 
          role: currentUser.role, 
          status: currentUser.status,
          client_token: currentUser.client_token 
        });
      }

      // 阻止未激活用户操作核心数据
      if (currentUser.status !== 'active') {
        return jsonResponse({ error: "账号审核中，限制访问" }, 403);
      }

      // --- 读写业务数据 ---
      if (path === "/api/settings") {
        if (method === "GET") {
          const sub_links = await db.getUserSubLinks(env, currentUser.username);
          let responseData = { sub_links };
          
          // 仅管理员返回全局配置
          if (currentUser.role === 'owner') {
            const globalConfig = await db.getGlobalConfig(env);
            responseData = { ...responseData, ...globalConfig };
          }
          return jsonResponse(responseData);
        }
        
        if (method === "POST") {
          const body = await request.json();
          // 所有活跃用户都可以保存自己的机场
          if (body.sub_links) {
            await db.saveUserSubLinks(env, currentUser.username, body.sub_links);
          }
          
          // ==========================================
          // 核心修复：让后端正确接收并保存 GitHub 仓储凭证
          // ==========================================
          if (currentUser.role === 'owner') {
            const { 
              REGION_KEYWORDS, BANNED_KEYWORDS, URLTEST_PARAMS, TEMPLATE_JSON,
              GITHUB_USER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN 
            } = body;
            
            const currentGlobal = await db.getGlobalConfig(env);
            
            await db.saveGlobalConfig(env, {
              REGION_KEYWORDS: REGION_KEYWORDS || currentGlobal.REGION_KEYWORDS,
              BANNED_KEYWORDS: BANNED_KEYWORDS || currentGlobal.BANNED_KEYWORDS,
              URLTEST_PARAMS: URLTEST_PARAMS || currentGlobal.URLTEST_PARAMS,
              TEMPLATE_JSON: TEMPLATE_JSON || currentGlobal.TEMPLATE_JSON,
              // 存入 GitHub 核心参数
              GITHUB_USER: GITHUB_USER || currentGlobal.GITHUB_USER,
              GITHUB_REPO: GITHUB_REPO || currentGlobal.GITHUB_REPO,
              GITHUB_BRANCH: GITHUB_BRANCH || currentGlobal.GITHUB_BRANCH,
              GITHUB_TOKEN: GITHUB_TOKEN !== undefined ? GITHUB_TOKEN : currentGlobal.GITHUB_TOKEN
            });
          }
          return jsonResponse({ success: true });
        }
      }

      // --- 超级管理员专属：用户审核接口 ---
      if (path.startsWith("/api/admin/") && currentUser.role === 'owner') {
        if (path === "/api/admin/users" && method === "GET") {
          const users = await db.listAllUsers(env);
          // 脱敏处理，不返回密码哈希
          const safeUsers = users.map(({ password_hash, ...u }) => u);
          return jsonResponse(safeUsers);
        }

        if (path === "/api/admin/approve" && method === "POST") {
          const { target_username } = await request.json();
          const targetUser = await db.getUser(env, target_username);
          if (targetUser && targetUser.status === 'pending') {
            targetUser.status = 'active';
            targetUser.client_token = db.generateToken();
            await db.saveUser(env, target_username, targetUser);
            await db.linkTokenToUser(env, targetUser.client_token, target_username);
            return jsonResponse({ success: true });
          }
          return jsonResponse({ error: "用户状态异常" }, 400);
        }
      }

      // 兜底路由
      return jsonResponse({ error: "Not Found" }, 404);

    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Internal Server Error", details: e.message }, 500);
    }
  }
};
