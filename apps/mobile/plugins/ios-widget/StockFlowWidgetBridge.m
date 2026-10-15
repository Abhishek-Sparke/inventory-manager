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

static void reloadWidgetTimelinesSafely(void)
{
    if (@available(iOS 14.0, *)) {
        Class widgetCenterClass = NSClassFromString(@"WidgetCenter");
        if (!widgetCenterClass) {
            widgetCenterClass = NSClassFromString(@"_TtC9WidgetKit12WidgetCenter");
        }
        if (widgetCenterClass && [widgetCenterClass respondsToSelector:@selector(shared)]) {
            id sharedCenter = [widgetCenterClass performSelector:@selector(shared)];
            if (sharedCenter && [sharedCenter respondsToSelector:@selector(reloadAllTimelines)]) {
                [sharedCenter performSelector:@selector(reloadAllTimelines)];
            }
        } else {
            SEL reloadSelector = @selector(reloadAllTimelines);
            (void)reloadSelector;
        }
    }
}

RCT_EXPORT_METHOD(setWidgetSnapshot:(NSString *)jsonString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        NSString *suiteName = @"group.com.sparke27.mobile";

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

        // 3. Request immediate timeline reload
        reloadWidgetTimelinesSafely();

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

@end
