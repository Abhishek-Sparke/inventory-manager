import Foundation
import WidgetKit

@objc(StockFlowWidgetReloader)
public class StockFlowWidgetReloader: NSObject {

    private static let knownSuites = [
        "group.com.sparke27.mobile",
        "group.com.sparke27.StockFlow",
        "group.mobile"
    ]

    @objc public static func writeSnapshotAndReload(_ jsonString: String) {
        for suite in knownSuites {
            if let defaults = UserDefaults(suiteName: suite) {
                defaults.set(jsonString, forKey: "stockflow_widget_snapshot")
                defaults.synchronize()
            }
            if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suite) {
                let fileURL = container.appendingPathComponent("stockflow_widget_snapshot.json")
                try? jsonString.write(to: fileURL, atomically: true, encoding: .utf8)
            }
        }

        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    @objc public static func reloadAllTimelines() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    @objc public static func reloadTimelines(ofKind kind: String) {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: kind)
        }
    }
}
