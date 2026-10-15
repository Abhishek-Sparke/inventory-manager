const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift');
if (fs.existsSync(target)) {
  let content = fs.readFileSync(target, 'utf8');
  let changed = false;

  if (content.includes('swift-tools-version: 6.2')) {
    content = content.replace('swift-tools-version: 6.2', 'swift-tools-version: 6.0');
    changed = true;
  }

  // Remove trailing commas in argument lists (Swift 6.2 syntax incompatible with Swift 6.0 in Xcode 16)
  const patterns = [
    [/targets:\s*\["ExpoModulesJSI"\],(\s*\))/g, 'targets: ["ExpoModulesJSI"]$1'],
    [/(linkerSettings:\s*\[[\s\S]*?\]),(\s*\)\s*,\s*\/\/\s*C\+\+)/g, '$1$2'],
    [/(cxxSettings:\s*\[[\s\S]*?\]),(\s*\)\s*,\s*\/\/\s*Tests)/g, '$1$2'],
    [/(path:\s*"Tests"),(\s*\)\s*,\s*\/\/\s*Benchmarks)/g, '$1$2'],
    [/(path:\s*"Benchmarks"),(\s*\)\s*,\s*\])/g, '$1$2']
  ];

  for (const [pattern, replacement] of patterns) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(target, content, 'utf8');
    console.log('✓ Patched expo-modules-jsi Package.swift for Xcode 16 / Swift 6.0 compatibility');
  }
}
