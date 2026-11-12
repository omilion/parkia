import tseslint from "typescript-eslint";

/**
 * Solo reglas de promesas: el acceso a datos es asincrono y una promesa sin esperar
 * (o un callback async donde no corresponde) es un error silencioso.
 */
export default tseslint.config({
  files: ["server/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "shared/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    "@typescript-eslint/no-floating-promises": ["error", {
      allowForKnownSafeCalls: [{ from: "package", name: ["test", "it", "describe", "before", "after"], package: "node:test" }, { from: "package", name: ["test"], package: "@playwright/test" }],
    }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
    "@typescript-eslint/await-thenable": "error",
  },
});
