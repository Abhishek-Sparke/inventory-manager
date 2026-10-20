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
 * 2. Pre-configures EAS Build experimental appExtensions for multi-target codesigning.
 * 3. Copies Swift WidgetKit source files, Info.plist, and entitlements into ios/StockFlowWidget.
 * 4. Copies StockFlowWidgetBridge NativeModule into the main application.
 * 5. Adds the WidgetKit extension target, Target Dependency, and Embed App Extensions
 *    PBXCopyFilesBuildPhase to project.pbxproj during prebuild.
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

  // 1B. Configure EAS Build appExtensions for multi-target codesigning & provisioning
  const mainBundleId = config.ios?.bundleIdentifier || 'com.sparke27.mobile';
  const widgetBundleId = `${mainBundleId}${BUNDLE_ID_SUFFIX}`;

  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.build = config.extra.eas.build || {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental || {};
  config.extra.eas.build.experimental.ios = config.extra.eas.build.experimental.ios || {};
  const currentAppExtensions = config.extra.eas.build.experimental.ios.appExtensions || [];
  if (!currentAppExtensions.some((ext) => ext.targetName === EXTENSION_TARGET_NAME)) {
    config.extra.eas.build.experimental.ios.appExtensions = [
      ...currentAppExtensions,
      {
        targetName: EXTENSION_TARGET_NAME,
        bundleIdentifier: widgetBundleId,
        entitlements: {
          'com.apple.security.application-groups': [APP_GROUP_IDENTIFIER],
        },
      },
    ];
  }

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

      // Explicitly resolve the main application host target (type com.apple.product-type.application)
      const mainTargetUuid =
        Object.keys(targets).find((uuid) => {
          if (uuid.endsWith('_comment')) return false;
          const t = targets[uuid];
          return (
            t.productType === '"com.apple.product-type.application"' ||
            t.productType === 'com.apple.product-type.application' ||
            t.name === 'mobile' ||
            t.name === '"mobile"'
          );
        }) || proj.getFirstTarget()?.uuid;

      if (!mainTargetUuid) {
        throw new Error('Could not locate main application target in Xcode project');
      }
      const mainTarget = targets[mainTargetUuid];

      const existingTargetUuid = Object.keys(targets).find(
        (uuid) =>
          targets[uuid].name === EXTENSION_TARGET_NAME ||
          targets[uuid].name === `"${EXTENSION_TARGET_NAME}"`
      );

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

      // Ensure Target Dependency from host app to WidgetKit extension
      const targetDeps = proj.hash.project.objects['PBXTargetDependency'] || {};
      const hasDep = (mainTarget.dependencies || []).some((dep) => {
        const depObj = targetDeps[dep.value];
        return (
          depObj &&
          (depObj.target === targetUuid ||
            depObj.remoteInfo === `"${EXTENSION_TARGET_NAME}"` ||
            depObj.remoteInfo === EXTENSION_TARGET_NAME)
        );
      });

      if (!hasDep) {
        console.log('[withIosWidget] Adding Target Dependency to main app target:', EXTENSION_TARGET_NAME);
        proj.addTargetDependency(mainTargetUuid, [targetUuid]);
      }

      // Ensure Embed App Extensions PBXCopyFilesBuildPhase on host application target
      const copyFilesPhases = proj.hash.project.objects['PBXCopyFilesBuildPhase'] || {};
      let embedPhaseUuid = null;

      for (const phaseId in copyFilesPhases) {
        if (phaseId.endsWith('_comment')) continue;
        const phase = copyFilesPhases[phaseId];
        if (
          phase.dstSubfolderSpec === 13 ||
          phase.name === '"Embed App Extensions"' ||
          phase.name === 'Embed App Extensions' ||
          phase.name === '"Copy Files"'
        ) {
          embedPhaseUuid = phaseId;
          break;
        }
      }

      if (!embedPhaseUuid) {
        console.log('[withIosWidget] Creating Embed App Extensions build phase on main target...');
        const newPhase = proj.addBuildPhase(
          [],
          'PBXCopyFilesBuildPhase',
          'Embed App Extensions',
          mainTargetUuid,
          'app_extension'
        );
        embedPhaseUuid = newPhase.uuid;
      }

      const embedPhase = copyFilesPhases[embedPhaseUuid];
      embedPhase.name = '"Embed App Extensions"';
      copyFilesPhases[`${embedPhaseUuid}_comment`] = 'Embed App Extensions';
      embedPhase.dstSubfolderSpec = 13;
      embedPhase.dstPath = '""';

      // Ensure main target buildPhases array references this phase with proper comment
      const phaseRef = (mainTarget.buildPhases || []).find((bp) => bp.value === embedPhaseUuid);
      if (phaseRef) {
        phaseRef.comment = 'Embed App Extensions';
      } else {
        mainTarget.buildPhases = mainTarget.buildPhases || [];
        mainTarget.buildPhases.push({
          value: embedPhaseUuid,
          comment: 'Embed App Extensions',
        });
      }

      // Ensure product file StockFlowWidgetExtension.appex is embedded with RemoveHeadersOnCopy
      const appexName = `${EXTENSION_TARGET_NAME}.appex`;
      embedPhase.files = embedPhase.files || [];
      let appexBuildFileKey = embedPhase.files.find((f) => {
        const bf = proj.hash.project.objects['PBXBuildFile']?.[f.value];
        return (
          bf &&
          (f.comment?.includes(appexName) ||
            bf.fileRef_comment?.includes(appexName) ||
            bf.fileRef_comment === appexName)
        );
      })?.value;

      if (!appexBuildFileKey) {
        console.log('[withIosWidget] Adding appex build file to Embed App Extensions...');
        const fileRefs = proj.pbxFileReferenceSection();
        let appexFileRef = Object.keys(fileRefs).find((k) => {
          return (
            !k.endsWith('_comment') &&
            (fileRefs[k].path === appexName || fileRefs[k].path === `"${appexName}"`)
          );
        });

        if (!appexFileRef) {
          const productFile = proj.addProductFile(EXTENSION_TARGET_NAME, {
            group: 'Copy Files',
            target: targetUuid,
            explicitFileType: 'wrapper.app-extension',
          });
          appexFileRef = productFile.fileRef;
        }

        const buildFileUuid = proj.generateUuid();
        proj.hash.project.objects['PBXBuildFile'] = proj.hash.project.objects['PBXBuildFile'] || {};
        proj.hash.project.objects['PBXBuildFile'][buildFileUuid] = {
          isa: 'PBXBuildFile',
          fileRef: appexFileRef,
          fileRef_comment: appexName,
          settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
        };
        proj.hash.project.objects[`${buildFileUuid}_comment`] = `${appexName} in Embed App Extensions`;
        embedPhase.files.push({
          value: buildFileUuid,
          comment: `${appexName} in Embed App Extensions`,
        });
        appexBuildFileKey = buildFileUuid;
      } else {
        const bf = proj.hash.project.objects['PBXBuildFile'][appexBuildFileKey];
        if (bf) {
          bf.settings = bf.settings || {};
          bf.settings.ATTRIBUTES = bf.settings.ATTRIBUTES || [];
          if (!bf.settings.ATTRIBUTES.includes('RemoveHeadersOnCopy')) {
            bf.settings.ATTRIBUTES.push('RemoveHeadersOnCopy');
          }
        }
      }

      // Resolve main application group and widget PBXGroup
      const firstTargetName = (mainTarget?.name || '').replace(/"/g, '');
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

      // Inherit DEVELOPMENT_TEAM from host application build settings if present
      let mainDevTeam = null;
      const configurations = proj.pbxXCBuildConfigurationSection();
      for (const configId in configurations) {
        const buildConfig = configurations[configId];
        if (buildConfig.buildSettings?.DEVELOPMENT_TEAM) {
          mainDevTeam = buildConfig.buildSettings.DEVELOPMENT_TEAM;
          break;
        }
      }

      for (const configId in configurations) {
        const buildConfig = configurations[configId];
        const productName = String(buildConfig.buildSettings?.PRODUCT_NAME || '').replace(/"/g, '');
        if (productName === EXTENSION_TARGET_NAME) {
          buildConfig.buildSettings.SWIFT_VERSION = '5.0';
          buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.4';
          buildConfig.buildSettings.PRODUCT_NAME = `"${EXTENSION_TARGET_NAME}"`;
          buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${widgetBundleId}"`;
          buildConfig.buildSettings.INFOPLIST_FILE = '"StockFlowWidget/Info.plist"';
          buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = '"StockFlowWidget/StockFlowWidget.entitlements"';
          buildConfig.buildSettings.CURRENT_PROJECT_VERSION = '"1"';
          buildConfig.buildSettings.MARKETING_VERSION = '"1.0.0"';
          buildConfig.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
          buildConfig.buildSettings.CODE_SIGN_STYLE = 'Automatic';
          buildConfig.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
          buildConfig.buildSettings.SKIP_INSTALL = 'YES';
          buildConfig.buildSettings.CLANG_ENABLE_MODULES = 'YES';
          if (mainDevTeam) {
            buildConfig.buildSettings.DEVELOPMENT_TEAM = mainDevTeam;
          }
        }
      }

      // Add bridge files to the main app target with explicit group
      if (targetMainAppDir) {
        const mainTargetAppUuid = mainTargetUuid;
        if (mainTargetAppUuid) {
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
              { target: mainTargetAppUuid },
              mainAppGroupKey
            );
          }
          if (!proj.hasFile(bridgeRelH)) {
            proj.addHeaderFile(
              bridgeRelH,
              { target: mainTargetAppUuid },
              mainAppGroupKey
            );
          }
          proj.addFramework('WidgetKit.framework', { target: mainTargetAppUuid });
        }
      }

      fs.writeFileSync(pbxprojPath, proj.writeSync());
      const savedProject = fs.readFileSync(pbxprojPath, 'utf8');
      if (!savedProject.includes(EXTENSION_TARGET_NAME)) {
        throw new Error(`Saved project is missing ${EXTENSION_TARGET_NAME}`);
      }
      if (!savedProject.includes('Embed App Extensions')) {
        throw new Error('Saved project is missing Embed App Extensions build phase');
      }
      console.log('[withIosWidget] Successfully saved widget target and Embed App Extensions:', EXTENSION_TARGET_NAME);

      return dangerousConfig;
    },
  ]);

  return config;
};
