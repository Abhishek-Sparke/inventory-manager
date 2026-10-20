#import "StockFlowWidgetBridge.h"
#if __has_include(<WidgetKit/WidgetKit.h>)
#import <WidgetKit/WidgetKit.h>
#endif

@implementation StockFlowWidgetBridge

RCT_EXPORT_MODULE(StockFlowWidgetBridge);

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

static NSArray<NSString *> *getKnownSuites(void)
{
    return @[
        @"group.com.sparke27.mobile",
        @"group.com.sparke27.StockFlow",
        @"group.mobile"
    ];
}

static void reloadWidgetTimelinesSafely(void)
{
    Class reloader = NSClassFromString(@"StockFlowWidgetReloader");
    if (!reloader) {
        reloader = NSClassFromString(@"StockFlow.StockFlowWidgetReloader");
    }
    if (!reloader) {
        reloader = NSClassFromString(@"mobile.StockFlowWidgetReloader");
    }
    if (reloader && [reloader respondsToSelector:@selector(reloadAllTimelines)]) {
        [reloader performSelector:@selector(reloadAllTimelines)];
    }
}

RCT_EXPORT_METHOD(setWidgetSnapshot:(NSString *)jsonString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        NSArray<NSString *> *suites = getKnownSuites();
        for (NSString *suiteName in suites) {
            // 1. Write to UserDefaults suite for WidgetKit
            NSUserDefaults *sharedDefaults = [[NSUserDefaults alloc] initWithSuiteName:suiteName];
            if (sharedDefaults) {
                [sharedDefaults setObject:jsonString forKey:@"stockflow_widget_snapshot"];
                [sharedDefaults synchronize];
            }

            // 2. Write to shared App Group container file as backup
            NSURL *containerURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:suiteName];
            if (containerURL) {
                NSURL *fileURL = [containerURL URLByAppendingPathComponent:@"stockflow_widget_snapshot.json"];
                [jsonString writeToURL:fileURL atomically:YES encoding:NSUTF8StringEncoding error:nil];
            }
        }

        // 3. Delegate to Swift reloader for direct WidgetKit invocation
        Class reloader = NSClassFromString(@"StockFlowWidgetReloader");
        if (!reloader) {
            reloader = NSClassFromString(@"StockFlow.StockFlowWidgetReloader");
        }
        if (reloader && [reloader respondsToSelector:@selector(writeSnapshotAndReload:)]) {
            [reloader performSelector:@selector(writeSnapshotAndReload:) withObject:jsonString];
        } else {
            reloadWidgetTimelinesSafely();
        }

        resolve(@(YES));
    } @catch (NSException *exception) {
        reject(@"WRITE_ERROR", exception.reason, nil);
    }
}

RCT_EXPORT_METHOD(refreshWidgets:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        reloadWidgetTimelinesSafely();
        resolve(@(YES));
    } @catch (NSException *exception) {
        reject(@"REFRESH_ERROR", exception.reason, nil);
    }
}

RCT_EXPORT_METHOD(getPendingActions:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        NSString *suiteName = @"group.com.sparke27.mobile";
        NSUserDefaults *sharedDefaults = [[NSUserDefaults alloc] initWithSuiteName:suiteName];
        NSArray *pending = nil;
        if (sharedDefaults) {
            pending = [sharedDefaults arrayForKey:@"stockflow_pending_actions"];
        }
        if (!pending) {
            pending = [NSArray array];
        }
        resolve(pending);
    } @catch (NSException *exception) {
        reject(@"GET_ACTIONS_ERROR", exception.reason, nil);
    }
}

RCT_EXPORT_METHOD(clearPendingActions:(NSArray *)actionIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        NSString *suiteName = @"group.com.sparke27.mobile";
        NSUserDefaults *sharedDefaults = [[NSUserDefaults alloc] initWithSuiteName:suiteName];
        if (sharedDefaults) {
            if (!actionIds || [actionIds count] == 0) {
                [sharedDefaults removeObjectForKey:@"stockflow_pending_actions"];
            } else {
                NSArray *current = [sharedDefaults arrayForKey:@"stockflow_pending_actions"];
                if (current) {
                    NSMutableArray *filtered = [NSMutableArray array];
                    NSSet *idSet = [NSSet setWithArray:actionIds];
                    for (id item in current) {
                        if ([item isKindOfClass:[NSDictionary class]]) {
                            NSString *itemId = [item objectForKey:@"id"];
                            if (itemId && ![idSet containsObject:itemId]) {
                                [filtered addObject:item];
                            }
                        }
                    }
                    [sharedDefaults setObject:filtered forKey:@"stockflow_pending_actions"];
                }
            }
            [sharedDefaults synchronize];
        }
        resolve(@(YES));
    } @catch (NSException *exception) {
        reject(@"CLEAR_ACTIONS_ERROR", exception.reason, nil);
    }
}

@end
