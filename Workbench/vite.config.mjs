import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApiPlugin } from "./server/vite-plugin-workbench.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    cacheDir: env.VITE_CACHE_DIR || "node_modules/.vite",
    build: {
      outDir: "dist/client",
      emptyOutDir: false,
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      // OAuth redirects must match the fixed loopback callback registered in Entra.
      host: "127.0.0.1",
      port: Number(env.WORKBENCH_PORT || 5174),
      strictPort: true,
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [
      react(),
      workbenchApiPlugin({
        vaultRoot: env.PERSONAL_DASHBOARD_VAULT_ROOT,
        outlookConfig: {
          // Optional: leave unset for the multi-tenant Microsoft sign-in endpoint.
          tenantId: env.OUTLOOK_ENTRA_TENANT_ID || "common",
          clientId: env.OUTLOOK_ENTRA_CLIENT_ID,
          redirectUri: env.OUTLOOK_OAUTH_REDIRECT_URI,
          tokenEncryptionKey: env.OUTLOOK_TOKEN_ENCRYPTION_KEY,
          deepseekApiKey: env.DEEPSEEK_API_KEY,
          deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
          deepseekModel: env.DEEPSEEK_MODEL,
        },
        dingtalkConfig: {
          clientId: env.DINGTALK_CLIENT_ID,
          clientSecret: env.DINGTALK_CLIENT_SECRET,
          redirectUri: env.DINGTALK_OAUTH_REDIRECT_URI,
          tokenEncryptionKey: env.DINGTALK_TOKEN_ENCRYPTION_KEY || env.OUTLOOK_TOKEN_ENCRYPTION_KEY,
          apiBaseUrl: env.DINGTALK_API_BASE_URL,
          authorizeUrl: env.DINGTALK_AUTHORIZE_URL,
          userId: env.DINGTALK_USER_ID,
          calendarId: env.DINGTALK_CALENDAR_ID,
        },
        teamReportApiUrl: env.VITE_TEAM_REPORT_API_URL || "http://127.0.0.1:8787",
      }),
    ],
  };
});
