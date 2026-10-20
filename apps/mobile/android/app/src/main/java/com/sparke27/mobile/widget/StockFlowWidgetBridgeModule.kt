package com.sparke27.mobile.widget

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Native bridge module connecting React Native task state with the native Android AppWidget subsystem.
 *
 * Persists widget snapshots into Android SharedPreferences and immediately triggers
 * native RemoteViews updates across all active home-screen widgets without requiring
 * heavy background headless JS workers.
 */
class StockFlowWidgetBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "StockFlowWidgetBridge"
        private const val TAG = "StockFlowWidgetBridge"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun setWidgetSnapshot(jsonString: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val prefs = context.getSharedPreferences(StockFlowTasksWidget.PREFS_NAME, Context.MODE_PRIVATE)
            // Use commit() (synchronous) so the snapshot is guaranteed to be persisted
            // before widget providers read it during the immediate redraw below.
            prefs.edit().putString(StockFlowTasksWidget.KEY_SNAPSHOT, jsonString).commit()

            StockFlowTasksWidget.updateAllWidgets(context)
            StockFlowUpcomingWidget.updateAllWidgets(context)

            Log.d(TAG, "Snapshot successfully saved to native SharedPreferences and widgets refreshed")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed writing widget snapshot to SharedPreferences", e)
            promise.reject("WRITE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun refreshWidgets(promise: Promise) {
        try {
            val context = reactApplicationContext
            StockFlowTasksWidget.updateAllWidgets(context)
            StockFlowUpcomingWidget.updateAllWidgets(context)
            Log.d(TAG, "Native widgets refresh requested successfully")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed refreshing native widgets", e)
            promise.reject("REFRESH_ERROR", e.message, e)
        }
    }
}
