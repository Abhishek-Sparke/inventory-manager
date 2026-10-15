const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift');
if (fs.existsSync(target)) {
  const content = fs.readFileSync(target, 'utf8');
  if (content.includes('swift-tools-version: 6.2')) {
    fs.writeFileSync(target, content.replace('swift-tools-version: 6.2', 'swift-tools-version: 6.0'), 'utf8');
    console.log('✓ Patched expo-modules-jsi Package.swift to swift-tools-version: 6.0');
  }
}
