
import { Platform } from "react-native";
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import Constants from "expo-constants";
import { appStorage } from "./storage";

const backendPort = process.env.EXPO_PUBLIC_BACKEND_PORT || "5000";

export const getBackendHost = () => {
  // 1. Web browser: always prioritize the active window hostname (e.g. localhost, 127.0.0.1, or LAN IP)
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }

  // 2. Dynamic Expo host from the active Metro dev server connection (works automatically for physical devices & Expo Go)
  const candidateUris: (string | undefined | null)[] = [
    (Constants as any).expoGoConfig?.debuggerHost,
    (Constants as any).manifest?.debuggerHost,
    (Constants.manifest2?.extra as any)?.expoGo?.debuggerHost,
    ((Constants as any).manifest?.extra as any)?.expoGo?.debuggerHost,
    Constants.expoConfig?.hostUri,
    (Constants as any).manifest?.hostUri,
    Constants.experienceUrl,
    Constants.linkingUri,
  ];

  for (const rawUri of candidateUris) {
    if (typeof rawUri === 'string' && rawUri.trim().length > 0) {
      const cleaned = rawUri.replace(/^[a-z]+:\/\//i, '');
      const host = cleaned.split(':')[0]?.split('/')[0]?.trim();
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return host;
      }
    }
  }

  // 3. Explicit host from environment variable (configured for standalone builds / production / LAN override)
  if (process.env.EXPO_PUBLIC_BACKEND_HOST && process.env.EXPO_PUBLIC_BACKEND_HOST.trim().length > 0) {
    return process.env.EXPO_PUBLIC_BACKEND_HOST.trim();
  }

  // 4. Default fallback for local testing / simulators
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
};

export const getOrigin = () => {
  // 1. Full backend URL override if specified in env (e.g. https://api.chatuk.com)
  if (process.env.EXPO_PUBLIC_BACKEND_URL) {
    return process.env.EXPO_PUBLIC_BACKEND_URL.replace(/\/+$/, '');
  }

  // 2. Web browser: if already running directly on the backend port (e.g. production reverse proxy), return window.location.origin.
  // In development, the web frontend runs on Metro (e.g. port 8081) while Express backend runs on backendPort (e.g. 5000).
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const port = window.location.port;
    if (port && port === backendPort) {
      return window.location.origin;
    }
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:${backendPort}`;
  }

  // 3. Fallback based on host and port (Mobile devices & simulators)
  const host = getBackendHost();
  return `http://${host}:${backendPort}`;
};

export const getBaseURL = () => {
  return `${getOrigin()}/api/auth`;
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  fetchOptions: {
    credentials: "include",
    headers: {
      ...(Platform.OS !== "web" ? { Origin: getOrigin() } : {}),
    },
    onSuccess: async (context: any) => {
      try {
        const data = context?.data;
        if (!data) return;
        const token = data.token || data.session?.token;
        if (token && typeof token === 'string') {
          await appStorage.setItemAsync('chatuk_session_token', token);
        }
        if (data.session || data.user) {
          await appStorage.setItemAsync('chatuk_session_data', JSON.stringify(data));
        }
        if (data.user?.id) {
          await appStorage.setItemAsync('chatuk_active_user_id', data.user.id);
          if (data.user.email) {
            await appStorage.setItemAsync('chatuk_active_user_email', data.user.email);
          }
        }
      } catch {}
    },
  },
  plugins: [
    expoClient({
      scheme: "chatuk",
      storagePrefix: "chatuk",
      storage: appStorage,
    }),
  ],
});

export const { signIn, signUp, useSession, signOut } = authClient;
