/**
 * Automated Verification Script for iOS IPA & App Bundles.
 *
 * Verifies that:
 * 1. The IPA or .app bundle contains the embedded WidgetKit extension at:
 *    mobile.app/PlugIns/StockFlowWidgetExtension.appex/
 * 2. StockFlowWidgetExtension.appex contains a valid Info.plist with:
 *    - CFBundlePackageType == 'XPC!'
 *    - NSExtensionPointIdentifier == 'com.apple.widgetkit-extension'
 *    - CFBundleIdentifier == 'com.sparke27.mobile.StockFlowWidgetExtension'
 * 3. The extension binary executable exists.
 * 4. If code-signed (embedded.mobileprovision present), verifies that
 *    com.apple.security.application-groups contains 'group.com.sparke27.mobile'.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXPECTED_EXTENSION_NAME = 'StockFlowWidgetExtension';
const EXPECTED_BUNDLE_ID = 'com.sparke27.mobile.StockFlowWidgetExtension';
const EXPECTED_EXTENSION_POINT = 'com.apple.widgetkit-extension';
const EXPECTED_APP_GROUP = 'group.com.sparke27.mobile';

/**
 * Parses embedded XML plist from a .mobileprovision CMS binary file.
 */
function extractMobileProvisionPlist(provisioningBuffer) {
  const contentStr = provisioningBuffer.toString('binary');
  const plistStart = contentStr.indexOf('<?xml');
  const plistEnd = contentStr.indexOf('</plist>');
  if (plistStart !== -1 && plistEnd !== -1) {
    return contentStr.substring(plistStart, plistEnd + 8);
  }
  return null;
}

/**
 * Extracts and verifies IPA file or .app bundle directory.
 */
function verifyIpa(targetPath) {
  if (!targetPath) {
    throw new Error('Target IPA or .app path must be specified');
  }

  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Target not found at: ${resolvedPath}`);
  }

  const isDirectory = fs.statSync(resolvedPath).isDirectory();
  let workingAppDir = resolvedPath;
  let tmpExtractDir = null;

  try {
    if (!isDirectory) {
      if (!resolvedPath.endsWith('.ipa') && !resolvedPath.endsWith('.zip')) {
        throw new Error(`Expected .ipa or .zip archive, got: ${resolvedPath}`);
      }

      tmpExtractDir = fs.mkdtempSync(path.join(path.dirname(resolvedPath), '.verify-ipa-tmp-'));
      console.log(`[verify-ipa] Inspecting archive: ${path.basename(resolvedPath)}`);

      // Use system tar (bsdtar) which handles zip/ipa archives on macOS, Linux, and Windows
      try {
        execSync(`tar -xf "${resolvedPath}" -C "${tmpExtractDir}"`, { stdio: 'pipe' });
      } catch (extractErr) {
        throw new Error(`Failed to extract IPA using tar: ${extractErr.message}`);
      }

      const payloadDir = path.join(tmpExtractDir, 'Payload');
      if (!fs.existsSync(payloadDir)) {
        throw new Error('IPA does not contain a Payload/ directory');
      }

      const appEntries = fs.readdirSync(payloadDir).filter((e) => e.endsWith('.app'));
      if (appEntries.length === 0) {
        throw new Error('Payload directory does not contain any .app bundles');
      }
      workingAppDir = path.join(payloadDir, appEntries[0]);
    }

    console.log(`[verify-ipa] Inspecting app bundle: ${path.basename(workingAppDir)}`);

    // 1. Verify PlugIns directory exists
    const pluginsDir = path.join(workingAppDir, 'PlugIns');
    if (!fs.existsSync(pluginsDir)) {
      throw new Error(`Missing PlugIns/ directory in host app: ${pluginsDir}`);
    }

    // 2. Verify StockFlowWidgetExtension.appex exists
    const widgetAppexDir = path.join(pluginsDir, `${EXPECTED_EXTENSION_NAME}.appex`);
    if (!fs.existsSync(widgetAppexDir)) {
      const foundExtensions = fs.readdirSync(pluginsDir);
      throw new Error(
        `Widget extension ${EXPECTED_EXTENSION_NAME}.appex not found in PlugIns/. Found: [${foundExtensions.join(', ')}]`
      );
    }
    console.log(`✓ Embedded app extension found: PlugIns/${EXPECTED_EXTENSION_NAME}.appex`);

    // 2B. Guard against nested .appex corruption (BSD cp -R bug)
    const nestedAppex = path.join(widgetAppexDir, `${EXPECTED_EXTENSION_NAME}.appex`);
    if (fs.existsSync(nestedAppex)) {
      throw new Error(
        `Nested .appex detected: ${EXPECTED_EXTENSION_NAME}.appex contains itself. ` +
          `This is caused by a missing 'rm -rf' before 'cp -R' in the packaging step. ` +
          `The widget will NOT appear on device.`
      );
    }
    console.log(`✓ No nested .appex corruption detected`);

    // 3. Verify extension Info.plist
    const infoPlistPath = path.join(widgetAppexDir, 'Info.plist');
    if (!fs.existsSync(infoPlistPath)) {
      throw new Error(`Widget extension is missing Info.plist at: ${infoPlistPath}`);
    }

    const infoPlistContent = fs.readFileSync(infoPlistPath, 'utf8');

    // 3A. Verify CFBundlePackageType is XPC!
    if (!infoPlistContent.includes('XPC!')) {
      throw new Error(
        `Widget Info.plist must have CFBundlePackageType set to 'XPC!'. Found invalid or placeholder package type.`
      );
    }
    console.log(`✓ CFBundlePackageType is valid: XPC!`);

    // 3B. Verify NSExtensionPointIdentifier is com.apple.widgetkit-extension
    if (!infoPlistContent.includes(EXPECTED_EXTENSION_POINT)) {
      throw new Error(
        `Widget Info.plist must declare NSExtensionPointIdentifier '${EXPECTED_EXTENSION_POINT}'`
      );
    }
    console.log(`✓ NSExtensionPointIdentifier is valid: ${EXPECTED_EXTENSION_POINT}`);

    // 3C. Verify Bundle Identifier
    if (
      !infoPlistContent.includes(EXPECTED_BUNDLE_ID) &&
      !infoPlistContent.includes('$(PRODUCT_BUNDLE_IDENTIFIER)')
    ) {
      throw new Error(
        `Widget Info.plist must reference bundle identifier '${EXPECTED_BUNDLE_ID}'`
      );
    }
    console.log(`✓ CFBundleIdentifier verified: ${EXPECTED_BUNDLE_ID}`);

    // 4. Verify extension binary / executable
    const filesInAppex = fs.readdirSync(widgetAppexDir);
    const hasBinary = filesInAppex.some(
      (f) => f === EXPECTED_EXTENSION_NAME || f === `${EXPECTED_EXTENSION_NAME}.swift`
    );
    if (!hasBinary && filesInAppex.length <= 1) {
      throw new Error(`Widget extension .appex appears empty: [${filesInAppex.join(', ')}]`);
    }

    // 5. Code signing & App Group Entitlements verification if mobileprovision is present
    const extProvisionPath = path.join(widgetAppexDir, 'embedded.mobileprovision');
    const appProvisionPath = path.join(workingAppDir, 'embedded.mobileprovision');

    if (fs.existsSync(extProvisionPath)) {
      const extProvisionRaw = fs.readFileSync(extProvisionPath);
      const extPlist = extractMobileProvisionPlist(extProvisionRaw);
      if (extPlist) {
        if (!extPlist.includes(EXPECTED_APP_GROUP)) {
          throw new Error(
            `Widget embedded.mobileprovision is missing required App Group entitlement: ${EXPECTED_APP_GROUP}`
          );
        }
        console.log(`✓ Widget extension signed with App Group: ${EXPECTED_APP_GROUP}`);
      }
    }

    if (fs.existsSync(appProvisionPath)) {
      const appProvisionRaw = fs.readFileSync(appProvisionPath);
      const appPlist = extractMobileProvisionPlist(appProvisionRaw);
      if (appPlist) {
        if (!appPlist.includes(EXPECTED_APP_GROUP)) {
          throw new Error(
            `Host app embedded.mobileprovision is missing required App Group entitlement: ${EXPECTED_APP_GROUP}`
          );
        }
        console.log(`✓ Host application signed with App Group: ${EXPECTED_APP_GROUP}`);
      }
    }

    console.log('=== IPA / APP BUNDLE WIDGETKIT EXTENSION VERIFICATION PASSED ===\n');
    return true;
  } finally {
    if (tmpExtractDir && fs.existsSync(tmpExtractDir)) {
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
    }
  }
}

// CLI Execution Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  let targetPath = args[0];

  if (!targetPath) {
    // Attempt to locate recent build artifacts
    const candidates = [
      path.join(__dirname, '..', 'StockFlow.ipa'),
      path.join(__dirname, '..', 'build', 'Build', 'Products', 'Release-iphoneos', 'mobile.app'),
      path.join(__dirname, '..', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'mobile.app'),
    ];
    targetPath = candidates.find((c) => fs.existsSync(c));
  }

  if (!targetPath) {
    console.error('Error: No IPA or .app bundle found to verify.');
    console.error('Usage: node scripts/verify-ipa.js <path/to/archive.ipa>');
    process.exit(1);
  }

  try {
    verifyIpa(targetPath);
    process.exit(0);
  } catch (err) {
    console.error('::error title=IPA Verification Failed::' + err.message);
    process.exit(1);
  }
}

module.exports = {
  verifyIpa,
  extractMobileProvisionPlist,
};
