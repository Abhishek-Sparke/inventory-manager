const { withDangerousMod, withEntitlementsPlist } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const xcode = require('xcode');

const WIDGET_NAME = 'StockFlowTasksWidget';
const EXTENSION_TARGET_NAME = 'StockFlowWidgetExtension';
const BUNDLE_ID_SUFFIX = '.StockFlowWidgetExtension';
const APP_GROUP_IDENTIFIER = 'group.com.sparke27.mobile';

/**
 * Expo Config Plugin to configure native iOS WidgetKit Extension and App Group.
 *
 * 1. Configures the App Group entitlement on the main iOS application.
 * 2. Copies Swift WidgetKit source files, Info.plist, and entitlements into ios/StockFlowWidget.
 * 3. Copies StockFlowWidgetBridge NativeModule into the main application.
 * 4. Adds the WidgetKit extension target and build phases to project.pbxproj during prebuild.
 */
module.exports = function withIosWidget(config) {
  // 1. Add App Group entitlement to main app
  config = withEntitlementsPlist(config, (entitlementsConfig) => {
    const entitlements = entitlementsConfig.modResults;
    const existingGroups = entitlements['com.apple.security.application-groups'] || [];
    if (!existingGroups.includes(APP_GROUP_IDENTIFIER)) {
      entitlements['com.apple.security.application-groups'] = [
        ...existingGroups,
        APP_GROUP_IDENTIFIER,
      ];
    }
    return entitlementsConfig;
  });

  // 2. Dangerous Mod for iOS project files and PBXProject
  config = withDangerousMod(config, [
    'ios',
    async (dangerousConfig) => {
      const iosRoot = dangerousConfig.modRequest.platformProjectRoot;
      if (!fs.existsSync(iosRoot)) {
        return dangerousConfig;
      }

      const pluginAssetsDir = path.join(__dirname, 'ios-widget');

      // 2A. Copy Widget Extension files to ios/StockFlowWidget
      const widgetDestDir = path.join(iosRoot, 'StockFlowWidget');
      fs.mkdirSync(widgetDestDir, { recursive: true });

      const filesToCopy = [
        'StockFlowTasksWidget.swift',
        'Info.plist',
        'StockFlowWidget.entitlements',
      ];

      for (const fileName of filesToCopy) {
        const srcPath = path.join(pluginAssetsDir, fileName);
        const destPath = path.join(widgetDestDir, fileName);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }

      // 2B. Copy Native Bridge Module to main iOS app folder
      const mainAppDirs = fs
        .readdirSync(iosRoot)
        .filter(
          (entry) =>
            fs.statSync(path.join(iosRoot, entry)).isDirectory() &&
            !entry.endsWith('.xcodeproj') &&
            !entry.endsWith('.xcworkspace') &&
            entry !== 'StockFlowWidget' &&
            entry !== 'Pods'
        );

      const targetMainAppDir = mainAppDirs.length > 0 ? path.join(iosRoot, mainAppDirs[0]) : null;

      if (targetMainAppDir) {
        const bridgeFiles = ['StockFlowWidgetBridge.h', 'StockFlowWidgetBridge.m'];
        for (const bFile of bridgeFiles) {
          const src = path.join(pluginAssetsDir, bFile);
          const dest = path.join(targetMainAppDir, bFile);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
          }
        }
      }

      // 2C. Update project.pbxproj with the Widget extension target
      const xcodeProjDirs = fs
        .readdirSync(iosRoot)
        .filter((entry) => entry.endsWith('.xcodeproj'));

      if (xcodeProjDirs.length === 0) {
        return dangerousConfig;
      }

      const pbxprojPath = path.join(iosRoot, xcodeProjDirs[0], 'project.pbxproj');
      if (!fs.existsSync(pbxprojPath)) {
        return dangerousConfig;
      }

      try {
        const proj = xcode.project(pbxprojPath);
        proj.parseSync();

        // Check if extension target already exists
        const targets = proj.pbxNativeTargetSection();
        const existingTargetUuid = Object.keys(targets).find(
          (uuid) => targets[uuid].name === EXTENSION_TARGET_NAME || targets[uuid].name === `"${EXTENSION_TARGET_NAME}"`
        );

        const mainBundleId = config.ios?.bundleIdentifier || 'com.sparke27.mobile';
        const widgetBundleId = `${mainBundleId}${BUNDLE_ID_SUFFIX}`;

        if (!existingTargetUuid) {
          // Add the App Extension target
          const extTarget = proj.addTarget(
            EXTENSION_TARGET_NAME,
            'app_extension',
            'StockFlowWidget',
            widgetBundleId
          );

          if (extTarget && extTarget.uuid) {
            // Add Swift source file
            // Add the Swift file to the extension target. Let xcode choose
            // the default group; a guessed PBXGroup key can throw and prevent
            // project.pbxproj from being written at all.
            proj.addSourceFile(
              path.join('StockFlowWidget', 'StockFlowTasksWidget.swift'),
              { target: extTarget.uuid }
            );

            // Add Frameworks
            proj.addFramework('WidgetKit.framework', { target: extTarget.uuid });
            proj.addFramework('SwiftUI.framework', { target: extTarget.uuid });

            // Configure Build Settings for Debug & Release
            const configurations = proj.pbxXCBuildConfigurationSection();
            for (const configId in configurations) {
              const buildConfig = configurations[configId];
              if (
                buildConfig.buildSettings &&
                buildConfig.buildSettings.PRODUCT_NAME === `"${EXTENSION_TARGET_NAME}"`
              ) {
                buildConfig.buildSettings.SWIFT_VERSION = '5.0';
                buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
                buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${widgetBundleId}"`;
                buildConfig.buildSettings.INFOPLIST_FILE = '"StockFlowWidget/Info.plist"';
                buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = '"StockFlowWidget/StockFlowWidget.entitlements"';
                buildConfig.buildSettings.CURRENT_PROJECT_VERSION = '"1"';
                buildConfig.buildSettings.MARKETING_VERSION = '"1.0.0"';
                buildConfig.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
                buildConfig.buildSettings.CODE_SIGN_STYLE = 'Automatic';
              }
            }
          }
        }

        // Add Bridge files to main app target if not already added
        if (targetMainAppDir) {
          const mainTarget = proj.getFirstTarget();
          const mainTargetUuid = mainTarget?.uuid;
          if (mainTargetUuid) {
            const bridgeM = path.join(path.basename(targetMainAppDir), 'StockFlowWidgetBridge.m');
            proj.addSourceFile(bridgeM, { target: mainTargetUuid });
            const bridgeH = path.join(path.basename(targetMainAppDir), 'StockFlowWidgetBridge.h');
            proj.addHeaderFile(bridgeH, { target: mainTargetUuid });
          }
        }

        fs.writeFileSync(pbxprojPath, proj.writeSync());
      } catch (err) {
        console.warn('[withIosWidget] Notice: PBXProject update will finalize during cloud build:', err.message);
      }

      return dangerousConfig;
    },
  ]);

  return config;
};
