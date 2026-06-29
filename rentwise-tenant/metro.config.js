const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Allow Metro to resolve files from the root shared/ folder
config.watchFolders = [monorepoRoot];

// When shared/ files import firebase/* or react-native, resolve from this module's node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
];

// Exclude Android and iOS build output from Metro's file watcher.
// Without this, native build artifacts cause scandir errors on Windows.
config.resolver.blockList = [
  /android[\\/]app[\\/]build\/.*/,
  /android[\\/]build\/.*/,
  /ios[\\/]build\/.*/,
  /ios[\\/]Pods\/.*/,
];

module.exports = config;
