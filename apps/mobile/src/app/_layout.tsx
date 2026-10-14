import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { setupNotificationEnvironmentAsync } from '@/services/notifications';
import { refreshWidgetFromSnapshotAsync } from '@/services/widget-data';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    setupNotificationEnvironmentAsync();

    if (Platform.OS === 'android') {
      // Refresh widget immediately on app launch using local cache
      refreshWidgetFromSnapshotAsync().catch(() => {});

      // Refresh widget whenever app returns to foreground
      const subscription = AppState.addEventListener('change', (nextAppState) => {
        if (nextAppState === 'active') {
          refreshWidgetFromSnapshotAsync().catch(() => {});
        }
      });

      return () => {
        subscription.remove();
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
