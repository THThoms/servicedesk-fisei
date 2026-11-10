// Jest config para catalog-service.
// Mismo patrón que ticket-service: tests fuera de src/, ts-jest con un
// tsconfig.test.json dedicado, setup que define env vars antes de cargar app.
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
