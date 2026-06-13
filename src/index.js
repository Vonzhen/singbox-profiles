/**
 * src/index.js
 * 主路由分发器与安全网关接口
 */

import { generateConfig, getTemplate, getTemplateCacheStatus, testSubscription } from './engine.js';
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

function withSecretConfig(env, globalConfig) {
  const { GITHUB_TOKEN, ...safeConfig } = globalConfig || {};
  return {
    ...safeConfig,
    GITHUB_TOKEN: env.GITHUB_TOKEN || ""
  };
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
        let isDebug = url.searchParams.get("debug") === "1";

        if (!clientToken) return new Response("Missing token", { status: 401 });

        const user = await db.getUserByClientToken(env, clientToken);
        if (!user || user.status !== 'active') {
          return new Response("Unauthorized or pending access", { status: 403 });
        }
        isDebug = isDebug && user.role === 'owner';

        const userSubLinks = await db.getUserSubLinks(env, user.username);
        const globalConfig = withSecretConfig(env, await db.getGlobalConfig(env));

        const response = await generateConfig(userSubLinks, globalConfig, isDebug, env);
        if (!isDebug && response.ok) {
          const configText = await response.clone().text();
          await db.saveCachedConfig(env, user.username, configText);
          await db.saveGenerationStatus(env, user.username, {
            status: "success",
            source: "live",
            message: "配置生成成功",
            size: configText.length
          });
        }
        if (!isDebug && !response.ok) {
          const cached = await db.getCachedConfig(env, user.username);
          if (cached) {
            await db.saveGenerationStatus(env, user.username, {
              status: "warning",
              source: "cache",
              message: "生成失败，已返回最近一次成功配置",
              size: cached.length
            });
            return new Response(cached, {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "X-Config-Cache": "HIT",
                "Warning": "110 - Generated from last successful config"
              }
            });
          }
          const errorBody = await response.clone().json().catch(() => ({}));
          await db.saveGenerationStatus(env, user.username, {
            status: "error",
            source: "live",
            message: errorBody.error || "配置生成失败",
            size: 0
          });
        }

        return response;
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
            created_at: new Date().toISOString(),
            token_updated_at: null
          };

          if (isFirstUser) {
            newUser.client_token = db.generateToken();
            newUser.token_updated_at = new Date().toISOString();
            await db.linkTokenToUser(env, newUser.client_token, username);
          }

          await db.saveUser(env, username, newUser);
          return jsonResponse({ success: true, isFirstUser });
        }

        if (path === "/api/auth/login" && method === "POST") {
          const { username, password } = body;
          const user = await db.getUser(env, username);
          
          if (!user) return jsonResponse({ error: "用户不存在或密码错误" }, 401);
          
          const passwordOk = await db.verifyPassword(password, user.password_hash);
          if (!passwordOk) {
            return jsonResponse({ error: "用户不存在或密码错误" }, 401);
          }

          if (!user.password_hash.startsWith("pbkdf2$")) {
            user.password_hash = await db.hashPassword(password);
            await db.saveUser(env, username, user);
          }

          const sessionId = db.generateToken();
          await db.createSession(env, sessionId, username);

          return jsonResponse({ success: true, role: user.role, status: user.status }, 200, {
            'Set-Cookie': `session_id=${sessionId}; HttpOnly; Secure; Path=/; Max-Age=86400; SameSite=Strict`
          });
        }

        if (path === "/api/auth/logout" && method === "POST") {
          const cookies = parseCookies(request);
          if (cookies['session_id']) await db.deleteSession(env, cookies['session_id']);
          return jsonResponse({ success: true }, 200, {
            'Set-Cookie': `session_id=; HttpOnly; Secure; Path=/; Max-Age=0`
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
        userData.token_updated_at = new Date().toISOString();
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

      if (path === "/api/dashboard" && method === "GET") {
        const subLinks = await db.getUserSubLinks(env, currentUser.username);
        const enabledSubs = subLinks.filter(s => s.enabled && s.url);
        const cacheData = await db.getCachedConfigWithMetadata(env, currentUser.username);
        const generationStatus = await db.getGenerationStatus(env, currentUser.username);
        let templateStatus = null;
        let pendingUsers = 0;
        let totalUsers = 0;

        if (currentUser.role === 'owner') {
          const globalConfig = withSecretConfig(env, await db.getGlobalConfig(env));
          templateStatus = await getTemplateCacheStatus(env, globalConfig);
          const users = await db.listAllUsers(env);
          totalUsers = users.length;
          pendingUsers = users.filter(u => u.status === 'pending').length;
        }

        return jsonResponse({
          user: {
            username: currentUser.username,
            role: currentUser.role,
            status: currentUser.status,
            has_client_token: !!currentUser.client_token
          },
          subscriptions: {
            total: subLinks.length,
            enabled: enabledSubs.length
          },
          cache: {
            has_config: !!cacheData.value,
            updated_at: cacheData.metadata?.updated_at || null,
            size: cacheData.value ? cacheData.value.length : 0
          },
          generation: generationStatus,
          template: templateStatus,
          admin: currentUser.role === 'owner' ? { total_users: totalUsers, pending_users: pendingUsers } : null
        });
      }

      if (path === "/api/settings") {
        if (method === "GET") {
          const sub_links = await db.getUserSubLinks(env, currentUser.username);
          let responseData = { sub_links };
          
          if (currentUser.role === 'owner') {
            const globalConfig = await db.getGlobalConfig(env);
            const { GITHUB_TOKEN, ...safeGlobalConfig } = globalConfig;
            responseData = { ...responseData, ...safeGlobalConfig };
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
              GITHUB_USER, GITHUB_REPO, GITHUB_BRANCH
            } = body;
            const currentGlobal = await db.getGlobalConfig(env);
            await db.saveGlobalConfig(env, {
              REGION_KEYWORDS: REGION_KEYWORDS || currentGlobal.REGION_KEYWORDS,
              BANNED_KEYWORDS: BANNED_KEYWORDS || currentGlobal.BANNED_KEYWORDS,
              URLTEST_PARAMS: URLTEST_PARAMS || currentGlobal.URLTEST_PARAMS,
              TEMPLATE_JSON: TEMPLATE_JSON || currentGlobal.TEMPLATE_JSON,
              GITHUB_USER: GITHUB_USER !== undefined ? GITHUB_USER : currentGlobal.GITHUB_USER,
              GITHUB_REPO: GITHUB_REPO !== undefined ? GITHUB_REPO : currentGlobal.GITHUB_REPO,
              GITHUB_BRANCH: GITHUB_BRANCH !== undefined ? GITHUB_BRANCH : currentGlobal.GITHUB_BRANCH
            });
          }
          return jsonResponse({ success: true });
        }
      }

      if (path.startsWith("/api/template/") && currentUser.role === 'owner') {
        const globalConfig = withSecretConfig(env, await db.getGlobalConfig(env));

        if (path === "/api/template/status" && method === "GET") {
          return jsonResponse(await getTemplateCacheStatus(env, globalConfig));
        }

        if (path === "/api/template/check" && method === "POST") {
          const result = await getTemplate(env, globalConfig, { forceRefresh: false });
          const { config, ...safeResult } = result;
          return jsonResponse(safeResult.status, safeResult.status.ok ? 200 : 500);
        }

        if (path === "/api/template/refresh" && method === "POST") {
          const result = await getTemplate(env, globalConfig, { forceRefresh: true });
          const { config, ...safeResult } = result;
          return jsonResponse(safeResult.status, safeResult.status.ok ? 200 : 500);
        }
      }

      if (path === "/api/subscription/test" && method === "POST") {
        const body = await request.json();
        const globalConfig = withSecretConfig(env, await db.getGlobalConfig(env));
        return jsonResponse(await testSubscription(body.subscription, globalConfig));
      }

      if (path.startsWith("/api/admin/") && currentUser.role === 'owner') {
        if (path === "/api/admin/users" && method === "GET") {
          const users = await db.listAllUsers(env);
          const safeUsers = await Promise.all(users.map(async ({ password_hash, ...u }) => {
            const subLinks = await db.getUserSubLinks(env, u.username);
            const generation = await db.getGenerationStatus(env, u.username);
            return {
              ...u,
              sub_count: subLinks.length,
              enabled_sub_count: subLinks.filter(s => s.enabled && s.url).length,
              generation
            };
          }));
          return jsonResponse(safeUsers);
        }

        if (path === "/api/admin/approve" && method === "POST") {
          const { target_username } = await request.json();
          const targetUser = await db.getUser(env, target_username);
          if (targetUser && targetUser.status === 'pending') {
            targetUser.status = 'active';
            targetUser.client_token = db.generateToken();
            targetUser.token_updated_at = new Date().toISOString();
            await db.saveUser(env, target_username, targetUser);
            await db.linkTokenToUser(env, targetUser.client_token, target_username);
            return jsonResponse({ success: true });
          }
          return jsonResponse({ error: "用户状态异常" }, 400);
        }

        if (path === "/api/admin/reject" && method === "POST") {
          const { target_username } = await request.json();
          const targetUser = await db.getUser(env, target_username);
          if (targetUser && targetUser.status === 'pending') {
            await db.deleteUser(env, target_username);
            return jsonResponse({ success: true });
          }
          return jsonResponse({ error: "用户状态异常" }, 400);
        }

        if ((path === "/api/admin/disable" || path === "/api/admin/enable") && method === "POST") {
          const { target_username } = await request.json();
          if (target_username === currentUser.username) return jsonResponse({ error: "不能操作当前登录的 owner 账号" }, 400);
          const targetUser = await db.getUser(env, target_username);
          if (!targetUser) return jsonResponse({ error: "用户不存在" }, 404);
          targetUser.status = path === "/api/admin/disable" ? "disabled" : "active";
          await db.saveUser(env, target_username, targetUser);
          return jsonResponse({ success: true });
        }

        if (path === "/api/admin/reset_token" && method === "POST") {
          const { target_username } = await request.json();
          const targetUser = await db.getUser(env, target_username);
          if (!targetUser) return jsonResponse({ error: "用户不存在" }, 404);
          if (targetUser.client_token) await env.DB.delete(`token:${targetUser.client_token}`);
          targetUser.client_token = db.generateToken();
          targetUser.token_updated_at = new Date().toISOString();
          await db.saveUser(env, target_username, targetUser);
          await db.linkTokenToUser(env, targetUser.client_token, target_username);
          return jsonResponse({ success: true, client_token: targetUser.client_token });
        }

        if (path === "/api/admin/delete" && method === "POST") {
          const { target_username } = await request.json();
          if (target_username === currentUser.username) return jsonResponse({ error: "不能删除当前登录的 owner 账号" }, 400);
          const targetUser = await db.getUser(env, target_username);
          if (!targetUser) return jsonResponse({ error: "用户不存在" }, 404);
          await db.deleteUser(env, target_username);
          return jsonResponse({ success: true });
        }
      }

      return jsonResponse({ error: "Not Found" }, 404);

    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Internal Server Error", details: e.message }, 500);
    }
  }
};
