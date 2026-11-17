import { defineConfig } from "vitest/config";
import path from "node:path";

// Runs against the dev database (npm run db:dev must be running).
// Each test file creates and removes its own business; it never touches other data.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["dotenv/config"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
