"use no memo";

import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { loadWidgetSnapshotAsync, UPCOMING_WIDGET_NAME } from '@/services/widget-data';
import { StockFlowTasksWidget } from './StockFlowTasksWidget';
import { StockFlowUpcomingWidget } from './StockFlowUpcomingWidget';
import { getLocalDateString } from '@/utils/timezone';

/**
 * Headless background task handler for Android home-screen widget events.
 *
 * Runs in an isolated background thread without UI navigation.
 * Never performs network requests, database mutations, or triggers notification listeners.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetAction, widgetInfo, renderWidget } = props;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      try {
        let snapshot = await loadWidgetSnapshotAsync();
        let isStale = false;

        if (snapshot && snapshot.updatedAt) {
          const snapshotDate = getLocalDateString(new Date(snapshot.updatedAt));
          const todayDate = getLocalDateString(new Date());
          isStale = snapshotDate !== todayDate;
        }

        // If snapshot is missing or stale across midnight, calculate fresh data from local SQLite
        if (!snapshot || isStale) {
          try {
            const { syncWidgetDataFromDbAsync } = require('@/services/widget-data');
            snapshot = await syncWidgetDataFromDbAsync();
            isStale = false;
          } catch {}
        }

        if (widgetInfo?.widgetName === UPCOMING_WIDGET_NAME) {
          renderWidget(<StockFlowUpcomingWidget data={snapshot} isStale={isStale} />);
        } else {
          renderWidget(<StockFlowTasksWidget data={snapshot} isStale={isStale} />);
        }
      } catch (error) {
        console.warn('[WidgetTaskHandler] Error rendering widget:', error);
        try {
          if (widgetInfo?.widgetName === UPCOMING_WIDGET_NAME) {
            renderWidget(<StockFlowUpcomingWidget data={null} isStale={false} />);
          } else {
            renderWidget(<StockFlowTasksWidget data={null} isStale={false} />);
          }
        } catch (fallbackError) {
          console.warn('[WidgetTaskHandler] Fallback rendering failed:', fallbackError);
        }
      }
      break;
    }
    case 'WIDGET_DELETED':
    case 'WIDGET_CLICK':
    default:
      break;
  }
}
