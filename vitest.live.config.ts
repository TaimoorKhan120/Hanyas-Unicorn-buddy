import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Live-provider evaluations. Spends real money; needs ANTHROPIC_API_KEY and OPENAI_API_KEY.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["evals/**/*.eval.ts"], testTimeout: 120000, fileParallelism: false },
});
