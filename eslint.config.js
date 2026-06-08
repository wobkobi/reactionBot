// eslint.config.js
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import jsdoc from "eslint-plugin-jsdoc";
import prettierPlugin from "eslint-plugin-prettier/recommended";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "build/**",
    "dist/**",
    "node_modules/**",
    "eslint.config.js",
    "prettier.config.ts",
  ]),

  // ESLint + TypeScript-ESLint recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // JSDoc baseline tuned for TypeScript (reported as errors)
  jsdoc.configs["flat/recommended-typescript-error"],

  // Project rules (Node, TypeScript bot - no browser/React)
  {
    files: ["src/**/*.{js,ts}", "scripts/**/*.{js,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      // TS hygiene
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/consistent-type-definitions": "error",

      // JSDoc enforcement - only on named declarations/methods, not inline
      // callbacks (collectors, .map/.catch, etc. are full of arrow functions).
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            FunctionExpression: false,
            ArrowFunctionExpression: false,
          },
        },
      ],
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-description": "error",
      // Types come from TypeScript, not JSDoc tags
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/require-throws-type": "off",
    },
  },

  // Disable stylistic rules that clash with Prettier, then surface Prettier
  // violations through ESLint.
  prettier,
  prettierPlugin,
]);
