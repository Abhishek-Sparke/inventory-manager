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
 * Native Android AppWidgetProvider for the StockFlow Today's Tasks Widget.
 *
 * Implements native RemoteViews rendering directly from persistent local storage
 * (Android SharedPreferences and offline SQLite database `stockflow.db`).
 * Extends standard Android AppWidgetProvider to guarantee rock-solid native layout
 * inflation without relying on cross-process image provider IPC.
 */
class StockFlowTasksWidget : AppWidgetProvider() {

    companion object {
        const val TAG = "StockFlowTasksWidget"
        const val PREFS_NAME = "StockFlowWidgetPrefs"
        const val KEY_SNAPSHOT = "tasks_snapshot_json"

        /**
         * Triggers an immediate refresh of all placed StockFlowTasksWidget instances.
         */
        fun updateAllWidgets(context: Context) {
            try {
                val appWidgetManager = AppWidgetManager.getInstance(context)
                val componentName = ComponentName(context, StockFlowTasksWidget::class.java)
                val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
                if (appWidgetIds != null && appWidgetIds.isNotEmpty()) {
                    Log.d(TAG, "updateAllWidgets: refreshing ${appWidgetIds.size} StockFlowTasksWidget instance(s)")
                    val provider = StockFlowTasksWidget()
                    provider.renderAllInstances(context, appWidgetManager, appWidgetIds)
                } else {
                    Log.d(TAG, "updateAllWidgets: no active StockFlowTasksWidget instances placed on home screen")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in updateAllWidgets", e)
            }
        }
    }

    data class TaskItem(
        val id: Long,
        val title: String,
        val timeFormatted: String,
        val priority: String,
        val isCompleted: Boolean
    )

    data class TodaySnapshot(
        val total: Int,
        val completed: Int,
        val percent: Int,
        val tasks: List<TaskItem>,
        val isStale: Boolean
    )

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        Log.d(TAG, "onUpdate: updating ${appWidgetIds.size} widget instance(s)")
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
        val snapshot = loadTodaySnapshot(context)
        Log.d(TAG, "renderAllInstances: rendering ${appWidgetIds.size} widgets with snapshot total=${snapshot.total}, completed=${snapshot.completed}, percent=${snapshot.percent}%, stale=${snapshot.isStale}")

        for (appWidgetId in appWidgetIds) {
            try {
                val views = RemoteViews(context.packageName, R.layout.stockflow_widget_tasks)

                // Setup deep link click PendingIntent to open StockFlow Today view
                val deepLinkIntent = Intent(Intent.ACTION_VIEW, Uri.parse("mobile://tasks?view=today")).apply {
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
                    appWidgetId + 10000,
                    addTaskIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                // Bind click handler to entire card and interactive containers
                views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)
                views.setOnClickPendingIntent(R.id.widget_empty_state, pendingIntent)
                views.setOnClickPendingIntent(R.id.widget_tasks_container, pendingIntent)
                views.setOnClickPendingIntent(R.id.task_item_1, pendingIntent)
                views.setOnClickPendingIntent(R.id.task_item_2, pendingIntent)
                views.setOnClickPendingIntent(R.id.task_item_3, pendingIntent)

                // Bind the + Add buttons to open the Add Task modal
                views.setOnClickPendingIntent(R.id.widget_btn_add, addTaskPendingIntent)
                views.setOnClickPendingIntent(R.id.widget_empty_btn_add, addTaskPendingIntent)

                // Populate views with actual data
                bindViews(views, snapshot)

                appWidgetManager.updateAppWidget(appWidgetId, views)
                Log.d(TAG, "renderAllInstances: successfully updated appWidgetId=$appWidgetId")
            } catch (e: Exception) {
                Log.e(TAG, "Failed rendering widget $appWidgetId", e)
            }
        }
    }

    private fun bindViews(views: RemoteViews, snapshot: TodaySnapshot) {
        views.setTextViewText(R.id.widget_title, "⚡ StockFlow Tasks")

        if (snapshot.isStale) {
            views.setTextViewText(R.id.widget_status, "⚠️ Tap to sync")
            views.setTextColor(R.id.widget_status, Color.parseColor("#F59E0B"))
        } else if (snapshot.total > 0) {
            views.setTextViewText(
                R.id.widget_status,
                "${snapshot.completed}/${snapshot.total} Done (${snapshot.percent}%)"
            )
            views.setTextColor(R.id.widget_status, Color.parseColor("#E2E8F0"))
        } else {
            views.setTextViewText(R.id.widget_status, "Today")
            views.setTextColor(R.id.widget_status, Color.parseColor("#94A3B8"))
        }

        if (snapshot.total == 0) {
            // Diagnostic Empty State: visible with clear StockFlow title and guidance
            views.setViewVisibility(R.id.widget_empty_state, View.VISIBLE)
            views.setViewVisibility(R.id.widget_tasks_container, View.GONE)
            views.setViewVisibility(R.id.widget_progress_bar, View.GONE)

            views.setTextViewText(R.id.widget_empty_title, "No tasks scheduled for today")
            views.setTextViewText(R.id.widget_empty_subtitle, "All caught up • Tap to open app")
        } else {
            // Active Tasks State: show progress bar and up to 3 task rows
            views.setViewVisibility(R.id.widget_empty_state, View.GONE)
            views.setViewVisibility(R.id.widget_tasks_container, View.VISIBLE)
            views.setViewVisibility(R.id.widget_progress_bar, View.VISIBLE)

            views.setProgressBar(R.id.widget_progress_bar, 100, snapshot.percent, false)

            val tasks = snapshot.tasks
            val taskItemIds = listOf(R.id.task_item_1, R.id.task_item_2, R.id.task_item_3)
            val checkIds = listOf(R.id.task_check_1, R.id.task_check_2, R.id.task_check_3)
            val titleIds = listOf(R.id.task_title_1, R.id.task_title_2, R.id.task_title_3)
            val timeIds = listOf(R.id.task_time_1, R.id.task_time_2, R.id.task_time_3)

            for (i in 0 until 3) {
                if (i < tasks.size) {
                    val task = tasks[i]
                    views.setViewVisibility(taskItemIds[i], View.VISIBLE)
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
                    views.setViewVisibility(taskItemIds[i], View.GONE)
                }
            }

            val remaining = tasks.size - 3
            if (remaining > 0) {
                views.setViewVisibility(R.id.task_remaining_count, View.VISIBLE)
                views.setTextViewText(
                    R.id.task_remaining_count,
                    "+ $remaining more task${if (remaining == 1) "" else "s"} today"
                )
            } else {
                views.setViewVisibility(R.id.task_remaining_count, View.GONE)
            }
        }
    }

    private fun loadTodaySnapshot(context: Context): TodaySnapshot {
        // 1. Try reading the JSON snapshot from SharedPreferences (written by native bridge)
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val jsonStr = prefs.getString(KEY_SNAPSHOT, null)
            if (!jsonStr.isNullOrEmpty()) {
                val json = JSONObject(jsonStr)
                val todayObj = json.optJSONObject("today")
                if (todayObj != null) {
                    val updatedAt = json.optString("updatedAt", "")
                    var isStale = false
                    if (updatedAt.isNotEmpty()) {
                        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                        if (!updatedAt.startsWith(todayStr)) {
                            isStale = true
                        }
                    }

                    // If stale across midnight, query SQLite on device first for today's fresh tasks
                    if (isStale) {
                        val freshSqlite = querySQLiteToday(context)
                        if (freshSqlite != null) {
                            Log.d(TAG, "loadTodaySnapshot: Stale SharedPreferences superseded by fresh SQLite data total=${freshSqlite.total}")
                            return freshSqlite
                        }
                    }

                    val total = todayObj.optInt("total", 0)
                    val completed = todayObj.optInt("completed", 0)
                    val percent = todayObj.optInt("percent", 0)
                    val tasksArray = todayObj.optJSONArray("tasks")
                    val taskList = mutableListOf<TaskItem>()

                    if (tasksArray != null) {
                        for (i in 0 until tasksArray.length()) {
                            val item = tasksArray.optJSONObject(i) ?: continue
                            taskList.add(
                                TaskItem(
                                    id = item.optLong("id", 0L),
                                    title = item.optString("title", "Untitled Task"),
                                    timeFormatted = item.optString("timeFormatted", "--:--"),
                                    priority = item.optString("priority", "medium"),
                                    isCompleted = item.optBoolean("isCompleted", false)
                                )
                            )
                        }
                    }

                    Log.d(TAG, "loadTodaySnapshot: SharedPreferences snapshot parsed total=$total, completed=$completed, percent=$percent%, isStale=$isStale")
                    return TodaySnapshot(total, completed, percent, taskList, isStale)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not parse snapshot from SharedPreferences", e)
        }

        // 2. Fallback: Query SQLite database stockflow.db directly
        val sqliteSnapshot = querySQLiteToday(context)
        if (sqliteSnapshot != null) {
            Log.d(TAG, "loadTodaySnapshot: SQLite fallback resolved total=${sqliteSnapshot.total}, completed=${sqliteSnapshot.completed}")
            return sqliteSnapshot
        }

        Log.d(TAG, "loadTodaySnapshot: No snapshot or SQLite data found, returning empty snapshot")
        return TodaySnapshot(0, 0, 0, emptyList(), false)
    }

    private fun querySQLiteToday(context: Context): TodaySnapshot? {
        val dbFile = context.getDatabasePath("stockflow.db")
        if (!dbFile.exists()) return null

        var db: SQLiteDatabase? = null
        try {
            db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)

            // Use local date string for comparison (tasks stored as UTC ISO, convert to local)
            val localCal = Calendar.getInstance()
            val localDateSdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val todayStr = localDateSdf.format(localCal.time)

            // Compute start/end of today in UTC epoch millis to correctly filter UTC-stored timestamps
            val startOfTodayLocal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis

            val endOfTodayLocal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 23)
                set(Calendar.MINUTE, 59)
                set(Calendar.SECOND, 59)
                set(Calendar.MILLISECOND, 999)
            }.timeInMillis

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

                val todayTasks = mutableListOf<TaskItem>()
                var completedCount = 0

                while (c.moveToNext()) {
                    val id = if (idIdx >= 0) c.getLong(idIdx) else 0L
                    val title = if (titleIdx >= 0) c.getString(titleIdx) else ""
                    val sched = if (schedIdx >= 0) c.getString(schedIdx) else ""
                    val prio = if (prioIdx >= 0) c.getString(prioIdx) else "medium"
                    val isCompInt = if (compIdx >= 0) c.getInt(compIdx) else 0
                    val status = if (statusIdx >= 0) c.getString(statusIdx) else "pending"
                    val isDone = isCompInt == 1 || status.equals("completed", ignoreCase = true)

                    // Parse the stored ISO timestamp (which may be UTC with Z suffix) and
                    // compare against today's local date range to handle timezone correctly.
                    val isToday = isScheduledToday(sched, startOfTodayLocal, endOfTodayLocal)

                    if (isToday) {
                        if (isDone) completedCount++
                        val timeFormatted = formatTimeFromIso(sched)
                        todayTasks.add(
                            TaskItem(
                                id = id,
                                title = title,
                                timeFormatted = timeFormatted,
                                priority = prio,
                                isCompleted = isDone
                            )
                        )
                    }
                }

                // Sort pending tasks first, then by time
                todayTasks.sortWith(compareBy({ it.isCompleted }, { it.timeFormatted }))

                val total = todayTasks.size
                val percent = if (total > 0) Math.round((completedCount.toFloat() / total) * 100) else 0
                return TodaySnapshot(total, completedCount, percent, todayTasks, false)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed reading SQLite stockflow.db", e)
            return null
        } finally {
            try {
                db?.close()
            } catch (_: Exception) {}
        }
    }

    /**
     * Returns true if the given ISO string (UTC or local) falls within today's local date.
     * Handles both plain "yyyy-MM-dd" prefix and full UTC ISO "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" formats.
     */
    private fun isScheduledToday(isoString: String, startOfTodayMs: Long, endOfTodayMs: Long): Boolean {
        if (isoString.isEmpty()) return false
        return try {
            val epochMs = parseIsoToEpochMs(isoString)
            epochMs in startOfTodayMs..endOfTodayMs
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Parses an ISO date/datetime string to epoch milliseconds.
     * Handles: "yyyy-MM-dd", "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
     * and "yyyy-MM-dd'T'HH:mm:ss" (local).
     */
    private fun parseIsoToEpochMs(iso: String): Long {
        // Full UTC ISO with Z suffix — parse as UTC
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
        // Local datetime (no Z) — parse in device timezone
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
        // Plain date only
        try {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            val d = sdf.parse(iso.take(10))
            if (d != null) return d.time
        } catch (_: Exception) {}
        throw IllegalArgumentException("Unparseable ISO date: $iso")
    }

    private fun formatTimeFromIso(iso: String): String {
        return try {
            val epochMs = parseIsoToEpochMs(iso)
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date(epochMs))
        } catch (_: Exception) {
            if (iso.length >= 16 && iso.contains("T")) {
                iso.substring(11, 16)
            } else "--:--"
        }
    }
}
