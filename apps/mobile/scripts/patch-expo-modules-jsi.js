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

// 2. Patch C++ headers in Sources/ExpoModulesJSI-Cxx/include
// 2a. RuntimeScheduler.h (remove undefined SWIFT_RETURNS_RETAINED in Xcode 16)
const headerTarget = path.join(appleDir, 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'RuntimeScheduler.h');
if (fs.existsSync(headerTarget)) {
  let content = fs.readFileSync(headerTarget, 'utf8');
  if (content.includes('SWIFT_RETURNS_RETAINED')) {
    content = content.replace(/\s*SWIFT_RETURNS_RETAINED/g, '');
    fs.writeFileSync(headerTarget, content, 'utf8');
    console.log('✓ Patched RuntimeScheduler.h to remove SWIFT_RETURNS_RETAINED for Xcode 16 C++');
  }
}

// 2b. RetainedSwiftPointer.h (remove SWIFT_IMMORTAL_REFERENCE which blocks Swift initialization)
const retainedTarget = path.join(appleDir, 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'RetainedSwiftPointer.h');
if (fs.existsSync(retainedTarget)) {
  let content = fs.readFileSync(retainedTarget, 'utf8');
  let changed = false;
  if (content.includes('SWIFT_IMMORTAL_REFERENCE')) {
    content = content.replace(/\s*SWIFT_IMMORTAL_REFERENCE/g, '');
    changed = true;
  }
  if (content.includes('virtual ~RetainedSwiftPointer()')) {
    content = content.replace('virtual ~RetainedSwiftPointer()', '~RetainedSwiftPointer()');
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(retainedTarget, content, 'utf8');
    console.log('✓ Patched RetainedSwiftPointer.h to remove SWIFT_IMMORTAL_REFERENCE');
  }
}

// 2c. HostObjectCallbacks.h (add addPropNameId helper to avoid Swift C++ move-only vector push_back issue)
const hostObjTarget = path.join(appleDir, 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'HostObjectCallbacks.h');
if (fs.existsSync(hostObjTarget)) {
  let content = fs.readFileSync(hostObjTarget, 'utf8');
  if (!content.includes('addPropNameId')) {
    content = content.replace(
      'using Deallocator = void(Context);',
      `using Deallocator = void(Context);
  inline static void addPropNameId(PropNameIds &vector, facebook::jsi::IRuntime &runtime, const std::string &name) {
    vector.push_back(facebook::jsi::PropNameID::forUtf8(runtime, name));
  }`
    );
    fs.writeFileSync(hostObjTarget, content, 'utf8');
    console.log('✓ Patched HostObjectCallbacks.h with addPropNameId helper');
  }
}

// 2d. HostFunctionClosure.h (make it a value type with a factory create method returning a heap pointer)
const hostFuncTarget = path.join(appleDir, 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'HostFunctionClosure.h');
if (fs.existsSync(hostFuncTarget)) {
  let content = fs.readFileSync(hostFuncTarget, 'utf8');
  let changed = false;
  if (content.includes('SWIFT_IMMORTAL_REFERENCE')) {
    content = content.replace(/\s*SWIFT_IMMORTAL_REFERENCE/g, '');
    changed = true;
  }
  if (content.includes('class HostFunctionClosure final')) {
    content = content.replace(
      /class HostFunctionClosure final[\s\S]*?\/\/ class HostFunctionClosure/m,
      `class HostFunctionClosure final {
public:
  using Context = void *_Nonnull;
  using Deallocator = void(Context);
  using Closure = bool(Context context, const facebook::jsi::Value *_Nonnull thisValue, const facebook::jsi::Value *_Nonnull args, size_t count, facebook::jsi::Value *_Nonnull result);

  explicit HostFunctionClosure(Context context, Closure closure, Deallocator deallocator)
  : _context(context), _closure(closure), _deallocator(deallocator) {}

  ~HostFunctionClosure() {
    _deallocator(_context);
  }

  static inline HostFunctionClosure* _Nonnull create(Context context, Closure closure, Deallocator deallocator) {
    return new HostFunctionClosure(context, closure, deallocator);
  }

  inline bool call(const facebook::jsi::Value &thisValue, const facebook::jsi::Value *_Nonnull args, size_t count, facebook::jsi::Value &result) const {
    return _closure(_context, &thisValue, args, count, &result);
  }

private:
  Context _context;
  Closure *_Nonnull _closure;
  Deallocator *_Nonnull _deallocator;
}; // class HostFunctionClosure`
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(hostFuncTarget, content, 'utf8');
    console.log('✓ Patched HostFunctionClosure.h for Swift C++ constructor accessibility');
  }
}

// 3. Patch Swift sources under Sources/ExpoModulesJSI:
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

        // Fix 3e: JavaScriptActor assumeIsolated and _rawRun
        if (entry.name === 'JavaScriptActor.swift') {
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

        // Fix 3f: Task+immediate.swift: use standard Task(priority: .high, operation: operation)
        if (entry.name === 'Task+immediate.swift') {
          if (content.includes('Task.immediate') || content.includes('name: name')) {
            content = content.replace(
              /if #available[\s\S]*?return Task\(name: name, priority: \.high, operation: operation\)\r?\n\s*\}/m,
              'return Task(priority: .high, operation: operation)'
            );
            modified = true;
          }
        }

        // Fix 3g: JavaScriptRuntime.swift:
        // - use expo.HostObjectCallbacks.addPropNameId
        // - update createFunctionClosure to return UnsafeMutablePointer<expo.HostFunctionClosure>
        if (entry.name === 'JavaScriptRuntime.swift') {
          if (content.includes('vector.push_back(')) {
            content = content.replace(
              /for propertyName in propertyNames \{[\s\S]*?vector\.push_back\(.*?\)[\s\S]*?\}/m,
              `for propertyName in propertyNames {
        expo.HostObjectCallbacks.addPropNameId(&vector, iRuntime, std.string(propertyName))
      }`
            );
            modified = true;
          }

          if (content.includes(') -> expo.HostFunctionClosure {')) {
            content = content.replace(
              /\) -> expo\.HostFunctionClosure \{/g,
              ') -> UnsafeMutablePointer<expo.HostFunctionClosure> {'
            );
            modified = true;
          }

          if (content.includes('return expo.HostFunctionClosure(context, call, deallocate)')) {
            content = content.replace(
              /return expo\.HostFunctionClosure\(context, call, deallocate\)/g,
              'return expo.HostFunctionClosure.create(context, call, deallocate)'
            );
            modified = true;
          }

          if (content.includes('return try constructor(this, arguments)')) {
            content = content.replace(
              'return try constructor(this, arguments)',
              'return try constructor(this, arguments.copy())'
            );
            modified = true;
          }
        }

        // Fix 3h: JavaScriptObject.swift: avoid delegating self.init on ~Copyable struct (Xcode 16 Swift compiler bug)
        if (entry.name === 'JavaScriptObject.swift') {
          if (content.includes('self.init(runtime, facebook.jsi.Object(runtime.pointee))')) {
            content = content.replace(
              'self.init(runtime, facebook.jsi.Object(runtime.pointee))',
              'self.runtime = runtime\n    self.pointee = facebook.jsi.Object(runtime.pointee)'
            );
            modified = true;
          }
        }

        // Fix 3i: JavaScriptArray.swift: avoid delegating self.init on ~Copyable struct (Xcode 16 Swift compiler bug)
        if (entry.name === 'JavaScriptArray.swift') {
          if (content.includes('self.init(runtime, facebook.jsi.Array(runtime.pointee, length))')) {
            content = content.replace(
              'self.init(runtime, facebook.jsi.Array(runtime.pointee, length))',
              'self.runtime = runtime\n    self.pointee = facebook.jsi.Array(runtime.pointee, length)'
            );
            modified = true;
          }
          if (content.includes('self.init(runtime, length: items.count)')) {
            content = content.replace(
              'self.init(runtime, length: items.count)',
              'self.runtime = runtime\n    self.pointee = facebook.jsi.Array(runtime.pointee, items.count)'
            );
            modified = true;
          }
          if (content.includes('self.init(runtime, items: items)')) {
            content = content.replace(
              'self.init(runtime, items: items)',
              'self.runtime = runtime\n    self.pointee = facebook.jsi.Array(runtime.pointee, items.count)\n\n    for (i, item) in items.enumerated() {\n      self[i] = item\n    }'
            );
            modified = true;
          }
          if (content.includes('self.init(runtime, length: length)')) {
            content = content.replace(
              'self.init(runtime, length: length)',
              'self.runtime = runtime\n    self.pointee = facebook.jsi.Array(runtime.pointee, length)'
            );
            modified = true;
          }
        }

        // Fix 3j: JavaScriptPromise.swift: avoid delegating self.init on ~Copyable struct (Xcode 16 Swift compiler bug)
        if (entry.name === 'JavaScriptPromise.swift') {
          const promiseInitRegex = /@JavaScriptActor\r?\n\s*internal init\(_ runtime: JavaScriptRuntime, _ object: consuming facebook\.jsi\.Object\) throws \{[\s\S]*?^\s*\}/m;
          if (promiseInitRegex.test(content)) {
            content = content.replace(
              promiseInitRegex,
              `@JavaScriptActor
  internal init(_ runtime: JavaScriptRuntime, _ object: consuming facebook.jsi.Object) throws {
    let jsObject = JavaScriptObject(runtime, object)
    self.runtime = runtime
    longLivedState.object.reset(jsObject.asValue())
    try setUpCallbacks()
    runtime.longLivedObjects.add(longLivedState)
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
