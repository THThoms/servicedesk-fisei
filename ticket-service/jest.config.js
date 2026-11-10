// Jest config para ticket-service.
// Los tests viven fuera de src/ para que `tsc` (build de producción) no los
// compile a dist/. ts-jest usa un tsconfig.test.json que sí los incluye.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
};
