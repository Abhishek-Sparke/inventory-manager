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

      // Ensure widget receivers have android:exported="true" for system launcher broadcasts
      if (Array.isArray(mainApplication.receiver)) {
        mainApplication.receiver.forEach((receiver) => {
          const name = receiver.$['android:name'] || '';
          if (name.includes('StockFlow') || name.includes('Widget')) {
            receiver.$['android:exported'] = 'true';
          }
        });
      }
    }
    return modConfig;
  });
};
