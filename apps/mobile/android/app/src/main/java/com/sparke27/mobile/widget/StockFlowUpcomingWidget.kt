package com.sparke27.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import com.sparke27.mobile.R
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Native Android AppWidgetProvider for the StockFlow Upcoming 7-Day Tasks Widget.
 *
 * Implements native RemoteViews rendering directly from persistent local storage
 * (Android SharedPreferences and offline SQLite database `stockflow.db`).
 * Extends standard Android AppWidgetProvider to guarantee rock-solid native layout
 * inflation without relying on cross-process image provider IPC.
 */
class StockFlowUpcomingWidget : AppWidgetProvider() {

    companion object {
        const val TAG = "StockFlowUpcomingWidget"

        /**
         * Triggers an immediate refresh of all placed StockFlowUpcomingWidget instances.
         */
        fun updateAllWidgets(context: Context) {
            try {
                val appWidgetManager = AppWidgetManager.getInstance(context)
                val componentName = ComponentName(context, StockFlowUpcomingWidget::class.java)
                val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
                if (appWidgetIds != null && appWidgetIds.isNotEmpty()) {
                    Log.d(TAG, "updateAllWidgets: refreshing ${appWidgetIds.size} StockFlowUpcomingWidget instance(s)")
                    val provider = StockFlowUpcomingWidget()
                    provider.renderAllInstances(context, appWidgetManager, appWidgetIds)
                } else {
                    Log.d(TAG, "updateAllWidgets: no active StockFlowUpcomingWidget instances placed on home screen")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in updateAllWidgets", e)
            }
        }
    }

    data class UpcomingTaskItem(
        val id: Long,
        val title: String,
        val timeFormatted: String,
        val dateFormatted: String,
        val priority: String,
        val isCompleted: Boolean
    )

    data class UpcomingSnapshot(
        val total: Int,
        val tasks: List<UpcomingTaskItem>,
        val isStale: Boolean
    )

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        Log.d(TAG, "onUpdate: updating ${appWidgetIds.size} upcoming widget(s)")
        renderAllInstances(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return
        Log.d(TAG, "onReceive: action=$action")

        when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_SET,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_DATE_CHANGED,
            "com.sparke27.mobile.REFRESH_WIDGET" -> {
                updateAllWidgets(context)
            }
        }
    }

    internal fun renderAllInstances(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val snapshot = loadUpcomingSnapshot(context)
        Log.d(TAG, "renderAllInstances: rendering ${appWidgetIds.size} widgets with snapshot total=${snapshot.total}, stale=${snapshot.isStale}")

        for (appWidgetId in appWidgetIds) {
            try {
                val views = RemoteViews(context.packageName, R.layout.stockflow_widget_upcoming)

                // Setup deep link click PendingIntent to open StockFlow Upcoming view
                val deepLinkIntent = Intent(Intent.ACTION_VIEW, Uri.parse("mobile://tasks?view=upcoming")).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                val pendingIntent = PendingIntent.getActivity(
                    context,
                    appWidgetId,
                    deepLinkIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                // Setup deep link click PendingIntent to open the Add Task modal
                val addTaskIntent = Intent(Intent.ACTION_VIEW, Uri.parse("mobile://tasks?action=new")).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                val addTaskPendingIntent = PendingIntent.getActivity(
                    context,
                    appWidgetId + 20000,
                    addTaskIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                views.setOnClickPendingIntent(R.id.widget_upcoming_root, pendingIntent)
                views.setOnClickPendingIntent(R.id.widget_upcoming_empty_state, pendingIntent)
                views.setOnClickPendingIntent(R.id.widget_upcoming_tasks_container, pendingIntent)
                views.setOnClickPendingIntent(R.id.upcoming_item_1, pendingIntent)
                views.setOnClickPendingIntent(R.id.upcoming_item_2, pendingIntent)
                views.setOnClickPendingIntent(R.id.upcoming_item_3, pendingIntent)
                views.setOnClickPendingIntent(R.id.upcoming_item_4, pendingIntent)

                // Bind the + Add buttons to open the Add Task modal
                views.setOnClickPendingIntent(R.id.widget_upcoming_btn_add, addTaskPendingIntent)
                views.setOnClickPendingIntent(R.id.widget_upcoming_empty_btn_add, addTaskPendingIntent)

                bindViews(views, snapshot)

                appWidgetManager.updateAppWidget(appWidgetId, views)
                Log.d(TAG, "renderAllInstances: successfully updated appWidgetId=$appWidgetId")
            } catch (e: Exception) {
                Log.e(TAG, "Failed rendering upcoming widget $appWidgetId", e)
            }
        }
    }

    private fun bindViews(views: RemoteViews, snapshot: UpcomingSnapshot) {
        views.setTextViewText(R.id.widget_upcoming_title, "📅 Upcoming 7 Days")

        if (snapshot.isStale) {
            views.setTextViewText(R.id.widget_upcoming_status, "⚠️ Tap to sync")
            views.setTextColor(R.id.widget_upcoming_status, Color.parseColor("#F59E0B"))
        } else if (snapshot.total > 0) {
            views.setTextViewText(R.id.widget_upcoming_status, "${snapshot.total} scheduled")
            views.setTextColor(R.id.widget_upcoming_status, Color.parseColor("#E2E8F0"))
        } else {
            views.setTextViewText(R.id.widget_upcoming_status, "Next 7 Days")
            views.setTextColor(R.id.widget_upcoming_status, Color.parseColor("#94A3B8"))
        }

        if (snapshot.total == 0) {
            views.setViewVisibility(R.id.widget_upcoming_empty_state, View.VISIBLE)
            views.setViewVisibility(R.id.widget_upcoming_tasks_container, View.GONE)

            views.setTextViewText(R.id.widget_upcoming_empty_title, "No upcoming tasks next 7 days")
            views.setTextViewText(R.id.widget_upcoming_empty_subtitle, "All caught up • Tap to open app")
        } else {
            views.setViewVisibility(R.id.widget_upcoming_empty_state, View.GONE)
            views.setViewVisibility(R.id.widget_upcoming_tasks_container, View.VISIBLE)

            val tasks = snapshot.tasks
            val itemIds = listOf(R.id.upcoming_item_1, R.id.upcoming_item_2, R.id.upcoming_item_3, R.id.upcoming_item_4)
            val dateIds = listOf(R.id.upcoming_date_1, R.id.upcoming_date_2, R.id.upcoming_date_3, R.id.upcoming_date_4)
            val checkIds = listOf(R.id.upcoming_check_1, R.id.upcoming_check_2, R.id.upcoming_check_3, R.id.upcoming_check_4)
            val titleIds = listOf(R.id.upcoming_title_1, R.id.upcoming_title_2, R.id.upcoming_title_3, R.id.upcoming_title_4)
            val timeIds = listOf(R.id.upcoming_time_1, R.id.upcoming_time_2, R.id.upcoming_time_3, R.id.upcoming_time_4)

            for (i in 0 until 4) {
                if (i < tasks.size) {
                    val task = tasks[i]
                    views.setViewVisibility(itemIds[i], View.VISIBLE)
                    views.setTextViewText(dateIds[i], "${task.dateFormatted} ")
                    views.setTextViewText(titleIds[i], task.title)
                    views.setTextViewText(timeIds[i], task.timeFormatted)

                    if (task.isCompleted) {
                        views.setTextViewText(checkIds[i], "✓ ")
                        views.setTextColor(checkIds[i], Color.parseColor("#10B981"))
                        views.setTextColor(titleIds[i], Color.parseColor("#94A3B8"))
                    } else {
                        views.setTextViewText(checkIds[i], "○ ")
                        views.setTextColor(checkIds[i], Color.parseColor("#60A5FA"))
                        views.setTextColor(titleIds[i], Color.parseColor("#F1F5F9"))
                    }
                } else {
                    views.setViewVisibility(itemIds[i], View.GONE)
                }
            }

            val remaining = tasks.size - 4
            if (remaining > 0) {
                views.setViewVisibility(R.id.upcoming_remaining_count, View.VISIBLE)
                views.setTextViewText(R.id.upcoming_remaining_count, "+ $remaining more tasks")
            } else {
                views.setViewVisibility(R.id.upcoming_remaining_count, View.GONE)
            }
        }
    }

    private fun loadUpcomingSnapshot(context: Context): UpcomingSnapshot {
        try {
            val prefs = context.getSharedPreferences(StockFlowTasksWidget.PREFS_NAME, Context.MODE_PRIVATE)
            val jsonStr = prefs.getString(StockFlowTasksWidget.KEY_SNAPSHOT, null)
            if (!jsonStr.isNullOrEmpty()) {
                val json = JSONObject(jsonStr)
                val upcomingObj = json.optJSONObject("upcoming7Days")
                if (upcomingObj != null) {
                    val updatedAt = json.optString("updatedAt", "")
                    var isStale = false
                    if (updatedAt.isNotEmpty()) {
                        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                        if (!updatedAt.startsWith(todayStr)) {
                            isStale = true
                        }
                    }

                    // If stale across midnight, query SQLite on device first for fresh upcoming tasks
                    if (isStale) {
                        val freshSqlite = querySQLiteUpcoming(context)
                        if (freshSqlite != null) {
                            Log.d(TAG, "loadUpcomingSnapshot: Stale SharedPreferences superseded by fresh SQLite data total=${freshSqlite.total}")
                            return freshSqlite
                        }
                    }

                    val total = upcomingObj.optInt("total", 0)
                    val tasksArray = upcomingObj.optJSONArray("tasks")
                    val taskList = mutableListOf<UpcomingTaskItem>()

                    if (tasksArray != null) {
                        for (i in 0 until tasksArray.length()) {
                            val item = tasksArray.optJSONObject(i) ?: continue
                            taskList.add(
                                UpcomingTaskItem(
                                    id = item.optLong("id", 0L),
                                    title = item.optString("title", "Untitled Task"),
                                    timeFormatted = item.optString("timeFormatted", "--:--"),
                                    dateFormatted = item.optString("dateFormatted", "Tomorrow"),
                                    priority = item.optString("priority", "medium"),
                                    isCompleted = item.optBoolean("isCompleted", false)
                                )
                            )
                        }
                    }

                    Log.d(TAG, "loadUpcomingSnapshot: SharedPreferences snapshot parsed total=$total, isStale=$isStale")
                    return UpcomingSnapshot(total, taskList, isStale)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not parse upcoming snapshot from SharedPreferences", e)
        }

        val sqliteSnapshot = querySQLiteUpcoming(context)
        if (sqliteSnapshot != null) {
            Log.d(TAG, "loadUpcomingSnapshot: SQLite fallback resolved total=${sqliteSnapshot.total}")
            return sqliteSnapshot
        }

        Log.d(TAG, "loadUpcomingSnapshot: No upcoming snapshot or SQLite data found, returning empty snapshot")
        return UpcomingSnapshot(0, emptyList(), false)
    }

    private fun querySQLiteUpcoming(context: Context): UpcomingSnapshot? {
        val dbFile = context.getDatabasePath("stockflow.db")
        if (!dbFile.exists()) return null

        var db: SQLiteDatabase? = null
        try {
            db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)

            // Compute start of tomorrow and end of 7 days from now in local epoch millis
            val startOfTomorrowCal = Calendar.getInstance().apply {
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val startOfTomorrowMs = startOfTomorrowCal.timeInMillis

            val endOf7DaysCal = Calendar.getInstance().apply {
                add(Calendar.DAY_OF_YEAR, 8)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val endOf7DaysMs = endOf7DaysCal.timeInMillis - 1

            // Build local date string for "Tomorrow" label comparison
            val tomorrowLocalSdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val tomorrowStr = tomorrowLocalSdf.format(startOfTomorrowCal.time)

            val cursor = db.rawQuery(
                "SELECT id, title, scheduled_at, priority, is_completed, status FROM tasks WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC",
                null
            )

            cursor.use { c ->
                val idIdx = c.getColumnIndex("id")
                val titleIdx = c.getColumnIndex("title")
                val schedIdx = c.getColumnIndex("scheduled_at")
                val prioIdx = c.getColumnIndex("priority")
                val compIdx = c.getColumnIndex("is_completed")
                val statusIdx = c.getColumnIndex("status")

                val upcomingTasks = mutableListOf<UpcomingTaskItem>()

                while (c.moveToNext()) {
                    val id = if (idIdx >= 0) c.getLong(idIdx) else 0L
                    val title = if (titleIdx >= 0) c.getString(titleIdx) else ""
                    val sched = if (schedIdx >= 0) c.getString(schedIdx) else ""
                    val prio = if (prioIdx >= 0) c.getString(prioIdx) else "medium"
                    val isCompInt = if (compIdx >= 0) c.getInt(compIdx) else 0
                    val status = if (statusIdx >= 0) c.getString(statusIdx) else "pending"
                    val isDone = isCompInt == 1 || status.equals("completed", ignoreCase = true)

                    // Parse the stored ISO timestamp (UTC or local) and filter against local date range
                    val epochMs = try { parseIsoToEpochMs(sched) } catch (_: Exception) { continue }
                    if (epochMs < startOfTomorrowMs || epochMs > endOf7DaysMs) continue

                    val dateFormatted = formatDate(epochMs, startOfTomorrowMs, tomorrowStr)
                    val timeFormatted = formatTime(epochMs)

                    upcomingTasks.add(
                        UpcomingTaskItem(
                            id = id,
                            title = title,
                            timeFormatted = timeFormatted,
                            dateFormatted = dateFormatted,
                            priority = prio,
                            isCompleted = isDone
                        )
                    )
                }

                upcomingTasks.sortWith(compareBy({ it.isCompleted }, { it.dateFormatted }, { it.timeFormatted }))
                return UpcomingSnapshot(upcomingTasks.size, upcomingTasks, false)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed reading SQLite stockflow.db for upcoming tasks", e)
            return null
        } finally {
            try {
                db?.close()
            } catch (_: Exception) {}
        }
    }

    /**
     * Parses an ISO date/datetime string to epoch milliseconds.
     * Handles UTC (Z suffix) and local datetime formats.
     */
    private fun parseIsoToEpochMs(iso: String): Long {
        val utcFormats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm'Z'"
        )
        for (fmt in utcFormats) {
            try {
                val sdf = SimpleDateFormat(fmt, Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                val d = sdf.parse(iso)
                if (d != null) return d.time
            } catch (_: Exception) {}
        }
        val localFormats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm"
        )
        for (fmt in localFormats) {
            try {
                val sdf = SimpleDateFormat(fmt, Locale.US)
                val d = sdf.parse(iso)
                if (d != null) return d.time
            } catch (_: Exception) {}
        }
        try {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            val d = sdf.parse(iso.take(10))
            if (d != null) return d.time
        } catch (_: Exception) {}
        throw IllegalArgumentException("Unparseable ISO date: $iso")
    }

    private fun formatDate(epochMs: Long, startOfTomorrowMs: Long, tomorrowStr: String): String {
        // Check if epoch falls on "tomorrow" in local time
        val startOfDayAfterTomorrow = startOfTomorrowMs + 86_400_000L
        return if (epochMs in startOfTomorrowMs until startOfDayAfterTomorrow) {
            "Tomorrow"
        } else {
            try {
                SimpleDateFormat("MMM d", Locale.getDefault()).format(java.util.Date(epochMs))
            } catch (_: Exception) {
                "Upcoming"
            }
        }
    }

    private fun formatTime(epochMs: Long): String {
        return try {
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date(epochMs))
        } catch (_: Exception) {
            "--:--"
        }
    }
}
