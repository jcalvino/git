import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@real-estate/shared": resolve(here, "../shared/src/index.ts"),
    },
  },
  test: {
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
