import "dotenv/config";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // The psychometric suite performs deliberately large MAP simulations.
    // A single fork avoids Vitest's worker task-update timeout on Windows
    // while keeping the run deterministic and memory-bounded.
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
