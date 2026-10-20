"use no memo";

import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { StockFlowWidgetData } from '@/services/widget-data';

export interface StockFlowUpcomingWidgetProps {
  data?: StockFlowWidgetData | null;
  isStale?: boolean;
}

export function StockFlowUpcomingWidget({
  data,
  isStale = false,
}: StockFlowUpcomingWidgetProps) {
  const upcoming = data?.upcoming7Days ?? { total: 0, tasks: [] };
  const tasksToShow = (upcoming.tasks || []).slice(0, 4);
  const remainingCount = Math.max(0, (upcoming.tasks || []).length - 4);

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#0F172A',
        borderRadius: 16,
        padding: 12,
        borderColor: '#1E293B',
        borderWidth: 1,
        flexDirection: 'column',
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'mobile://tasks?view=upcoming' }}
    >
      {/* Header Row */}
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget
            text="📅 Upcoming 7 Days"
            style={{
              fontSize: 12,
              fontWeight: 'bold',
              color: '#38BDF8',
              marginRight: 6,
            }}
          />
          <FlexWidget
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#1E293B',
              borderRadius: 8,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: 'mobile://tasks?action=new' }}
          >
            <TextWidget
              text="+ Add"
              style={{
                fontSize: 9,
                fontWeight: 'bold',
                color: '#38BDF8',
              }}
            />
          </FlexWidget>
        </FlexWidget>

        {isStale ? (
          <TextWidget
            text="⚠️ Tap to sync"
            style={{
              fontSize: 10,
              fontWeight: 'bold',
              color: '#F59E0B',
            }}
          />
        ) : upcoming.total > 0 ? (
          <TextWidget
            text={`${upcoming.total} scheduled`}
            style={{
              fontSize: 10,
              fontWeight: 'bold',
              color: '#E2E8F0',
            }}
          />
        ) : (
          <TextWidget
            text="Next 7 Days"
            style={{
              fontSize: 10,
              color: '#94A3B8',
            }}
          />
        )}
      </FlexWidget>

      {/* Task Content / Empty State */}
      {upcoming.total === 0 ? (
        <FlexWidget
          style={{
            flex: 1,
            width: 'match_parent',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            paddingVertical: 8,
          }}
        >
          <TextWidget
            text={!data ? 'Open app to sync tasks' : 'No upcoming tasks next 7 days'}
            style={{
              fontSize: 11,
              fontWeight: 'bold',
              color: '#94A3B8',
              marginBottom: 2,
            }}
          />
          <TextWidget
            text={!data ? 'Tap to load schedule' : 'Clear schedule'}
            style={{
              fontSize: 10,
              color: '#64748B',
              marginBottom: 6,
            }}
          />
          <FlexWidget
            style={{
              backgroundColor: '#1E293B',
              borderRadius: 12,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: 'mobile://tasks?action=new' }}
          >
            <TextWidget
              text="+ Add Task"
              style={{
                fontSize: 10,
                fontWeight: 'bold',
                color: '#38BDF8',
              }}
            />
          </FlexWidget>
        </FlexWidget>
      ) : (
        <FlexWidget
          style={{
            flex: 1,
            width: 'match_parent',
            flexDirection: 'column',
            justifyContent: 'flex-start',
          }}
        >
          {tasksToShow.map((task, index) => {
            const priorityColor =
              task.priority === 'high'
                ? '#EF4444'
                : task.priority === 'low'
                  ? '#94A3B8'
                  : '#38BDF8';

            return (
              <FlexWidget
                key={task.id ?? index}
                style={{
                  width: 'match_parent',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 3,
                }}
              >
                <FlexWidget
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    flex: 1,
                    marginRight: 6,
                  }}
                >
                  <TextWidget
                    text="● "
                    style={{
                      fontSize: 8,
                      fontWeight: 'bold',
                      color: priorityColor,
                    }}
                  />
                  <TextWidget
                    text={task.title}
                    truncate="END"
                    maxLines={1}
                    style={{
                      fontSize: 10,
                      color: task.isCompleted ? '#64748B' : '#F1F5F9',
                    }}
                  />
                </FlexWidget>

                <TextWidget
                  text={`${task.dateFormatted || ''} ${task.timeFormatted}`}
                  style={{
                    fontSize: 9,
                    color: '#94A3B8',
                  }}
                />
              </FlexWidget>
            );
          })}

          {remainingCount > 0 && (
            <TextWidget
              text={`+ ${remainingCount} more upcoming task${remainingCount === 1 ? '' : 's'}`}
              style={{
                fontSize: 9,
                color: '#64748B',
                marginTop: 2,
              }}
            />
          )}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
