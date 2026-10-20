/**
 * Standalone Unit Test for iOS WidgetKit Configuration & Prebuild Integration.
 *
 * Verifies:
 * 1. Plugin exports valid Expo Config Plugin function.
 * 2. Template files exist and contain required WidgetKit and App Group configurations.
 * 3. Swift source code defines both widgets (StockFlowTasksWidget & StockFlowUpcomingWidget) and WidgetBundle.
 * 4. App Group entitlement and Info.plist configure com.apple.widgetkit-extension and CFBundlePackageType == 'XPC!'.
 * 5. Native Bridge Module implements setWidgetSnapshot and refreshWidgets.
 * 6. App Group & EAS appExtensions Config Plugin application on Expo configuration.
 * 7. Xcode project dangerous mod execution: target creation, build phases, Target Dependency, and Embed App Extensions.
 * 8. Idempotent prebuild execution without duplicate build phases or targets.
 * 9. Automated physical-device IPA bundle verification via verifyIpa.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { verifyIpa } = require('./verify-ipa');

console.log('--- Starting StockFlow iOS WidgetKit Configuration Tests ---');

// 1. Verify plugin module
const withIosWidget = require('../plugins/withIosWidget');
assert.strictEqual(typeof withIosWidget, 'function', 'withIosWidget must export a function');
console.log('✓ Test 1 PASSED: withIosWidget config plugin successfully loaded.');

// 2. Verify all template files exist in plugins/ios-widget/
const iosWidgetDir = path.join(__dirname, '..', 'plugins', 'ios-widget');
const requiredFiles = [
  'StockFlowTasksWidget.swift',
  'Info.plist',
  'StockFlowWidget.entitlements',
  'StockFlowWidgetBridge.h',
  'StockFlowWidgetBridge.m',
];

for (const file of requiredFiles) {
  const filePath = path.join(iosWidgetDir, file);
  assert.strictEqual(fs.existsSync(filePath), true, `Template file ${file} must exist`);
}
console.log('✓ Test 2 PASSED: All 5 required iOS native template files exist in plugins/ios-widget/.');

// 3. Verify Swift code contents (both widgets & bundle)
const swiftContent = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowTasksWidget.swift'), 'utf8');
assert.strictEqual(swiftContent.includes('import WidgetKit'), true, 'Must import WidgetKit');
assert.strictEqual(swiftContent.includes('import SwiftUI'), true, 'Must import SwiftUI');
assert.strictEqual(swiftContent.includes('group.com.sparke27.mobile'), true, 'Must use App Group suite');
assert.strictEqual(swiftContent.includes('StockFlowTasksWidgetEntryView'), true, 'Must declare entry view');
assert.strictEqual(swiftContent.includes('SmallWidgetView'), true, 'Must implement SmallWidgetView');
assert.strictEqual(swiftContent.includes('MediumWidgetView'), true, 'Must implement MediumWidgetView');
assert.strictEqual(swiftContent.includes('StockFlowUpcomingWidget'), true, 'Must declare StockFlowUpcomingWidget');
assert.strictEqual(swiftContent.includes('StockFlowWidgetBundle'), true, 'Must declare StockFlowWidgetBundle');
assert.strictEqual(swiftContent.includes('mobile://tasks?view=today'), true, 'Must bind deep link to tasks');
assert.strictEqual(swiftContent.includes('@main'), true, 'Must declare @main widget bundle');
console.log('✓ Test 3 PASSED: StockFlowTasksWidget.swift contains both widgets, TimelineProvider, deep links, and @main WidgetBundle.');

// 4. Verify Entitlements and Info.plist
const entitlementsContent = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowWidget.entitlements'), 'utf8');
assert.strictEqual(entitlementsContent.includes('group.com.sparke27.mobile'), true, 'Must declare App Group');

const infoPlistContent = fs.readFileSync(path.join(iosWidgetDir, 'Info.plist'), 'utf8');
assert.strictEqual(infoPlistContent.includes('com.apple.widgetkit-extension'), true, 'Must declare NSExtensionPointIdentifier');
assert.strictEqual(infoPlistContent.includes('XPC!'), true, 'Info.plist must explicitly declare CFBundlePackageType as XPC!');
assert.strictEqual(
  infoPlistContent.includes('$(PRODUCT_BUNDLE_PACKAGE_TYPE)'),
  false,
  'Info.plist must NOT use $(PRODUCT_BUNDLE_PACKAGE_TYPE)'
);
console.log('✓ Test 4 PASSED: Widget Info.plist has XPC! package type and com.apple.widgetkit-extension.');

// 5. Verify Native Bridge Module
const bridgeH = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowWidgetBridge.h'), 'utf8');
assert.strictEqual(bridgeH.includes('RCTBridgeModule'), true, 'Header must declare RCTBridgeModule');

const bridgeM = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowWidgetBridge.m'), 'utf8');
assert.strictEqual(bridgeM.includes('RCT_EXPORT_MODULE'), true, 'Must export bridge module');
assert.strictEqual(bridgeM.includes('setWidgetSnapshot'), true, 'Must export setWidgetSnapshot method');
assert.strictEqual(bridgeM.includes('refreshWidgets'), true, 'Must export refreshWidgets method');
assert.strictEqual(bridgeM.includes('group.com.sparke27.mobile'), true, 'Must write to App Group UserDefaults suite');
assert.strictEqual(bridgeM.includes('reloadAllTimelines'), true, 'Must reload WidgetCenter timelines');
console.log('✓ Test 5 PASSED: StockFlowWidgetBridge NativeModule implements setWidgetSnapshot and refreshWidgets.');

// 6. Test App Group & EAS Config Plugin application on mock app.json
const mockConfig = {
  name: 'mobile',
  slug: 'mobile',
  ios: {
    bundleIdentifier: 'com.sparke27.mobile',
  },
  plugins: [],
};

const modifiedConfig = withIosWidget(mockConfig);
assert.notStrictEqual(modifiedConfig, undefined, 'Config must not be undefined');
assert.strictEqual(
  Array.isArray(modifiedConfig.extra?.eas?.build?.experimental?.ios?.appExtensions),
  true,
  'Config plugin must register extra.eas.build.experimental.ios.appExtensions'
);

const registeredExt = modifiedConfig.extra.eas.build.experimental.ios.appExtensions.find(
  (e) => e.targetName === 'StockFlowWidgetExtension'
);
assert.notStrictEqual(registeredExt, undefined, 'StockFlowWidgetExtension must be registered in EAS appExtensions');
assert.strictEqual(
  registeredExt.bundleIdentifier,
  'com.sparke27.mobile.StockFlowWidgetExtension',
  'Widget bundle ID must match'
);
assert.strictEqual(
  registeredExt.entitlements['com.apple.security.application-groups'].includes('group.com.sparke27.mobile'),
  true,
  'Widget extension must have App Group entitlement registered'
);
console.log('✓ Test 6 PASSED: withIosWidget config plugin successfully configures App Group and EAS appExtensions.');

// 7. Test Xcode project dangerous mod execution: Target Dependency, Embed App Extensions, and Build Settings
(async function runXcodeProjectTest() {
  const xcode = require('xcode');
  const tmpTestDir = path.join(__dirname, '..', '.tmp-test-ios');
  const templatePbxproj = path.join(
    __dirname,
    '..',
    '..',
    'flutter_mobile',
    'ios',
    'Runner.xcodeproj',
    'project.pbxproj'
  );

  if (!fs.existsSync(templatePbxproj)) {
    console.log('⚠ Skipping Tests 7-9: Xcode project template not found.');
    return;
  }

  try {
    fs.mkdirSync(path.join(tmpTestDir, 'mobile.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(tmpTestDir, 'mobile'), { recursive: true });
    const templateContent = fs.readFileSync(templatePbxproj, 'utf8').replace(/Runner/g, 'mobile');
    fs.writeFileSync(path.join(tmpTestDir, 'mobile.xcodeproj', 'project.pbxproj'), templateContent);

    const dangerousMod = modifiedConfig.mods?.ios?.dangerous;
    assert.strictEqual(typeof dangerousMod, 'function', 'dangerousMod must be registered');

    const modConfig = {
      ...modifiedConfig,
      modRequest: {
        platformProjectRoot: tmpTestDir,
      },
    };

    await dangerousMod(modConfig);

    const savedPbxprojPath = path.join(tmpTestDir, 'mobile.xcodeproj', 'project.pbxproj');
    const pbxContent = fs.readFileSync(savedPbxprojPath, 'utf8');

    assert.strictEqual(pbxContent.includes('StockFlowWidgetExtension'), true, 'Project must contain StockFlowWidgetExtension');
    assert.strictEqual(pbxContent.includes('Embed App Extensions'), true, 'Project must contain Embed App Extensions');
    assert.strictEqual(pbxContent.includes('RemoveHeadersOnCopy'), true, 'Project must contain RemoveHeadersOnCopy in Embed App Extensions');
    assert.strictEqual(pbxContent.includes('StockFlowTasksWidget.swift'), true, 'Project must contain StockFlowTasksWidget.swift');
    assert.strictEqual(pbxContent.includes('StockFlowWidgetBridge.m'), true, 'Project must contain StockFlowWidgetBridge.m');
    assert.strictEqual(pbxContent.includes('StockFlowWidgetBridge.h'), true, 'Project must contain StockFlowWidgetBridge.h');

    const parsedProj = xcode.project(savedPbxprojPath);
    parsedProj.parseSync();
    const targets = parsedProj.pbxNativeTargetSection();

    // Verify main target has dependency and Embed App Extensions phase
    const mainTargetKey = Object.keys(targets).find(
      (uuid) => !uuid.endsWith('_comment') && (targets[uuid].name === 'mobile' || targets[uuid].name === '"mobile"')
    );
    assert.notStrictEqual(mainTargetKey, undefined, 'Main target "mobile" must exist');
    const mainTarget = targets[mainTargetKey];

    // Verify target dependency
    const targetDeps = parsedProj.hash.project.objects['PBXTargetDependency'] || {};
    const widgetTargetKey = Object.keys(targets).find(
      (uuid) => targets[uuid].name === 'StockFlowWidgetExtension' || targets[uuid].name === '"StockFlowWidgetExtension"'
    );
    assert.notStrictEqual(widgetTargetKey, undefined, 'StockFlowWidgetExtension target must exist');

    const hasTargetDep = (mainTarget.dependencies || []).some((dep) => {
      const depObj = targetDeps[dep.value];
      return depObj && depObj.target === widgetTargetKey;
    });
    assert.strictEqual(hasTargetDep, true, 'Main app target must have PBXTargetDependency on StockFlowWidgetExtension');

    // Verify Embed App Extensions copy-files phase on main target
    const copyFiles = parsedProj.hash.project.objects['PBXCopyFilesBuildPhase'] || {};
    let embedPhaseFound = false;
    for (const k in copyFiles) {
      if (k.endsWith('_comment')) continue;
      const phase = copyFiles[k];
      if (phase.dstSubfolderSpec === 13) {
        embedPhaseFound = true;
        assert.strictEqual(phase.name, '"Embed App Extensions"', 'Phase name must be "Embed App Extensions"');
        assert.strictEqual(phase.dstPath, '""', 'dstPath must be empty string');

        // Verify StockFlowWidgetExtension.appex is embedded
        const hasAppexFile = (phase.files || []).some((f) => {
          const bf = parsedProj.hash.project.objects['PBXBuildFile']?.[f.value];
          return (
            bf &&
            (f.comment?.includes('StockFlowWidgetExtension.appex') ||
              bf.fileRef_comment?.includes('StockFlowWidgetExtension.appex'))
          );
        });
        assert.strictEqual(hasAppexFile, true, 'Embed App Extensions phase must contain StockFlowWidgetExtension.appex');
      }
    }
    assert.strictEqual(embedPhaseFound, true, 'Must find PBXCopyFilesBuildPhase with dstSubfolderSpec 13 (PlugIns)');

    // Verify Build Settings for StockFlowWidgetExtension
    const configs = parsedProj.pbxXCBuildConfigurationSection();
    let extConfigFound = false;
    for (const cId in configs) {
      const c = configs[cId];
      if (c.buildSettings?.PRODUCT_NAME?.includes('StockFlowWidgetExtension')) {
        extConfigFound = true;
        assert.strictEqual(
          c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
          '"com.sparke27.mobile.StockFlowWidgetExtension"'
        );
        assert.strictEqual(c.buildSettings.INFOPLIST_FILE, '"StockFlowWidget/Info.plist"');
        assert.strictEqual(c.buildSettings.CODE_SIGN_ENTITLEMENTS, '"StockFlowWidget/StockFlowWidget.entitlements"');
        assert.strictEqual(c.buildSettings.SKIP_INSTALL, 'YES');
        assert.strictEqual(c.buildSettings.SWIFT_VERSION, '5.0');
        // Must be 16.4 to match expo-modules-core podspec (Expo SDK 57)
        assert.strictEqual(c.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, '16.4');
      }
    }
    assert.strictEqual(extConfigFound, true, 'StockFlowWidgetExtension XCBuildConfiguration must exist');
    console.log('✓ Test 7 PASSED: Xcode project generates Target Dependency, Embed App Extensions build phase (PlugIns), and build settings.');

    // 8. Deployment target correctness: must equal 16.4 (expo-modules-core minimum)
    for (const cId in configs) {
      const c = configs[cId];
      if (c.buildSettings?.PRODUCT_NAME?.includes('StockFlowWidgetExtension')) {
        assert.notStrictEqual(
          c.buildSettings.IPHONEOS_DEPLOYMENT_TARGET,
          '16.0',
          'Deployment target must be 16.4, not 16.0: expo-modules-core podspec requires iOS 16.4'
        );
        assert.strictEqual(
          parseFloat(c.buildSettings.IPHONEOS_DEPLOYMENT_TARGET) >= 16.4,
          true,
          'Deployment target must be >= 16.4'
        );
      }
    }
    console.log('✓ Test 8 PASSED: Widget extension deployment target is 16.4 (matches expo-modules-core podspec minimum).');

    // 9. Idempotency: re-running dangerousMod must not duplicate phases
    await dangerousMod(modConfig);
    const parsedProj2 = xcode.project(savedPbxprojPath);
    parsedProj2.parseSync();
    const copyFiles2 = parsedProj2.hash.project.objects['PBXCopyFilesBuildPhase'] || {};
    const embedPhasesCount = Object.keys(copyFiles2).filter(
      (k) => !k.endsWith('_comment') && copyFiles2[k].dstSubfolderSpec === 13
    ).length;
    assert.strictEqual(embedPhasesCount, 1, 'Re-running prebuild must not duplicate Embed App Extensions phase');
    console.log('✓ Test 9 PASSED: Prebuild plugin is idempotent across multiple prebuild invocations.');

    // 9. Automated Physical-Device IPA Verification Test
    console.log('\n--- Running Automated Physical-Device IPA Verification Test ---');
    const mockIpaDir = path.join(tmpTestDir, 'mock-ipa-test');
    const mockPayloadDir = path.join(mockIpaDir, 'Payload', 'mobile.app');
    const mockPlugInsDir = path.join(mockPayloadDir, 'PlugIns', 'StockFlowWidgetExtension.appex');
    fs.mkdirSync(mockPlugInsDir, { recursive: true });

    // Copy template Info.plist into mock appex
    fs.copyFileSync(
      path.join(iosWidgetDir, 'Info.plist'),
      path.join(mockPlugInsDir, 'Info.plist')
    );
    // Write dummy binary
    fs.writeFileSync(path.join(mockPlugInsDir, 'StockFlowWidgetExtension'), 'mock-binary-data');

    // Create mock embedded.mobileprovision containing group.com.sparke27.mobile
    const mockProvisioning = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Entitlements</key>
    <dict>
        <key>application-identifier</key>
        <string>TEAM123456.com.sparke27.mobile.StockFlowWidgetExtension</string>
        <key>com.apple.security.application-groups</key>
        <array>
            <string>group.com.sparke27.mobile</string>
        </array>
    </dict>
</dict>
</plist>`;
    fs.writeFileSync(path.join(mockPlugInsDir, 'embedded.mobileprovision'), mockProvisioning);
    fs.writeFileSync(path.join(mockPayloadDir, 'embedded.mobileprovision'), mockProvisioning);

    // Package into mock StockFlow-Test.ipa using tar
    const mockIpaPath = path.join(tmpTestDir, 'StockFlow-Test.ipa');
    execSync(`tar -cf "${mockIpaPath}" -C "${mockIpaDir}" Payload`, { stdio: 'pipe' });
    assert.strictEqual(fs.existsSync(mockIpaPath), true, 'Mock IPA file must be created');

    // Verify valid IPA passes
    const verifySuccess = verifyIpa(mockIpaPath);
    assert.strictEqual(verifySuccess, true, 'verifyIpa must return true for valid IPA');

    // Verify broken IPA (missing PlugIns) fails with the right error
    const brokenIpaDir = path.join(tmpTestDir, 'broken-ipa-test');
    const brokenPayloadDir = path.join(brokenIpaDir, 'Payload', 'mobile.app');
    fs.mkdirSync(brokenPayloadDir, { recursive: true });
    const brokenIpaPath = path.join(tmpTestDir, 'StockFlow-Broken.ipa');
    execSync(`tar -cf "${brokenIpaPath}" -C "${brokenIpaDir}" Payload`, { stdio: 'pipe' });

    let failedAsExpected = false;
    try {
      verifyIpa(brokenIpaPath);
    } catch (expectedErr) {
      failedAsExpected = true;
      assert.strictEqual(expectedErr.message.includes('Missing PlugIns'), true);
    }
    assert.strictEqual(failedAsExpected, true, 'verifyIpa must fail if PlugIns is missing');

    // Verify nested .appex corruption is detected
    const nestedIpaDir = path.join(tmpTestDir, 'nested-appex-test');
    const nestedAppexDir = path.join(
      nestedIpaDir, 'Payload', 'mobile.app', 'PlugIns',
      'StockFlowWidgetExtension.appex', 'StockFlowWidgetExtension.appex'
    );
    fs.mkdirSync(nestedAppexDir, { recursive: true });
    fs.copyFileSync(
      path.join(iosWidgetDir, 'Info.plist'),
      path.join(path.dirname(nestedAppexDir), 'Info.plist')
    );
    const nestedIpaPath = path.join(tmpTestDir, 'StockFlow-Nested.ipa');
    execSync(`tar -cf "${nestedIpaPath}" -C "${nestedIpaDir}" Payload`, { stdio: 'pipe' });
    let nestedCorruptionDetected = false;
    try {
      verifyIpa(nestedIpaPath);
    } catch (nestedErr) {
      nestedCorruptionDetected = true;
      assert.strictEqual(
        nestedErr.message.toLowerCase().includes('nested'),
        true,
        'Error must mention nested .appex'
      );
    }
    assert.strictEqual(nestedCorruptionDetected, true, 'verifyIpa must fail on nested .appex corruption');

    console.log('✓ Test 10 PASSED: Automated IPA verification detects missing extensions, nested .appex bundles, and valid IPA bundles.');

    console.log('\n=== ALL 9 iOS WIDGET CONFIGURATION & IPA TESTS PASSED ===');
  } finally {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
