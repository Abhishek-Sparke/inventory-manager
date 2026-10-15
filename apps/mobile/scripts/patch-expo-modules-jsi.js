const fs = require('fs');
const path = require('path');

// 1. Patch Package.swift
const pkgTarget = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift');
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
const headerTarget = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'RuntimeScheduler.h');
if (fs.existsSync(headerTarget)) {
  let content = fs.readFileSync(headerTarget, 'utf8');
  if (content.includes('SWIFT_RETURNS_RETAINED')) {
    content = content.replace(/\s*SWIFT_RETURNS_RETAINED/g, '');
    fs.writeFileSync(headerTarget, content, 'utf8');
    console.log('✓ Patched RuntimeScheduler.h to remove SWIFT_RETURNS_RETAINED for Xcode 16 C++');
  }
}
