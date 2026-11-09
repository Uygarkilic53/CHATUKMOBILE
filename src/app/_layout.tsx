import 'react-native-get-random-values';
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { ToastProvider } from '../components/Toast';
import { CallProvider } from '../context/CallContext';
import { WallpaperProvider } from '../context/WallpaperContext';
import { PreferencesProvider } from '../context/PreferencesContext';
import { IncomingCallBanner } from '../components/IncomingCallBanner';
import { soundService } from '../services/soundService';

WebBrowser.maybeCompleteAuthSession();

function RootNavigation() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.statusBarStyle} />
      <Stack 
        screenOptions={{ 
          headerShown: false,
          contentStyle: { backgroundColor: theme.surface }
        }} 
      >
        <Stack.Screen name="chats" options={{ animation: 'fade' }} />
        <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="conversation/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="conversation/settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen
          name="conversation/call"
          options={{
            animation: 'slide_from_bottom',
            presentation: 'modal',
          }}
        />
        <Stack.Screen name="wallpaper" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="storage" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="help" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="security" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="privacy" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  React.useEffect(() => {
    soundService.preloadAssets().catch(() => {});
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    'PlusJakartaSans-Regular': require('../../assets/fonts/PlusJakartaSans-Regular.ttf'),
    'PlusJakartaSans-Medium': require('../../assets/fonts/PlusJakartaSans-Medium.ttf'),
    'PlusJakartaSans-SemiBold': require('../../assets/fonts/PlusJakartaSans-SemiBold.ttf'),
    'PlusJakartaSans-Bold': require('../../assets/fonts/PlusJakartaSans-Bold.ttf'),
    'PlusJakartaSans-ExtraBold': require('../../assets/fonts/PlusJakartaSans-ExtraBold.ttf'),
    'PlusJakartaSans-Italic': require('../../assets/fonts/PlusJakartaSans-Italic.ttf'),
    'PlusJakartaSans-SemiBoldItalic': require('../../assets/fonts/PlusJakartaSans-SemiBoldItalic.ttf'),
    'PlusJakartaSans-BoldItalic': require('../../assets/fonts/PlusJakartaSans-BoldItalic.ttf'),
  });

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <WallpaperProvider>
          <PreferencesProvider>
            <ToastProvider>
              <CallProvider>
                <RootNavigation />
                <IncomingCallBanner />
              </CallProvider>
            </ToastProvider>
          </PreferencesProvider>
        </WallpaperProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
