import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // El projecte fa servir «void expr» per a promeses de foc-i-oblidà
      // auditades; no cal el plugin sencer de no-floating-promises.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "scripts/mapa-src/**",
      ".pgdata/**",
      // Fitxer generat per Next: no el llencem ni el linter.
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
