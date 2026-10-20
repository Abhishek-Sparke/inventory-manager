#if __has_include(<Foundation/Foundation.h>)
#import <Foundation/Foundation.h>
#else
#if __has_include(<objc/NSObject.h>)
#import <objc/NSObject.h>
#else
@interface NSObject
+ (id)alloc;
- (id)init;
+ (Class)class;
- (BOOL)respondsToSelector:(SEL)aSelector;
- (id)performSelector:(SEL)aSelector;
@end
#endif

#ifndef BOOL
typedef signed char BOOL;
#define YES ((BOOL)1)
#define NO  ((BOOL)0)
#endif

#ifndef NSUInteger
typedef unsigned long NSUInteger;
#endif

#ifndef NSStringEncoding
typedef NSUInteger NSStringEncoding;
#define NSUTF8StringEncoding 4
#endif

@interface NSString : NSObject
+ (id)stringWithUTF8String:(const char *)nullTerminatedCString;
- (BOOL)writeToURL:(id)url atomically:(BOOL)useAuxiliaryFile encoding:(NSStringEncoding)enc error:(id *)error;
@end

@interface NSNumber : NSObject
+ (NSNumber *)numberWithBool:(BOOL)value;
@end

@interface NSURL : NSObject
- (NSURL *)URLByAppendingPathComponent:(NSString *)pathComponent;
@end

@interface NSArray : NSObject
+ (instancetype)array;
- (NSUInteger)count;
@end

@interface NSMutableArray : NSArray
+ (instancetype)array;
- (void)addObject:(id)anObject;
@end

@interface NSDictionary : NSObject
- (id)objectForKey:(id)aKey;
@end

@interface NSSet : NSObject
+ (instancetype)setWithArray:(NSArray *)array;
- (BOOL)containsObject:(id)anObject;
@end

@interface NSUserDefaults : NSObject
- (instancetype)initWithSuiteName:(NSString *)suitename;
- (void)setObject:(id)value forKey:(NSString *)defaultName;
- (id)objectForKey:(NSString *)defaultName;
- (NSArray *)arrayForKey:(NSString *)defaultName;
- (void)removeObjectForKey:(NSString *)defaultName;
- (BOOL)synchronize;
@end

@interface NSFileManager : NSObject
+ (NSFileManager *)defaultManager;
- (NSURL *)containerURLForSecurityApplicationGroupIdentifier:(NSString *)groupIdentifier;
@end

@interface NSError : NSObject
@end

@interface NSException : NSObject
@property (readonly, copy) NSString *reason;
@end

Class NSClassFromString(NSString *aClassName);
#endif

#if __has_include(<React/RCTBridgeModule.h>)
#import <React/RCTBridgeModule.h>
#elif __has_include("RCTBridgeModule.h")
#import "RCTBridgeModule.h"
#elif __has_include("../../node_modules/react-native/React/Base/RCTBridgeModule.h")
#import "../../node_modules/react-native/React/Base/RCTBridgeModule.h"
#else
// Declarations for static analysis in environments without CocoaPods headers
@protocol RCTBridgeModule <NSObject>
@end

typedef void (^RCTPromiseResolveBlock)(id result);
typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);

#ifndef RCT_EXPORT_MODULE
#define RCT_EXPORT_MODULE(js_name) + (NSString *)moduleName { return @#js_name; }
#endif

#ifndef RCT_EXPORT_METHOD
#define RCT_EXPORT_METHOD(method) - (void)method
#endif
#endif

@interface StockFlowWidgetBridge : NSObject <RCTBridgeModule>
- (void)setWidgetSnapshot:(NSString *)jsonString
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
- (void)refreshWidgets:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject;
- (void)getPendingActions:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
- (void)clearPendingActions:(NSArray *)actionIds
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject;
@end
