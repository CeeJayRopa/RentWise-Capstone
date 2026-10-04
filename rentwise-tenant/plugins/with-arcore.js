const {
  AndroidConfig,
  withAndroidManifest,
  withGradleProperties,
  withProjectBuildGradle,
} = require("expo/config-plugins");

const kotlinVersion = "2.3.20";

module.exports = function withArCore(config) {
  config = AndroidConfig.Permissions.withPermissions(config, ["android.permission.CAMERA"]);

  config = withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    manifest["uses-feature"] = manifest["uses-feature"] || [];
    if (!manifest["uses-feature"].some((feature) => feature.$?.["android:name"] === "android.hardware.camera.ar")) {
      manifest["uses-feature"].push({
        $: {
          "android:name": "android.hardware.camera.ar",
          "android:required": "false",
        },
      });
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(configWithManifest.modResults);
    application["meta-data"] = application["meta-data"] || [];
    const existing = application["meta-data"].find((item) => item.$?.["android:name"] === "com.google.ar.core");
    if (existing) {
      existing.$["android:value"] = "optional";
    } else {
      application["meta-data"].push({
        $: {
          "android:name": "com.google.ar.core",
          "android:value": "optional",
        },
      });
    }

    return configWithManifest;
  });

  config = withProjectBuildGradle(config, (configWithGradle) => {
    const composePlugin = `classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:${kotlinVersion}")`;
    const kotlinPlugin = `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlinVersion}")`;
    const kotlinPluginPattern =
      /^\s*classpath\(["']org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^"']+)?["']\)\s*$/gm;
    const composePluginPattern =
      /^\s*classpath\(["']org\.jetbrains\.kotlin:compose-compiler-gradle-plugin:[^"']+["']\)\s*$/gm;

    configWithGradle.modResults.contents = configWithGradle.modResults.contents
      .replace(kotlinPluginPattern, `    ${kotlinPlugin}`)
      .replace(composePluginPattern, "")
      .replace(/\n{3,}/g, "\n\n");

    if (!configWithGradle.modResults.contents.includes(kotlinPlugin)) {
      throw new Error("Unable to add the Kotlin Compose compiler plugin to the Android buildscript.");
    }

    configWithGradle.modResults.contents = configWithGradle.modResults.contents.replace(
      kotlinPlugin,
      `${kotlinPlugin}\n    ${composePlugin}`,
    );

    return configWithGradle;
  });

  config = withGradleProperties(config, (configWithProperties) => {
    const existing = configWithProperties.modResults.find(
      (item) => item.type === "property" && item.key === "android.kotlinVersion",
    );

    if (existing) {
      existing.value = kotlinVersion;
    } else {
      configWithProperties.modResults.push({
        type: "property",
        key: "android.kotlinVersion",
        value: kotlinVersion,
      });
    }

    return configWithProperties;
  });

  return config;
};
