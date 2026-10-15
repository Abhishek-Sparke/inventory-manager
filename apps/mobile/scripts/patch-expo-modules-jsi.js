const fs = require('fs');
const path = require('path');

const appleDir = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple');

// 1. Patch Package.swift
const pkgTarget = path.join(appleDir, 'Package.swift');
if (fs.existsSync(pkgTarget)) {
  let content = fs.readFileSync(pkgTarget, 'utf8');
  let changed = false;

  if (content.includes('swift-tools-version: 6.2')) {
    content = content.replace('swift-tools-version: 6.2', 'swift-tools-version: 6.0');
    changed = true;
  }

  // Remove trailing commas before closing parentheses (Swift 6.2 syntax incompatible with Swift 6.0 in Xcode 16)
  if (/,[ \t]*\r?\n[ \t]*\)/.test(content)) {
    content = content.replace(/,[ \t]*(\r?\n[ \t]*\))/g, '$1');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(pkgTarget, content, 'utf8');
    console.log('✓ Patched expo-modules-jsi Package.swift for Xcode 16 / Swift 6.0 compatibility');
  }
}

// 2. Patch RuntimeScheduler.h for Clang C++ compatibility (remove undefined SWIFT_RETURNS_RETAINED in Xcode 16)
const headerTarget = path.join(appleDir, 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'RuntimeScheduler.h');
if (fs.existsSync(headerTarget)) {
  let content = fs.readFileSync(headerTarget, 'utf8');
  if (content.includes('SWIFT_RETURNS_RETAINED')) {
    content = content.replace(/\s*SWIFT_RETURNS_RETAINED/g, '');
    fs.writeFileSync(headerTarget, content, 'utf8');
    console.log('✓ Patched RuntimeScheduler.h to remove SWIFT_RETURNS_RETAINED for Xcode 16 C++');
  }
}

// 3. Patch Swift sources under Sources/ExpoModulesJSI:
// - Replace 'weak let' with 'weak var' across all Swift files (Swift 6.0 syntax requirement)
// - Remove ', Escapable' protocol conformance from classes (classes are already reference types in Swift 6.0)
// - In extension expo.CppError: Error, make 'public var message' internal (C++ structs cannot have public members in extensions with library evolution)
const sourcesDir = path.join(appleDir, 'Sources', 'ExpoModulesJSI');
if (fs.existsSync(sourcesDir)) {
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.swift')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        let modified = false;

        // Fix 3a: weak let -> weak var
        if (/\bweak\s+let\b/.test(content)) {
          content = content.replace(/\bweak\s+let\b/g, 'weak var');
          modified = true;
        }

        // Fix 3b: Escapable protocol conformance
        if (content.includes(', Escapable')) {
          content = content.replace(/,\s*Escapable\b/g, '');
          modified = true;
        }

        // Fix 3c: extension expo.CppError: Error -> remove 'public' from member
        if (content.includes('extension expo.CppError: Error') && content.includes('public var message: String')) {
          content = content.replace('public var message: String', 'var message: String');
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(fullPath, content, 'utf8');
          console.log(`✓ Patched ${path.relative(appleDir, fullPath)} for Xcode 16 / Swift 6.0`);
        }
      }
    }
  }

  walkDir(sourcesDir);
}
