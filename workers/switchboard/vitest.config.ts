// workers/switchboard/vitest.config.ts
import { defineConfig } from "vitest/config";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "../../wrangler.toml" },
        miniflare: {
          compatibilityDate: "2024-09-23",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            GEMINI_API_KEY: "test-gemini-key",
            SUPABASE_URL: "https://test.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
            FOUNDRY_API_URL: "https://test.foundry.ai",
            FOUNDRY_API_KEY: "test-foundry-key",
            WORKER_HMAC_SECRET: "test-hmac-secret-32chars-padded!",
            ENVIRONMENT: "test",
          },
        },
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // integration-level, covered by smoke tests
    },
  },
});
