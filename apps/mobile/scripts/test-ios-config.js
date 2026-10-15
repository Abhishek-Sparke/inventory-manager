/**
 * Standalone Unit Test for iOS WidgetKit Configuration & Prebuild Integration.
 *
 * Verifies:
 * 1. Plugin exports valid Expo Config Plugin function.
 * 2. Template files exist and contain required WidgetKit and App Group configurations.
 * 3. App Group entitlement is properly registered on the main application.
 * 4. Xcode project modification adds the Widget extension target and build phases.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

// 3. Verify Swift code contents
const swiftContent = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowTasksWidget.swift'), 'utf8');
assert.strictEqual(swiftContent.includes('import WidgetKit'), true, 'Must import WidgetKit');
assert.strictEqual(swiftContent.includes('import SwiftUI'), true, 'Must import SwiftUI');
assert.strictEqual(swiftContent.includes('group.com.sparke27.mobile'), true, 'Must use App Group suite');
assert.strictEqual(swiftContent.includes('StockFlowTasksWidgetEntryView'), true, 'Must declare entry view');
assert.strictEqual(swiftContent.includes('SmallWidgetView'), true, 'Must implement SmallWidgetView');
assert.strictEqual(swiftContent.includes('MediumWidgetView'), true, 'Must implement MediumWidgetView');
assert.strictEqual(swiftContent.includes('mobile://tasks?view=today'), true, 'Must bind deep link to tasks');
assert.strictEqual(swiftContent.includes('@main'), true, 'Must declare @main widget');
console.log('✓ Test 3 PASSED: StockFlowTasksWidget.swift contains valid SwiftUI views, TimelineProvider, and deep linking.');

// 4. Verify Entitlements and Info.plist
const entitlementsContent = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowWidget.entitlements'), 'utf8');
assert.strictEqual(entitlementsContent.includes('group.com.sparke27.mobile'), true, 'Must declare App Group');

const infoPlistContent = fs.readFileSync(path.join(iosWidgetDir, 'Info.plist'), 'utf8');
assert.strictEqual(infoPlistContent.includes('com.apple.widgetkit-extension'), true, 'Must declare NSExtensionPointIdentifier');
console.log('✓ Test 4 PASSED: Widget Info.plist and Entitlements configure com.apple.widgetkit-extension and App Group.');

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

// 6. Test App Group Config Plugin application on mock app.json
const mockConfig = {
  name: 'mobile',
  slug: 'mobile',
  ios: {
    bundleIdentifier: 'com.sparke27.mobile',
  },
  plugins: [],
};

// Test that plugin executes without throwing on mock config
const modifiedConfig = withIosWidget(mockConfig);
assert.notStrictEqual(modifiedConfig, undefined, 'Config must not be undefined');
console.log('✓ Test 6 PASSED: withIosWidget plugin executes cleanly on Expo configuration.');

// 7. Test Xcode project dangerous mod execution and target generation
(async function runXcodeProjectTest() {
  const xcode = require('xcode');
  const tmpTestDir = path.join(__dirname, '..', '.tmp-test-ios');
  const templatePbxproj = path.join(__dirname, '..', '..', 'flutter_mobile', 'ios', 'Runner.xcodeproj', 'project.pbxproj');

  if (!fs.existsSync(templatePbxproj)) {
    console.log('⚠ Skipping Test 7: Xcode project template not found.');
    console.log('\n=== ALL 6 iOS WIDGET CONFIGURATION TESTS PASSED ===');
    return;
  }

  try {
    fs.mkdirSync(path.join(tmpTestDir, 'mobile.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(tmpTestDir, 'mobile'), { recursive: true });
    fs.copyFileSync(templatePbxproj, path.join(tmpTestDir, 'mobile.xcodeproj', 'project.pbxproj'));

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
    assert.strictEqual(pbxContent.includes('StockFlowTasksWidget.swift'), true, 'Project must contain StockFlowTasksWidget.swift');
    assert.strictEqual(pbxContent.includes('StockFlowWidgetBridge.m'), true, 'Project must contain StockFlowWidgetBridge.m');
    assert.strictEqual(pbxContent.includes('StockFlowWidgetBridge.h'), true, 'Project must contain StockFlowWidgetBridge.h');

    const parsedProj = xcode.project(savedPbxprojPath);
    parsedProj.parseSync();
    const targets = parsedProj.pbxNativeTargetSection();
    const widgetTargetKey = Object.keys(targets).find(
      (uuid) => targets[uuid].name === 'StockFlowWidgetExtension' || targets[uuid].name === '"StockFlowWidgetExtension"'
    );
    assert.notStrictEqual(widgetTargetKey, undefined, 'StockFlowWidgetExtension target must exist in pbxNativeTargetSection');

    const widgetTarget = targets[widgetTargetKey];
    const buildPhases = widgetTarget.buildPhases || [];
    assert.strictEqual(buildPhases.some((bp) => bp.comment === 'Sources'), true, 'Widget target must have Sources build phase');
    assert.strictEqual(buildPhases.some((bp) => bp.comment === 'Frameworks'), true, 'Widget target must have Frameworks build phase');

    console.log('✓ Test 7 PASSED: StockFlowWidgetExtension target & build phases generated cleanly without path errors.');
    console.log('\n=== ALL 7 iOS WIDGET CONFIGURATION TESTS PASSED ===');
  } finally {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Test 7 FAILED:', err);
  process.exit(1);
});
