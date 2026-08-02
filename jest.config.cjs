module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/test/setup/integration.cjs"],
  moduleFileExtensions: ["ts", "js"],
  moduleNameMapper: {
    "^(\\./[^.]+)\\.js$": "$1",
    "^(\\.\\./[^.]+)\\.js$": "$1",
  },
  forceExit: true,
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  globals: {
    "ts-jest": {
      tsconfig: "tsconfig.jest.json",
    },
  },
};