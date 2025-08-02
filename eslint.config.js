import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import jsdoc from "eslint-plugin-jsdoc";
import prettier from "eslint-plugin-prettier";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compat wrapper to merge ESLint’s recommended configs
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  // Ignore patterns entirely
  { ignores: ["**/node_modules/**", "build/**", "dist/**"] },

  // JSDoc recommended rules for TypeScript (report as errors)
  jsdoc.configs["flat/recommended-typescript-error"],

  // ESLint, TypeScript-ESLint, and Prettier recommended rules
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ),

  // Project-specific overrides
  {
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
      jsdoc,
    },

    settings: {
      // Resolve imports for these extensions
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"],
        },
      },
      jsdoc: {
        mode: "typescript",
      },
    },

    rules: {
      // No unused variables
      "@typescript-eslint/no-unused-vars": "error",

      // Prettier formatting enforcement
      "prettier/prettier": ["error", { endOfLine: "crlf" }],
      "linebreak-style": ["error", "windows"],

      // Consistent type definitions
      "@typescript-eslint/consistent-type-definitions": "error",

      // JSDoc enforcement rules
      "jsdoc/require-jsdoc": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",
    },
  },
];
