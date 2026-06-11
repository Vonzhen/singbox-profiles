/**
 * src/index.js
 * 主路由分发器与安全网关接口
 */

import { generateConfig } from './engine.js';
import { renderHTML } from './html.js';
import * as db from './db.js';

function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((res, c) => {
    const [key, val] = c.trim().split('=').map(decodeURIComponent);
    try { return Object.assign(res, { [key]: JSON.parse(val) }); } catch (e) { return Object.assign(res, { [key]: val }); }
  }, {});
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

async function getCurrentUser(request, env) {
  const cookies = parseCookies(request);
  const sessionId = cookies['session_id'];
  if (!sessionId) return null;
  
  const username = await db.getUserBySession(env, sessionId);
  if (!username) return null;
  
  const user = await db.getUser(env, username);
  return user ? { username, ...user } : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // 0. 屏蔽浏览器的无意义请求
      if (path === "/favicon.ico") return new Response(null, { status: 204 });

      // 1. 前端页面路由
      if (method === "GET" && path === "/") {
        return new Response(renderHTML(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // 2. 客户端订阅拉取接口 (纯 Token 鉴权)
      if (method === "GET" && path === "/api/generate") {
        const clientToken = url.searchParams.get("token");
        const isDebug = url.searchParams.get("debug") === "1";

        if (!clientToken) return new Response("Missing token", { status: 401 });

        const user = await db.getUserByClientToken(env, clientToken);
        if (!user || user.status !== 'active') {
          return new Response("Unauthorized or pending access", { status: 403 });
        }

        const userSubLinks = await db.getUserSubLinks(env, user.username);
        const globalConfig = await db.getGlobalConfig(env);

        return await generateConfig(userSubLinks, globalConfig, isDebug);
      }

      // 3. 登录与注册基础鉴权接口
      // 【核心修复】：精准匹配路由，避免空 POST 请求被错误解析
      if (path === "/api/auth/register" || path === "/api/auth/login" || path === "/api/auth/logout") {
        let body = {};
        if (method === "POST" && path !== "/api/auth/logout") {
          body = await request.json();
        }
        
        if (path === "/api/auth/register" && method === "POST") {
          const { username, password } = body;
          if (!username || !password) return jsonResponse({ error: "参数不完整" }, 400);
          
          const existingUser = await db.getUser(env, username);
          if (existingUser) return jsonResponse({ error: "用户已存在" }, 400);

          const allUsers = await db.listAllUsers(env);
          const isFirstUser = allUsers.length === 0;
          
          const newUser = {
            password_hash: await db.hashPassword(password),
            role: isFirstUser ? 'owner' : 'member',
            status: isFirstUser ? 'active' : 'pending',
            client_token: null, 
            created_at: new Date().toISOString()
          };

          if (isFirstUser) {
            newUser.client_token = db.generateToken();
            await db.linkTokenToUser(env, newUser.client_token, username);
          }

          await db.saveUser(env, username, newUser);
          return jsonResponse({ success: true, isFirstUser });
        }

        if (path === "/api/auth/login" && method === "POST") {
          const { username, password } = body;
          const user = await db.getUser(env, username);
          
          if (!user) return jsonResponse({ error: "用户不存在或密码错误" }, 401);
          
          const inputHash = await db.hashPassword(password);
          if (inputHash !== user.password_hash) {
            return jsonResponse({ error: "用户不存在或密码错误" }, 401);
          }

          const sessionId = db.generateToken();
          await db.createSession(env, sessionId, username);

          return jsonResponse({ success: true, role: user.role, status: user.status }, 200, {
            'Set-Cookie': `session_id=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`
          });
        }

        if (path === "/api/auth/logout" && method === "POST") {
          const cookies = parseCookies(request);
          if (cookies['session_id']) await db.deleteSession(env, cookies['session_id']);
          return jsonResponse({ success: true }, 200, {
            'Set-Cookie': `session_id=; HttpOnly; Path=/; Max-Age=0`
          });
        }
      }

      // ----------------------------------------
      // 4. 需要登录态的高级操作与控制台接口
      // ----------------------------------------
      const currentUser = await getCurrentUser(request, env);
      if (!currentUser) return jsonResponse({ error: "未登录" }, 401);

      // 【核心功能】：强力熔断旧 Token，换发新 Token
      if (path === "/api/auth/reset_token" && method === "POST") {
        const oldToken = currentUser.client_token;
        const newToken = db.generateToken();

        if (oldToken) await env.DB.delete(`token:${oldToken}`);

        const { username, ...userData } = currentUser;
        userData.client_token = newToken;
        await db.saveUser(env, username, userData);
        await db.linkTokenToUser(env, newToken, username);

        return jsonResponse({ success: true, client_token: newToken });
      }

      if (path === "/api/me" && method === "GET") {
        return jsonResponse({ 
          username: currentUser.username, 
          role: currentUser.role, 
          status: currentUser.status,
          client_token: currentUser.client_token 
        });
      }

      if (currentUser.status !== 'active') {
        return jsonResponse({ error: "账号审核中，限制访问" }, 403);
      }

      if (path === "/api/settings") {
        if (method === "GET") {
          const sub_links = await db.getUserSubLinks(env, currentUser.username);
          let responseData = { sub_links };
          
          if (currentUser.role === 'owner') {
            const globalConfig = await db.getGlobalConfig(env);
            responseData = { ...responseData, ...globalConfig };
          }
          return jsonResponse(responseData);
        }
        
        if (method === "POST") {
          const body = await request.json();
          if (body.sub_links) {
            await db.saveUserSubLinks(env, currentUser.username, body.sub_links);
          }
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
              GITHUB_USER: GITHUB_USER !== undefined ? GITHUB_USER : currentGlobal.GITHUB_USER,
              GITHUB_REPO: GITHUB_REPO !== undefined ? GITHUB_REPO : currentGlobal.GITHUB_REPO,
              GITHUB_BRANCH: GITHUB_BRANCH !== undefined ? GITHUB_BRANCH : currentGlobal.GITHUB_BRANCH,
              GITHUB_TOKEN: GITHUB_TOKEN !== undefined ? GITHUB_TOKEN : currentGlobal.GITHUB_TOKEN
            });
          }
          return jsonResponse({ success: true });
        }
      }

      if (path.startsWith("/api/admin/") && currentUser.role === 'owner') {
        if (path === "/api/admin/users" && method === "GET") {
          const users = await db.listAllUsers(env);
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

      return jsonResponse({ error: "Not Found" }, 404);

    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Internal Server Error", details: e.message }, 500);
    }
  }
};
