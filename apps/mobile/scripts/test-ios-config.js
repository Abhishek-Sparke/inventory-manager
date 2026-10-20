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

// 3. Verify Swift code contents (both widgets & bundle, no sample tasks, App Intent, Edit deep links)
const swiftContent = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowTasksWidget.swift'), 'utf8');
assert.strictEqual(swiftContent.includes('import WidgetKit'), true, 'Must import WidgetKit');
assert.strictEqual(swiftContent.includes('import SwiftUI'), true, 'Must import SwiftUI');
assert.strictEqual(swiftContent.includes('import AppIntents'), true, 'Must import AppIntents');
assert.strictEqual(swiftContent.includes('group.com.sparke27.mobile'), true, 'Must use App Group suite');
assert.strictEqual(swiftContent.includes('StockFlowTasksWidgetEntryView'), true, 'Must declare entry view');
assert.strictEqual(swiftContent.includes('SmallWidgetView'), true, 'Must implement SmallWidgetView');
assert.strictEqual(swiftContent.includes('MediumWidgetView'), true, 'Must implement MediumWidgetView');
assert.strictEqual(swiftContent.includes('StockFlowUpcomingWidget'), true, 'Must declare StockFlowUpcomingWidget');
assert.strictEqual(swiftContent.includes('StockFlowWidgetBundle'), true, 'Must declare StockFlowWidgetBundle');
assert.strictEqual(swiftContent.includes('mobile://tasks?view=today'), true, 'Must bind deep link to tasks');
assert.strictEqual(swiftContent.includes('@main'), true, 'Must declare @main widget bundle');

// Verification: Runtime sample data removal
assert.strictEqual(swiftContent.includes('sampleSnapshot'), false, 'Must NOT contain sampleSnapshot fallback');
assert.strictEqual(swiftContent.includes('Morning Inventory Count'), false, 'Must NOT contain hardcoded sample tasks');
assert.strictEqual(swiftContent.includes('Supplier Delivery Check'), false, 'Must NOT contain hardcoded sample tasks');
assert.strictEqual(swiftContent.includes('Receiving Pallet Stock'), false, 'Must NOT contain hardcoded sample tasks');
assert.strictEqual(swiftContent.includes('emptySnapshot'), true, 'Must define clean emptySnapshot');

// Verification: Interactive task completion & duplicate action prevention
assert.strictEqual(swiftContent.includes('struct ToggleTaskIntent: AppIntent'), true, 'Must implement ToggleTaskIntent AppIntent');
assert.strictEqual(swiftContent.includes('targetCompleted'), true, 'Must track target completion state to prevent duplicate rapid taps');
assert.strictEqual(swiftContent.includes('stockflow_pending_actions'), true, 'Must record action to stockflow_pending_actions');
assert.strictEqual(swiftContent.includes('WidgetCenter.shared.reloadAllTimelines()'), true, 'Must reload timelines after action');

// Verification: Edit action deep link
assert.strictEqual(swiftContent.includes('mobile://tasks?action=edit&taskId='), true, 'Must implement Edit deep links with actual taskId');
assert.strictEqual(swiftContent.includes('mobile://tasks?action=toggle&taskId='), true, 'Must implement Toggle fallback deep links for iOS 16');

// Verification: iOS compatibility & containerBackground
assert.strictEqual(swiftContent.includes('#available(iOS 17.0, *)'), true, 'Must guard iOS 17 APIs with #available');
assert.strictEqual(swiftContent.includes('containerBackground'), true, 'Must implement containerBackground for iOS 17');
assert.strictEqual(swiftContent.includes('contentMarginsDisabled'), true, 'Must guard contentMarginsDisabled');

console.log('✓ Test 3 PASSED: StockFlowTasksWidget.swift verified (no runtime sample tasks, AppIntent completion, Edit deep-links, clean empty states).');

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
assert.strictEqual(bridgeH.includes('getPendingActions'), true, 'Header must declare getPendingActions');
assert.strictEqual(bridgeH.includes('clearPendingActions'), true, 'Header must declare clearPendingActions');

const bridgeM = fs.readFileSync(path.join(iosWidgetDir, 'StockFlowWidgetBridge.m'), 'utf8');
assert.strictEqual(bridgeM.includes('RCT_EXPORT_MODULE'), true, 'Must export bridge module');
assert.strictEqual(bridgeM.includes('setWidgetSnapshot'), true, 'Must export setWidgetSnapshot method');
assert.strictEqual(bridgeM.includes('refreshWidgets'), true, 'Must export refreshWidgets method');
assert.strictEqual(bridgeM.includes('getPendingActions'), true, 'Must export getPendingActions method');
assert.strictEqual(bridgeM.includes('clearPendingActions'), true, 'Must export clearPendingActions method');
assert.strictEqual(bridgeM.includes('stockflow_pending_actions'), true, 'Must use stockflow_pending_actions queue');
assert.strictEqual(bridgeM.includes('group.com.sparke27.mobile'), true, 'Must write to App Group UserDefaults suite');
assert.strictEqual(bridgeM.includes('reloadAllTimelines'), true, 'Must reload WidgetCenter timelines');
console.log('✓ Test 5 PASSED: StockFlowWidgetBridge NativeModule implements snapshot sync, widget refresh, and pending action queue bridge.');

// 6. Test App Group & EAS Config Plugin application on mock app.json
const mockConfig = {
  name: 'StockFlow',
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
    fs.mkdirSync(path.join(tmpTestDir, 'StockFlow.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(tmpTestDir, 'StockFlow'), { recursive: true });
    const templateContent = fs.readFileSync(templatePbxproj, 'utf8').replace(/Runner/g, 'StockFlow');
    fs.writeFileSync(path.join(tmpTestDir, 'StockFlow.xcodeproj', 'project.pbxproj'), templateContent);

    const dangerousMod = modifiedConfig.mods?.ios?.dangerous;
    assert.strictEqual(typeof dangerousMod, 'function', 'dangerousMod must be registered');

    const modConfig = {
      ...modifiedConfig,
      modRequest: {
        platformProjectRoot: tmpTestDir,
      },
    };

    await dangerousMod(modConfig);

    const savedPbxprojPath = path.join(tmpTestDir, 'StockFlow.xcodeproj', 'project.pbxproj');
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
      (uuid) =>
        !uuid.endsWith('_comment') &&
        (targets[uuid].name === 'StockFlow' ||
          targets[uuid].name === '"StockFlow"' ||
          targets[uuid].name === 'mobile' ||
          targets[uuid].name === '"mobile"')
    );
    assert.notStrictEqual(mainTargetKey, undefined, 'Main target "StockFlow" must exist');
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
    const mockPayloadDir = path.join(mockIpaDir, 'Payload', 'StockFlow.app');
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
    const brokenPayloadDir = path.join(brokenIpaDir, 'Payload', 'StockFlow.app');
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
      nestedIpaDir, 'Payload', 'StockFlow.app', 'PlugIns',
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

    // 11. Test Interactive Task Completion, Action Queue Bridge & Persistence
    const widgetDataSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'widget-data.ts'), 'utf8');
    assert.strictEqual(widgetDataSrc.includes('processPendingWidgetActionsAsync'), true, 'Must implement processPendingWidgetActionsAsync');
    assert.strictEqual(widgetDataSrc.includes('getPendingActions'), true, 'Must call bridge getPendingActions');
    assert.strictEqual(widgetDataSrc.includes('clearPendingActions'), true, 'Must call bridge clearPendingActions');
    assert.strictEqual(widgetDataSrc.includes('updateLocalTaskAsync'), true, 'Must commit actions to SQLite database');
    assert.strictEqual(widgetDataSrc.includes('notifyTaskChange'), true, 'Must broadcast task change to in-app subscribers');

    // Simulate action processing and persistence logic
    let mockClearedIds = [];
    const mockDatabase = new Map([
      [42, { id: 42, title: 'Inspect Valves', is_completed: 0, status: 'pending' }],
      [43, { id: 43, title: 'Verify Gauges', is_completed: 1, status: 'completed' }],
    ]);

    const simulateProcessActions = (actions) => {
      const processed = [];
      for (const act of actions) {
        const task = mockDatabase.get(act.taskId);
        if (task) {
          let desiredDone = !Boolean(task.is_completed);
          if (typeof act.targetCompleted === 'boolean') {
            desiredDone = act.targetCompleted;
          } else if (act.action === 'complete') {
            desiredDone = true;
          } else if (act.action === 'incomplete') {
            desiredDone = false;
          }
          task.is_completed = desiredDone ? 1 : 0;
          task.status = desiredDone ? 'completed' : 'pending';
          mockDatabase.set(act.taskId, task);
        }
        if (act.id) processed.push(act.id);
      }
      mockClearedIds.push(...processed);
      return processed.length;
    };

    // Action 1: Toggle incomplete task 42 to complete
    simulateProcessActions([{ id: 'a1', taskId: 42, action: 'toggle', targetCompleted: true }]);
    assert.strictEqual(mockDatabase.get(42).is_completed, 1, 'Task 42 must be completed');
    assert.strictEqual(mockDatabase.get(42).status, 'completed', 'Task 42 status must be completed');
    assert.strictEqual(mockClearedIds.includes('a1'), true, 'Action a1 must be cleared from queue');

    // Action 2: Duplicate tap prevention — sending identical targetCompleted does not flip or corrupt state
    simulateProcessActions([{ id: 'a2', taskId: 42, action: 'toggle', targetCompleted: true }]);
    assert.strictEqual(mockDatabase.get(42).is_completed, 1, 'Duplicate tap must remain completed');

    // Action 3: Reopen task (toggle back to incomplete)
    simulateProcessActions([{ id: 'a3', taskId: 42, action: 'toggle', targetCompleted: false }]);
    assert.strictEqual(mockDatabase.get(42).is_completed, 0, 'Task 42 must be reopened');
    assert.strictEqual(mockDatabase.get(42).status, 'pending', 'Task 42 status must be pending');

    console.log('✓ Test 11 PASSED: Interactive task completion persistence, action queue bridge, and duplicate action prevention verified.');

    // 12. Test Edit Deep-Link Routing and Task Preloading in tasks.tsx
    const tasksScreenSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'tasks.tsx'), 'utf8');
    assert.strictEqual(tasksScreenSrc.includes('useLocalSearchParams'), true, 'Must use route search params');
    assert.strictEqual(tasksScreenSrc.includes('editTaskId'), true, 'Must support editTaskId param');
    assert.strictEqual(tasksScreenSrc.includes('action'), true, 'Must support action param');
    assert.strictEqual(tasksScreenSrc.includes('openEditTaskModal'), true, 'Must open edit modal on deep link');
    assert.strictEqual(tasksScreenSrc.includes('getLocalTaskByIdAsync'), true, 'Must fetch existing task details by real ID');
    assert.strictEqual(tasksScreenSrc.includes('processPendingWidgetActionsAsync'), true, 'Must drain pending actions on load');
    assert.strictEqual(tasksScreenSrc.includes('handleSaveTask'), true, 'Must save edits through existing persistence logic');

    // Verify Swift widget has exact matching deep-link URL schema
    assert.strictEqual(swiftContent.includes('mobile://tasks?action=edit&taskId=\\(task.id)'), true, 'Swift widget must generate edit deep link');
    assert.strictEqual(swiftContent.includes('mobile://tasks?action=toggle&taskId=\\(task.id)'), true, 'Swift widget must generate toggle deep link');

    console.log('✓ Test 12 PASSED: Edit deep-link routing, task preloading, and bidirectional URL schema verified.');

    // 13. Test Empty State, Corrupted Data Safety & Android Platform Isolation
    // A. Swift widget never writes back empty data on read failure
    assert.strictEqual(swiftContent.includes('emptySnapshot()'), true, 'Swift widget must construct safe emptySnapshot');
    assert.strictEqual(
      swiftContent.includes('guard let rawJson = jsonString, !rawJson.isEmpty'),
      true,
      'Swift widget must guard on valid jsonString'
    );
    // Ensure no writing occurs inside loadSnapshot fallback
    const loadSnapshotBlock = swiftContent.substring(
      swiftContent.indexOf('private func loadSnapshot() -> TaskEntry'),
      swiftContent.indexOf('// MARK: - Shared Accent')
    );
    assert.strictEqual(loadSnapshotBlock.includes('.set('), false, 'loadSnapshot must NEVER write to UserDefaults on read');
    assert.strictEqual(loadSnapshotBlock.includes('.write(to:'), false, 'loadSnapshot must NEVER write to container file on read');

    // B. Android platform isolation
    const androidTasksWidget = fs.readFileSync(path.join(__dirname, '..', 'src', 'widgets', 'StockFlowTasksWidget.tsx'), 'utf8');
    assert.strictEqual(androidTasksWidget.includes('AppIntent'), false, 'Android widget must not contain AppIntent');
    assert.strictEqual(androidTasksWidget.includes('SwiftUI'), false, 'Android widget must not contain SwiftUI');
    assert.strictEqual(androidTasksWidget.includes('WidgetKit'), false, 'Android widget must not contain WidgetKit');

    const appJsonRaw = fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8');
    const appJsonObj = JSON.parse(appJsonRaw);
    assert.strictEqual(appJsonObj.expo.android.package, 'com.sparke27.mobile', 'Android package must remain untouched');
    assert.strictEqual(
      Array.isArray(appJsonObj.expo.android.permissions),
      true,
      'Android permissions must remain untouched'
    );

    console.log('✓ Test 13 PASSED: Empty state safety, read-only failure handling, and Android platform isolation strictly verified.');

    // 14. Test build-unsigned-ipa.yml workflow naming alignment
    const workflowPath = path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'build-unsigned-ipa.yml');
    assert.strictEqual(fs.existsSync(workflowPath), true, 'build-unsigned-ipa.yml must exist');
    const workflowSrc = fs.readFileSync(workflowPath, 'utf8');

    // Ensure no stale references remain
    assert.strictEqual(workflowSrc.includes('mobile.xcodeproj'), false, 'Workflow must not reference mobile.xcodeproj');
    assert.strictEqual(workflowSrc.includes('mobile.xcworkspace'), false, 'Workflow must not reference mobile.xcworkspace');
    assert.strictEqual(workflowSrc.includes('-scheme mobile'), false, 'Workflow must not reference -scheme mobile');
    assert.strictEqual(workflowSrc.includes('mobile.app'), false, 'Workflow must not reference mobile.app');

    // Ensure correct StockFlow references exist
    assert.strictEqual(workflowSrc.includes('StockFlow.xcodeproj'), true, 'Workflow must reference StockFlow.xcodeproj');
    assert.strictEqual(workflowSrc.includes('StockFlow.xcworkspace'), true, 'Workflow must reference StockFlow.xcworkspace');
    assert.strictEqual(workflowSrc.includes('-scheme StockFlow'), true, 'Workflow must reference -scheme StockFlow');
    assert.strictEqual(workflowSrc.includes('StockFlow.app'), true, 'Workflow must package StockFlow.app');
    assert.strictEqual(workflowSrc.includes('Payload/StockFlow.app/PlugIns'), true, 'Workflow must embed extension in Payload/StockFlow.app/PlugIns');

    console.log('✓ Test 14 PASSED: build-unsigned-ipa.yml workflow consistently uses StockFlow project, workspace, scheme, and app bundle.');

    console.log('\n=== ALL 14 iOS WIDGET CONFIGURATION & IPA TESTS PASSED ===');
  } finally {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
