package com.sparke27.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetPlugin
import org.json.JSONObject

class StockFlowTasksWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_tasks)

            // Pending intent to launch StockFlow MainActivity when tapping widget
            val intent = Intent(context, MainActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_tasks_root, pendingIntent)

            // Retrieve shared widget data
            try {
                val widgetData = HomeWidgetPlugin.getData(context)
                val snapshotStr = widgetData.getString("stockflow_widget_snapshot_v1", null)
                val todayTotal = widgetData.getInt("today_total", 0)
                val todayCompleted = widgetData.getInt("today_completed", 0)
                val todayPercent = widgetData.getInt("today_percent", 0)

                views.setTextViewText(R.id.widget_tasks_progress, "$todayPercent% Done")
                views.setProgressBar(R.id.widget_tasks_progressbar, 100, todayPercent, false)
                views.setTextViewText(
                    R.id.widget_tasks_summary,
                    "$todayCompleted of $todayTotal tasks completed today"
                )

                if (snapshotStr != null) {
                    val root = JSONObject(snapshotStr)
                    val todayObj = root.optJSONObject("today")
                    val tasksArr = todayObj?.optJSONArray("tasks")

                    if (tasksArr != null && tasksArr.length() > 0) {
                        // Find first incomplete task or first task
                        var firstTaskTitle = ""
                        for (i in 0 until tasksArr.length()) {
                            val t = tasksArr.getJSONObject(i)
                            if (!t.optBoolean("isCompleted", false)) {
                                val time = t.optString("timeFormatted", "")
                                firstTaskTitle = "${t.optString("title", "")} ($time)"
                                break
                            }
                        }
                        if (firstTaskTitle.isEmpty() && tasksArr.length() > 0) {
                            firstTaskTitle = "All today's tasks completed!"
                        }
                        views.setTextViewText(R.id.widget_tasks_first_task, firstTaskTitle)
                    } else {
                        views.setTextViewText(R.id.widget_tasks_first_task, "No tasks scheduled for today")
                    }
                } else {
                    views.setTextViewText(R.id.widget_tasks_first_task, "Open StockFlow to view tasks")
                }
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_tasks_first_task, "StockFlow")
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
