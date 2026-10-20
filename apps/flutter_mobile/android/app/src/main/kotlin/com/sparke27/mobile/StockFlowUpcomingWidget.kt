package com.sparke27.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetPlugin
import org.json.JSONObject

class StockFlowUpcomingWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_upcoming)

            val intent = Intent(context, MainActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_upcoming_root, pendingIntent)

            try {
                val widgetData = HomeWidgetPlugin.getData(context)
                val snapshotStr = widgetData.getString("stockflow_widget_snapshot_v1", null)

                if (snapshotStr != null) {
                    val root = JSONObject(snapshotStr)
                    val upcomingObj = root.optJSONObject("upcoming7Days")
                    val total = upcomingObj?.optInt("total", 0) ?: 0
                    val tasksArr = upcomingObj?.optJSONArray("tasks")

                    views.setTextViewText(R.id.widget_upcoming_count, "$total upcoming")

                    if (tasksArr != null && tasksArr.length() > 0) {
                        val sb = StringBuilder()
                        val maxDisplay = minOf(tasksArr.length(), 3)
                        for (i in 0 until maxDisplay) {
                            val t = tasksArr.getJSONObject(i)
                            val title = t.optString("title", "")
                            sb.append("• ").append(title).append("\n")
                        }
                        if (tasksArr.length() > 3) {
                            sb.append("+ ${tasksArr.length() - 3} more")
                        }
                        views.setTextViewText(R.id.widget_upcoming_preview, sb.toString().trim())
                    } else {
                        views.setTextViewText(
                            R.id.widget_upcoming_preview,
                            "No upcoming tasks scheduled for the next 7 days."
                        )
                    }
                } else {
                    views.setTextViewText(R.id.widget_upcoming_count, "0 upcoming")
                    views.setTextViewText(
                        R.id.widget_upcoming_preview,
                        "Open StockFlow to view upcoming schedule."
                    )
                }
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_upcoming_preview, "StockFlow Upcoming")
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
