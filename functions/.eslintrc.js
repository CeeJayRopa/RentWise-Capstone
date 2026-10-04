module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    // The Functions are maintained on both Windows and Linux. Keep lint
    // focused on correctness instead of rewriting working source solely for
    // Google-style formatting or a platform-specific newline convention.
    "linebreak-style": "off",
    "object-curly-spacing": "off",
    "quotes": "off",
    "max-len": "off",
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
    "operator-linebreak": "off",
    "quote-props": "off",
    "no-control-regex": "off",
    "@typescript-eslint/no-inferrable-types": "off",
    "import/no-unresolved": 0,
    "indent": "off",
  },
};
