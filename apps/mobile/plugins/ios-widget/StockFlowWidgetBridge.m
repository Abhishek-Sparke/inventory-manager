#import "StockFlowWidgetBridge.h"
#import <WidgetKit/WidgetKit.h>

@implementation StockFlowWidgetBridge

RCT_EXPORT_MODULE(StockFlowWidgetBridge);

+ (BOOL)requiresMainQueueSetup
{
    return NO;
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
        if (@available(iOS 14.0, *)) {
            [WidgetCenter.sharedWidgetCenter reloadAllTimelines];
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
        if (@available(iOS 14.0, *)) {
            [WidgetCenter.sharedWidgetCenter reloadAllTimelines];
        }
        resolve(@(YES));
    } @catch (NSException *exception) {
        reject(@"REFRESH_ERROR", exception.reason, nil);
    }
}

@end
