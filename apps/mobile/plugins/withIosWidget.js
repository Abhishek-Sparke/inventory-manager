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

      console.log('[withIosWidget] Updating Xcode project:', pbxprojPath);
      const proj = xcode.project(pbxprojPath);
      proj.parseSync();

      // Ensure 'Plugins' group exists defensively so node-xcode internals never fail with null path
      if (!proj.pbxGroupByName('Plugins')) {
        proj.addPbxGroup([], 'Plugins', 'Plugins');
      }

      const targets = proj.pbxNativeTargetSection();
      const existingTargetUuid = Object.keys(targets).find(
        (uuid) =>
          targets[uuid].name === EXTENSION_TARGET_NAME ||
          targets[uuid].name === `"${EXTENSION_TARGET_NAME}"`
      );

      const mainBundleId = config.ios?.bundleIdentifier || 'com.sparke27.mobile';
      const widgetBundleId = `${mainBundleId}${BUNDLE_ID_SUFFIX}`;
      let targetUuid = existingTargetUuid;

      if (!targetUuid) {
        console.log('[withIosWidget] Creating target:', EXTENSION_TARGET_NAME);
        const extTarget = proj.addTarget(
          EXTENSION_TARGET_NAME,
          'app_extension',
          'StockFlowWidget',
          widgetBundleId
        );
        targetUuid = extTarget?.uuid;
      }

      if (!targetUuid) {
        throw new Error(`xcode package did not create target ${EXTENSION_TARGET_NAME}`);
      }

      // Add essential build phases to the extension target if missing
      const nativeTarget = proj.pbxNativeTargetSection()[targetUuid];
      const hasPhase = (comment) =>
        (nativeTarget.buildPhases || []).some((bp) => bp.comment === comment);

      if (!hasPhase('Sources')) {
        proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
      }
      if (!hasPhase('Frameworks')) {
        proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
      }
      if (!hasPhase('Resources')) {
        proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid);
      }

      // Resolve main application group and widget PBXGroup
      const firstTarget = proj.getFirstTarget();
      const firstTargetName = (firstTarget?.firstTarget?.name || firstTarget?.name || '').replace(/"/g, '');
      const mainAppGroupName = targetMainAppDir ? path.basename(targetMainAppDir) : 'mobile';
      const rootMainGroupKey = proj.getFirstProject()?.firstProject?.mainGroup;

      const mainAppGroupKey =
        (firstTargetName ? proj.findPBXGroupKey({ name: firstTargetName }) : null) ||
        (firstTargetName ? proj.findPBXGroupKey({ path: firstTargetName }) : null) ||
        proj.findPBXGroupKey({ name: mainAppGroupName }) ||
        proj.findPBXGroupKey({ path: mainAppGroupName }) ||
        rootMainGroupKey;

      let widgetGroupKey = proj.findPBXGroupKey({ name: 'StockFlowWidget' });
      if (!widgetGroupKey) {
        const createdGroup = proj.addPbxGroup([], 'StockFlowWidget', 'StockFlowWidget');
        const parentGroupKey = mainAppGroupKey || rootMainGroupKey;
        if (!createdGroup?.uuid || !parentGroupKey) {
          throw new Error('Could not create or locate the StockFlowWidget PBXGroup');
        }
        proj.addToPbxGroup(createdGroup.uuid, parentGroupKey);
        widgetGroupKey = proj.findPBXGroupKey({ name: 'StockFlowWidget' }) || createdGroup.uuid;
      }
      if (!widgetGroupKey) {
        throw new Error('Could not resolve StockFlowWidget PBXGroup key');
      }

      // Add widget Swift source file to extension target
      const widgetGroupObj = proj.getPBXGroupByKey(widgetGroupKey);
      const widgetSwiftRel = widgetGroupObj && widgetGroupObj.path
        ? 'StockFlowTasksWidget.swift'
        : ['StockFlowWidget', 'StockFlowTasksWidget.swift'].join('/');

      if (!proj.hasFile(widgetSwiftRel)) {
        proj.addSourceFile(
          widgetSwiftRel,
          { target: targetUuid },
          widgetGroupKey
        );
      }

      proj.addFramework('WidgetKit.framework', { target: targetUuid });
      proj.addFramework('SwiftUI.framework', { target: targetUuid });

      const configurations = proj.pbxXCBuildConfigurationSection();
      for (const configId in configurations) {
        const buildConfig = configurations[configId];
        const productName = String(buildConfig.buildSettings?.PRODUCT_NAME || '').replace(/"/g, '');
        if (productName === EXTENSION_TARGET_NAME) {
          buildConfig.buildSettings.SWIFT_VERSION = '5.0';
          buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
          buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${widgetBundleId}"`;
          buildConfig.buildSettings.INFOPLIST_FILE = '"StockFlowWidget/Info.plist"';
          buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = '"StockFlowWidget/StockFlowWidget.entitlements"';
          buildConfig.buildSettings.CURRENT_PROJECT_VERSION = '"1"';
          buildConfig.buildSettings.MARKETING_VERSION = '"1.0.0"';
          buildConfig.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
          buildConfig.buildSettings.CODE_SIGN_STYLE = 'Automatic';
          buildConfig.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
          buildConfig.buildSettings.SKIP_INSTALL = 'YES';
        }
      }

      // Add bridge files to the main app target with explicit group
      if (targetMainAppDir) {
        const mainTarget = proj.getFirstTarget();
        const mainTargetUuid = mainTarget?.uuid;
        if (mainTargetUuid) {
          const mainAppGroupObj = proj.getPBXGroupByKey(mainAppGroupKey);
          const bridgeRelM = mainAppGroupObj && mainAppGroupObj.path
            ? 'StockFlowWidgetBridge.m'
            : [mainAppGroupName, 'StockFlowWidgetBridge.m'].join('/');
          const bridgeRelH = mainAppGroupObj && mainAppGroupObj.path
            ? 'StockFlowWidgetBridge.h'
            : [mainAppGroupName, 'StockFlowWidgetBridge.h'].join('/');

          if (!proj.hasFile(bridgeRelM)) {
            proj.addSourceFile(
              bridgeRelM,
              { target: mainTargetUuid },
              mainAppGroupKey
            );
          }
          if (!proj.hasFile(bridgeRelH)) {
            proj.addHeaderFile(
              bridgeRelH,
              { target: mainTargetUuid },
              mainAppGroupKey
            );
          }
          proj.addFramework('WidgetKit.framework', { target: mainTargetUuid });
        }
      }

      fs.writeFileSync(pbxprojPath, proj.writeSync());
      const savedProject = fs.readFileSync(pbxprojPath, 'utf8');
      if (!savedProject.includes(EXTENSION_TARGET_NAME)) {
        throw new Error(`Saved project is missing ${EXTENSION_TARGET_NAME}`);
      }
      console.log('[withIosWidget] Successfully saved widget target:', EXTENSION_TARGET_NAME);

      return dangerousConfig;
    },
  ]);

  return config;
};
