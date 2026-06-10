import { generateConfig } from './engine.js';
import { renderHTML } from './html.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 路由 1：访问根目录，吐出可是化管理网页
    if (request.method === "GET" && path === "/") {
      return new Response(renderHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 路由 2：网页前端请求或保存 KV 配置
    if (path === "/api/settings") {
      // 校验网页传来的密码 (需要在 headers 或 url 里带上鉴权)
      // 为简化演示，具体鉴权逻辑在前端交互时处理
      if (request.method === "GET") {
        const settings = await env.DB.get("app_settings", { type: "json" }) || {};
        return new Response(JSON.stringify(settings), { headers: { "Content-Type": "application/json" } });
      }
      
      if (request.method === "POST") {
        const newData = await request.json();
        await env.DB.put("app_settings", JSON.stringify(newData));
        return new Response(JSON.stringify({ success: true, msg: "配置已保存至云端 KV" }));
      }
    }

    // 路由 3：Sing-Box 客户端拉取配置 (核心)
    if (request.method === "GET" && path === "/api/generate") {
      const clientToken = url.searchParams.get("token");
      const isDebug = url.searchParams.get("debug") === "1";
      
      // 调用解耦后的核心引擎
      return await generateConfig(env, clientToken, isDebug);
    }

    // 兜底路由
    return new Response("Not Found", { status: 404 });
  }
};
