import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { expo } from "@better-auth/expo";
import mongoose from "mongoose";
import { getRedis, initRedis } from "./config/redis.js";
import { sendPasswordResetEmail } from "./services/email.service.js";

export let auth: any = null;

// Better Auth Secondary Storage implementation backed by Redis RAM
export const secondaryStorage = {
  get: async (key: string): Promise<string | null> => {
    const redis = getRedis();
    if (!redis) return null;
    try {
      return await redis.get(key);
    } catch {
      return null; // Transparent fallback to Mongo on Redis read error
    }
  },
  set: async (key: string, value: string, ttl?: number): Promise<void> => {
    const redis = getRedis();
    if (!redis) return;
    try {
      if (ttl && ttl > 0) {
        await redis.set(key, value, "EX", Math.ceil(ttl));
      } else {
        await redis.set(key, value);
      }
    } catch {
      // Silently ignore write failures; MongoDB remains source of truth
    }
  },
  delete: async (key: string): Promise<void> => {
    const redis = getRedis();
    if (!redis) return;
    try {
      await redis.del(key);
    } catch {
      // Silently ignore delete failures
    }
  },
  getAndDelete: async (key: string): Promise<string | null> => {
    const redis = getRedis();
    if (!redis) return null;
    try {
      if (typeof (redis as any).getdel === "function") {
        return await (redis as any).getdel(key);
      }
      const results = await redis.multi().get(key).del(key).exec();
      return (results?.[0]?.[1] as string) || null;
    } catch {
      return null;
    }
  },
  increment: async (key: string, ttl: number): Promise<number> => {
    const redis = getRedis();
    if (!redis) return 0;
    try {
      const val = await redis.incr(key);
      if (val === 1 && ttl > 0) {
        await redis.expire(key, Math.ceil(ttl));
      }
      return val;
    } catch {
      return 0;
    }
  },
};

// We'll export a function to initialize auth since it requires mongoose to be connected first
export const initAuth = () => {
  if (!mongoose.connection.db) {
    throw new Error("Mongoose is not connected!");
  }

  // Initialize Redis client for high-performance session & identity caching
  initRedis();

  const isProd = process.env.NODE_ENV === "production";

  // Parse comma-separated production origins from environment (e.g. TRUSTED_ORIGINS=https://chatuk.com,https://api.chatuk.com)
  const envTrustedOrigins = process.env.TRUSTED_ORIGINS
    ? process.env.TRUSTED_ORIGINS.split(",")
        .map((origin: string) => origin.trim())
        .filter(Boolean)
    : [];

  // Development origins: allows localhost, Expo Go, standalone custom schemes, and standard private LAN subnets
  const devOrigins = [
    // Expo Go custom schemes (match entire URL hierarchy: scheme prefix, recursive wildcard, subnet wildcards)
    "exp://",
    "exp://**",
    "exp://*",
    "exp://*/**",
    "exp://192.168.*.*:*",
    "exp://192.168.*.*:*/**",
    "exp://192.168.*.*:*/*",
    "exp://172.*.*.*:*",
    "exp://172.*.*.*:*/**",
    "exp://172.*.*.*:*/*",
    "exp://10.*.*.*:*",
    "exp://10.*.*.*:*/**",
    "exp://10.*.*.*:*/*",
    "exp://localhost:*",
    "exp://localhost:*/**",
    "exp://127.0.0.1:*",
    "exp://127.0.0.1:*/**",

    // Native standalone app custom scheme
    "chatuk://",
    "chatuk://**",
    "chatuk://*",
    "chatuk://*/**",

    // Local development HTTP web origins
    "http://localhost:*",
    "http://localhost:*/**",
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:19006",
    "http://127.0.0.1:*",
    "http://127.0.0.1:*/**",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:5000",
    "http://192.168.*.*:*",
    "http://192.168.*.*:*/**",
    "http://172.*.*.*:*",
    "http://172.*.*.*:*/**",
    "http://10.*.*.*:*",
    "http://10.*.*.*:*/**",
    // Expo tunnel / proxy domains
    "http://*.exp.direct:*",
    "http://*.exp.direct:*/**",
    "https://*.exp.direct:*",
    "https://*.exp.direct:*/**",
    "exp://*.exp.direct:*",
    "exp://*.exp.direct:*/**",
  ];

  const staticTrustedOrigins = isProd
    ? [
        "chatuk://",
        "chatuk://**",
        "chatuk://*",
        "chatuk://*/**",
        ...envTrustedOrigins,
      ]
    : [...devOrigins, ...envTrustedOrigins];

  const PRIVATE_IP_REGEX =
    /^(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

  const isSafeDevOrigin = (originStr: string): boolean => {
    try {
      const url = new URL(originStr);
      const host = url.hostname.toLowerCase();
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".exp.direct") ||
        PRIVATE_IP_REGEX.test(host)
      );
    } catch {
      return false;
    }
  };

  // In production, strictly use staticTrustedOrigins to prevent CSRF / origin reflection attacks.
  // In development, also accept dynamically detected LAN / dev origins (Origin or Referer headers).
  const trustedOrigins = isProd
    ? staticTrustedOrigins
    : async (request?: any) => {
        const list = [...staticTrustedOrigins];
        if (request && typeof request.headers?.get === "function") {
          const originHeader = request.headers.get("origin") || request.headers.get("referer");
          if (originHeader && isSafeDevOrigin(originHeader)) {
            try {
              const parsed = new URL(originHeader);
              if (!list.includes(parsed.origin)) {
                list.push(parsed.origin);
                list.push(`${parsed.origin}/**`);
              }
            } catch {
              if (!list.includes(originHeader)) {
                list.push(originHeader);
              }
            }
          }
        }
        return list;
      };

  auth = betterAuth({
    database: mongodbAdapter(mongoose.connection.db),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: 3600, // 1 hour
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }, request) => {
        try {
          let appBaseUrl = process.env.BETTER_AUTH_URL || "http://localhost:5000";
          if (request && typeof (request as any).headers?.get === "function") {
            const host = (request as any).headers.get("x-forwarded-host") || (request as any).headers.get("host");
            const proto =
              (request as any).headers.get("x-forwarded-proto") ||
              (host?.includes("localhost") || host?.includes("127.0.0.1") ? "http" : "https");
            if (host) {
              appBaseUrl = `${proto}://${host}`;
            }
          }
          const resetWebUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
          await sendPasswordResetEmail({
            to: user.email,
            userName: user.name,
            resetUrl: resetWebUrl,
            token,
          });
        } catch (emailErr) {
          console.error("Failed to send password reset email via Mailtrap:", emailErr);
        }
      },
    },
    rateLimit: {
      customRules: {
        "/api/auth/request-password-reset": {
          window: 60,
          max: 5,
        },
        "/api/auth/forget-password": {
          window: 60,
          max: 5,
        },
        "/api/auth/reset-password": {
          window: 60,
          max: 5,
        },
      },
    },
    session: {
      storeSessionInDatabase: true, // Enables transparent fallback to MongoDB when Redis misses or is unavailable
      expiresIn: 60 * 60 * 24 * 7, // 7 days
    },
    secondaryStorage, // High-performance Redis session & identity caching
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      },
    },
    plugins: [expo()],
    trustedOrigins,
    // For session security and Express
    advanced: {
      useSecureCookies: isProd,
      disableCSRFCheck: !isProd,
    },
  });

  return auth;
};
