import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lokke.subcaster',
  appName: 'SubCaster',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Erlaube localhost für unified-server
    allowNavigation: [
      'localhost:*',
      '127.0.0.1:*'
    ],
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#1a1a1a",
      showSpinner: false
    },
    Keyboard: {
      resize: 'body',
      style: 'dark'
    }
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK'
    }
  }
};

export default config;
