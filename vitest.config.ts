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
    // On Windows, fork IPC can time out in `onTaskUpdate` after every assertion
    // has passed. One worker thread keeps the run deterministic and bounded
    // while avoiding that child-process transport failure.
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
