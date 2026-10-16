"use no memo";

import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { StockFlowWidgetData } from '@/services/widget-data';

export interface StockFlowTasksWidgetProps {
  data?: StockFlowWidgetData | null;
  isStale?: boolean;
}

export function StockFlowTasksWidget({
  data,
  isStale = false,
}: StockFlowTasksWidgetProps) {
  const today = data?.today ?? { total: 0, completed: 0, percent: 0, tasks: [] };
  const percent = Math.min(100, Math.max(0, today.percent || 0));
  const tasksToShow = (today.tasks || []).slice(0, 3);
  const remainingCount = Math.max(0, (today.tasks || []).length - 3);

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
      clickActionData={{ uri: 'mobile://tasks?view=today' }}
    >
      {/* Header Row */}
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget
            text="⚡ StockFlow Tasks"
            style={{
              fontSize: 12,
              fontWeight: 'bold',
              color: '#38BDF8',
            }}
          />
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
        ) : today.total > 0 ? (
          <TextWidget
            text={`${today.completed}/${today.total} Done (${percent}%)`}
            style={{
              fontSize: 10,
              fontWeight: 'bold',
              color: '#E2E8F0',
            }}
          />
        ) : (
          <TextWidget
            text="Today"
            style={{
              fontSize: 10,
              color: '#94A3B8',
            }}
          />
        )}
      </FlexWidget>

      {/* Progress Bar (Visible when tasks exist) */}
      {today.total > 0 && (
        <FlexWidget
          style={{
            width: 'match_parent',
            height: 5,
            backgroundColor: '#334155',
            borderRadius: 3,
            flexDirection: 'row',
            marginBottom: 8,
          }}
        >
          <FlexWidget
            style={{
              flex: Math.max(1, percent),
              height: 5,
              backgroundColor: percent === 100 ? '#10B981' : '#38BDF8',
              borderRadius: 3,
            }}
          />
          {100 - percent > 0 && (
            <FlexWidget
              style={{
                flex: Math.max(1, 100 - percent),
                height: 5,
              }}
            />
          )}
        </FlexWidget>
      )}

      {/* Task Content / Empty State */}
      {today.total === 0 ? (
        <FlexWidget
          style={{
            flex: 1,
            width: 'match_parent',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            paddingVertical: 6,
          }}
        >
          <TextWidget
            text={!data ? 'Open app to sync tasks' : 'No tasks scheduled for today'}
            style={{
              fontSize: 11,
              fontWeight: 'bold',
              color: '#94A3B8',
              marginBottom: 2,
            }}
          />
          <TextWidget
            text={!data ? 'Tap to load your schedule' : 'All caught up • Tap to open app'}
            style={{
              fontSize: 10,
              color: '#64748B',
            }}
          />
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
          {tasksToShow.map((task, index) => (
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
                  text={task.isCompleted ? '✓ ' : '○ '}
                  style={{
                    fontSize: 10,
                    fontWeight: 'bold',
                    color: task.isCompleted ? '#10B981' : '#60A5FA',
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
                text={task.timeFormatted}
                style={{
                  fontSize: 9,
                  color: '#94A3B8',
                }}
              />
            </FlexWidget>
          ))}

          {remainingCount > 0 && (
            <TextWidget
              text={`+ ${remainingCount} more task${remainingCount === 1 ? '' : 's'} today`}
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
