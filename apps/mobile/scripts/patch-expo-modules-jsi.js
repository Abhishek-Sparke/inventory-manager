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

  // Remove experimental upcoming features that conflict with Xcode 16 Swift 6.0 isolation
  if (content.includes('.enableUpcomingFeature("NonisolatedNonsendingByDefault"),')) {
    content = content.replace(/\.enableUpcomingFeature\("NonisolatedNonsendingByDefault"\),?\r?\n?/g, '');
    changed = true;
  }
  if (content.includes('.enableUpcomingFeature("InferIsolatedConformances"),')) {
    content = content.replace(/\.enableUpcomingFeature\("InferIsolatedConformances"\),?\r?\n?/g, '');
    changed = true;
  }

  // Set strict concurrency to minimal to prevent spurious actor isolation errors on Xcode 16
  if (!content.includes('"-strict-concurrency=minimal"')) {
    content = content.replace(
      '"-enable-library-evolution",',
      '"-enable-library-evolution",\n          "-Xfrontend",\n          "-strict-concurrency=minimal",'
    );
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
// - Strip trailing commas before closing parens in all Swift files (SE-0431 is Swift 6.2+ only)
// - Replace 'weak let' / 'weak var' with 'nonisolated(unsafe) weak var' across all Swift files (avoids Sendable mutable stored property errors)
// - Remove ', Escapable' protocol conformance from classes (classes are already reference types in Swift 6.0)
// - In extension expo.CppError: Error, make 'public var message' internal (C++ structs cannot have public members in extensions with library evolution)
// - In JavaScriptActor.swift, replace actor-isolated runner with non-isolated _rawRun to avoid actor isolation errors
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

        // Fix 3a: Trailing commas before closing parens (e.g. JavaScriptRuntime.swift:404)
        if (/,[ \t]*\r?\n[ \t]*\)/.test(content)) {
          content = content.replace(/,[ \t]*(\r?\n[ \t]*\))/g, '$1');
          modified = true;
        }

        // Fix 3b: weak let / weak var in Sendable types -> nonisolated(unsafe) weak var
        if (/\b(?:nonisolated\(unsafe\)\s+)?weak\s+(?:let|var)\b/.test(content)) {
          content = content.replace(/\b(?:nonisolated\(unsafe\)\s+)?weak\s+(?:let|var)\b/g, 'nonisolated(unsafe) weak var');
          modified = true;
        }

        // Fix 3c: Escapable protocol conformance
        if (content.includes(', Escapable')) {
          content = content.replace(/,\s*Escapable\b/g, '');
          modified = true;
        }

        // Fix 3d: extension expo.CppError: Error -> remove 'public' from member
        if (content.includes('extension expo.CppError: Error') && content.includes('public var message: String')) {
          content = content.replace('public var message: String', 'var message: String');
          modified = true;
        }

        // Fix 3e: JavaScriptActor assumeIsolated and runIsolated
        if (entry.name === 'JavaScriptActor.swift') {
          // Remove any invalid @_unsafeInheritExecutor attributes from previous edits
          if (content.includes('@_unsafeInheritExecutor')) {
            content = content.replace(/@_unsafeInheritExecutor\r?\n\s*/g, '');
            modified = true;
          }

          const assumeRegex = /@_alwaysEmitIntoClient\r?\n\s*@inline\(__always\)\r?\n\s*public static func assumeIsolated<T: ~Copyable>\(_ operation: @JavaScriptActor \(\) -> T\) -> T \{[\s\S]*?^\s*\}/m;
          if (assumeRegex.test(content)) {
            content = content.replace(
              assumeRegex,
              `@_alwaysEmitIntoClient
  @inline(__always)
  public static func assumeIsolated<T: ~Copyable>(_ operation: @JavaScriptActor () -> T) -> T {
    typealias RawRunner = ((() -> T) -> T)
    typealias NonisolatedRunner = (@JavaScriptActor () -> T) -> T

    checkIsolated()

    let runner = unsafeBitCast(_rawRun as RawRunner, to: NonisolatedRunner.self)
    return runner(operation)
  }`
            );
            modified = true;
          }

          const runRegex = /(@JavaScriptActor\r?\n\s*)?(@usableFromInline\r?\n\s*)?internal static func (?:runIsolated|_rawRun)<T: ~Copyable>\([\s\S]*?^\s*\}/m;
          if (runRegex.test(content)) {
            content = content.replace(
              runRegex,
              `@usableFromInline
  internal static func _rawRun<T: ~Copyable>(_ op: () -> T) -> T {
    return op()
  }`
            );
            modified = true;
          }
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
