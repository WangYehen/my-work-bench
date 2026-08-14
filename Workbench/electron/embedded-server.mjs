import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workbenchApiPlugin } from "../server/vite-plugin-workbench.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "..", "dist", "client");
const DEFAULT_PORT = 5174;

// 解析简单的 KEY=VALUE 环境文件,保持与 vite loadEnv 相同语义(不展开引号内变量)。
function parseEnvFile(raw) {
  const entries = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    entries[key] = value;
  }
  return entries;
}

// 从 .env 读取打包版需要的配置(与 vite.config.mjs 的映射保持一致)。
function configFromEnv(env = {}) {
  const tokenKey = env.OUTLOOK_TOKEN_ENCRYPTION_KEY;
  return {
    vaultRoot: env.PERSONAL_DASHBOARD_VAULT_ROOT || null,
    outlookConfig: {
      tenantId: env.OUTLOOK_ENTRA_TENANT_ID || "common",
      clientId: env.OUTLOOK_ENTRA_CLIENT_ID,
      redirectUri: env.OUTLOOK_OAUTH_REDIRECT_URI,
      tokenEncryptionKey: tokenKey,
      deepseekApiKey: env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
      deepseekModel: env.DEEPSEEK_MODEL,
    },
    dingtalkConfig: {
      clientId: env.DINGTALK_CLIENT_ID,
      clientSecret: env.DINGTALK_CLIENT_SECRET,
      redirectUri: env.DINGTALK_OAUTH_REDIRECT_URI,
      tokenEncryptionKey: env.DINGTALK_TOKEN_ENCRYPTION_KEY || tokenKey,
      apiBaseUrl: env.DINGTALK_API_BASE_URL,
      authorizeUrl: env.DINGTALK_AUTHORIZE_URL,
      userId: env.DINGTALK_USER_ID,
      calendarId: env.DINGTALK_CALENDAR_ID,
    },
  };
}

// 依次尝试从多个位置加载 .env(打包版从 resourcesPath 与应用根目录读取)。
async function loadEnvFile(candidates = []) {
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = parseEnvFile(raw);
      if (Object.keys(parsed).length) return { path: candidate, env: parsed };
    } catch {
      // 该候选位置不存在,继续尝试下一处。
    }
  }
  return null;
}

const staticContentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// 提供 dist/client 下的静态资源;找不到时回退到 index.html(SPA)。
async function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") relativePath = "/index.html";
  const filePath = path.normalize(path.join(clientRoot, relativePath));
  if (!filePath.startsWith(clientRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    const type = staticContentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": body.byteLength });
    res.end(body);
  } catch {
    // SPA 回退:让前端路由接管。
    try {
      const body = await readFile(path.join(clientRoot, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.byteLength });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
}

// 启动内嵌 HTTP 服务:复用 workbenchApiPlugin 的中间件,并托管前端静态资源。
export async function startEmbeddedWorkbench({ env = process.env, port = DEFAULT_PORT, host = "127.0.0.1", dataDirectory, resourcesPath } = {}) {
  const fileEnv = await loadEnvFile([
    resourcesPath ? path.join(resourcesPath, ".env") : null,
    path.join(__dirname, "..", ".env"),
  ]);
  const mergedEnv = fileEnv ? { ...process.env, ...fileEnv.env, ...env } : { ...process.env, ...env };
  const options = configFromEnv(mergedEnv);
  const plugin = workbenchApiPlugin({
    vaultRoot: options.vaultRoot || undefined,
    outlookConfig: options.outlookConfig,
    dingtalkConfig: options.dingtalkConfig,
    dataDirectory,
  });

  let apiMiddleware = null;
  // 模拟最小 Vite server 对象,复用 configureServer 注册的中间件。
  plugin.configureServer({
    watcher: null,
    config: { logger: console },
    httpServer: { once: () => {} },
    middlewares: { use: (handler) => { apiMiddleware = handler; } },
  });

  if (!apiMiddleware) {
    throw new Error("workbenchApiPlugin 未注册 API 中间件。");
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      apiMiddleware(req, res, () => {
        res.writeHead(404);
        res.end(JSON.stringify({ error: { message: "API 路径不存在。" } }));
      });
      return;
    }
    void serveStatic(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return {
    server,
    close: () => new Promise((resolve) => { plugin.closeBundle?.().catch(() => {}); server.close(resolve); }),
  };
}
