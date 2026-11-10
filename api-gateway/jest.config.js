// Jest config para api-gateway (Fase T). Tests fuera de src/.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: { "^.+\.ts$": ["ts-jest", { tsconfig: { esModuleInterop: true, target: "ES2022", module: "commonjs" } }] },
};
