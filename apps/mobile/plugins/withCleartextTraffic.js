const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to ensure android:usesCleartextTraffic="true" is written
 * into AndroidManifest.xml for HTTP communication to local development servers.
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (modConfig) => {
    const androidManifest = modConfig.modResults.manifest;
    const mainApplication = androidManifest.application[0];
    if (mainApplication) {
      mainApplication.$['android:usesCleartextTraffic'] = 'true';

      // Ensure widget receivers have android:exported="true" and date/time actions for system launcher broadcasts
      if (Array.isArray(mainApplication.receiver)) {
        mainApplication.receiver.forEach((receiver) => {
          const name = receiver.$['android:name'] || '';
          if (name.includes('StockFlow') || name.includes('Widget')) {
            receiver.$['android:exported'] = 'true';

            // Ensure automatic refresh intent actions are registered
            receiver['intent-filter'] = receiver['intent-filter'] || [{}];
            const intentFilter = receiver['intent-filter'][0];
            intentFilter.action = intentFilter.action || [];
            const requiredActions = [
              'android.intent.action.BOOT_COMPLETED',
              'android.intent.action.MY_PACKAGE_REPLACED',
              'android.intent.action.TIME_SET',
              'android.intent.action.TIMEZONE_CHANGED',
              'android.intent.action.DATE_CHANGED',
              'com.sparke27.mobile.REFRESH_WIDGET',
            ];
            for (const reqAction of requiredActions) {
              const exists = intentFilter.action.some(
                (a) => a.$ && a.$['android:name'] === reqAction
              );
              if (!exists) {
                intentFilter.action.push({ $: { 'android:name': reqAction } });
              }
            }
          }
        });
      }
    }
    return modConfig;
  });
};
