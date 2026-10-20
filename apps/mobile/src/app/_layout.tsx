import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { setupNotificationEnvironmentAsync } from '@/services/notifications';
import { subscribeToTaskChanges } from '@/services/task-sync';
import { refreshWidgetFromSnapshotAsync } from '@/services/widget-data';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    setupNotificationEnvironmentAsync();

    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      // 1. Refresh widget immediately on app launch
      refreshWidgetFromSnapshotAsync().catch(() => {});

      // 2. Refresh widget whenever app returns to foreground
      const appStateSub = AppState.addEventListener('change', (nextAppState) => {
        if (nextAppState === 'active') {
          refreshWidgetFromSnapshotAsync().catch(() => {});
        }
      });

      // 3. Automatically refresh widgets whenever tasks are created, updated, or deleted
      const taskChangeUnsub = subscribeToTaskChanges(() => {
        refreshWidgetFromSnapshotAsync().catch(() => {});
      });

      // 4. Periodic automatic refresh (every 5 seconds)
      const intervalId = setInterval(() => {
        refreshWidgetFromSnapshotAsync().catch(() => {});
      }, 5 * 1000);

      // 5. Schedule precise midnight rollover refresh
      const now = new Date();
      const tomorrowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
      const msUntilMidnight = Math.max(1000, tomorrowMidnight.getTime() - now.getTime());
      const midnightTimeoutId = setTimeout(() => {
        refreshWidgetFromSnapshotAsync().catch(() => {});
      }, msUntilMidnight);

      return () => {
        appStateSub.remove();
        taskChangeUnsub();
        clearInterval(intervalId);
        clearTimeout(midnightTimeoutId);
      };
    }
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
