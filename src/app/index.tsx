import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSession } from '../lib/auth-client';
import { appStorage } from '../lib/storage';
import { getSessionAuth, isLoggingOutState } from '../lib/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { getSafeImageSource } from '../utils/image';

// Design system colors (Stitch Chatuk palette)
const colors = {
  surface: '#0F172A',
  onSurface: '#F8FAFC',
  onSurfaceVariant: '#94A3B8',
  primary: '#6366F1',
  primaryContainer: '#6366F1',
  secondaryContainer: '#A855F7',
  tertiary: '#C084FC',
  surfaceContainerHigh: '#1E293B',
  surfaceContainerHighest: '#2D3449',
  surfaceContainerLow: '#131B2E',
  surfaceContainer: '#171F33',
  outline: '#334155',
  outlineVariant: 'rgba(255, 255, 255, 0.1)',
};

export default function WelcomeScreen() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [isCheckingAutoLogin, setIsCheckingAutoLogin] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const checkAutoLogin = async () => {
      if (hasRedirectedRef.current) return;

      try {
        const isLoggingOut = isLoggingOutState();
        if (!isMounted || hasRedirectedRef.current) return;

        const rememberMe = await appStorage.getItemAsync('chatuk_remember_me');
        if (!isMounted || hasRedirectedRef.current) return;

        // If user explicitly signed out or logout is in progress, show welcome screen immediately
        if (isLoggingOut || rememberMe === 'false') {
          setIsCheckingAutoLogin(false);
          setIsReady(true);
          return;
        }

        const { token, cookie } = await getSessionAuth();
        if (!isMounted || hasRedirectedRef.current) return;

        // If session or active credentials already exist, auto-navigate to chats immediately
        if (token || cookie || session) {
          hasRedirectedRef.current = true;
          router.replace('/chats');
          return;
        }

        // If user has no credentials and is not remembered, show welcome screen immediately
        if (rememberMe !== 'true') {
          setIsCheckingAutoLogin(false);
          setIsReady(true);
          return;
        }

        // If rememberMe is 'true' but session is still resolving, show loading indicator with timeout fallback
        if (isPending) {
          setIsCheckingAutoLogin(true);
          fallbackTimer = setTimeout(() => {
            if (isMounted && !hasRedirectedRef.current) {
              setIsCheckingAutoLogin(false);
              setIsReady(true);
            }
          }, 2500);
          return;
        }

        // Session check finished and no session found
        setIsCheckingAutoLogin(false);
        setIsReady(true);
      } catch (err) {
        console.error('Session check error:', err);
        if (isMounted && !hasRedirectedRef.current) {
          setIsCheckingAutoLogin(false);
          setIsReady(true);
        }
      }
    };

    checkAutoLogin();

    return () => {
      isMounted = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
    };
  }, [session, isPending, router]);

  // Only display loading spinner if actively verifying a remembered user
  if (!isReady && isCheckingAutoLogin) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Image
          source={getSafeImageSource("https://lh3.googleusercontent.com/aida-public/AB6AXuAjwuGI9RYj8AYT3g4cRz7b5e1tlkZso5E7Sc31pBzLx3nyQ6k4MSvx0ScW86ozfmTSVMTuqAXx_xEWgDkdNEW7bNnNP78j-L4ih9XLY4y0iRaUI7Uq2NbHkRTtHoYFznbQcLNrEq3HsdaWk-tAvRLr1qjwwPI4Q4oVMhukjIGyskxzTODuLcUykpe_b-P9Gey50zT4zDfCC9T-Jd3ByD6RduNt3HVWumH0Kx0-P84deTnlzqz-r0ipaA")}
          style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 18 }}
          contentFit="cover"
        />
        <LoadingIndicator variant="bar" width={200} height={8} label="Giriş doğrulanıyor..." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Background Blurs / Glows */}
      <View style={[styles.glowBlob, styles.glowBlob1]} />
      <View style={[styles.glowBlob, styles.glowBlob2]} />
      <View style={[styles.glowBlob, styles.glowBlob3]} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Image
              source={require('../assets/images/chatuk_logo.png')}
              style={styles.logoIcon}
              contentFit="cover"
            />
            <Text style={styles.logoText}>Chatuk</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Network Fast</Text>
          </View>
        </View>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.secureBadge}>
            <Feather name="shield" size={13} color="#0284c7" style={{ marginRight: 6 }} />
            <Text style={styles.secureText}>END-TO-END QUANTUM ENCRYPTED</Text>
          </View>

          <Text style={styles.title}>Connect deeper, seamlessly.</Text>
          <Text style={styles.subtitle}>
            Next-generation secure communication with ultra-clear calls, rich media sharing, and instant messaging built for speed.
          </Text>
        </View>

        {/* Showcase Card */}
        <View style={styles.showcaseWrapper}>
          <View style={styles.showcaseCard}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <View style={styles.avatarContainer}>
                  <Image
                    source={getSafeImageSource("https://lh3.googleusercontent.com/aida-public/AB6AXuBo-aDYrgMg6uYjO1EwhWFcChgLSJ7ay_OfjzMqoo2NPQjE8wo2ACVsma3HvBXsVzXZeYPqNRhljOfgsb7byB4JQqkJ_DH0U3OWzzYiLbYEHEzzIp9kVsDE8hlq2p7iHlTMCHLpC8giBXZ_zRrFeE8gLBvZ4x0ReybV4RKMv_gGrmowd_EB_9SZzkCc97XjYySiTQDkR48NAVWApfLh-a-bu8YgSKmP0-jgda0yGC6kA46K_spSYaxWfw")}
                    style={styles.avatar}
                    contentFit="cover"
                  />
                  <View style={styles.onlineIndicator} />
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardName}>Elysia Vance</Text>
                  <Text style={styles.typingText}>typing audio note...</Text>
                </View>
              </View>
              <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
            </View>

            <View style={styles.chatBubbles}>
              <View style={styles.receivedBubble}>
                <Text style={styles.receivedBubbleText}>
                  The sync protocol is active. Sending over the 4K render sequence now{' '}
                  <Ionicons name="flash" size={13} color={colors.tertiary} />
                </Text>
                <Text style={styles.bubbleTime}>10:42 PM</Text>
              </View>

              <LinearGradient
                colors={[colors.primaryContainer, colors.secondaryContainer]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sentBubble}
              >
                <View style={styles.audioBubbleContent}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', marginRight: 6 }}>
                    <Ionicons name="play" size={12} color="#ffffff" />
                  </View>
                  <View style={styles.audioWaveform}>
                    <View style={styles.audioProgress} />
                  </View>
                  <Text style={styles.audioTime}>0:24 / 0:38</Text>
                  <Ionicons name="checkmark-done" size={15} color="#ffffff" style={{ marginLeft: 4 }} />
                </View>
              </LinearGradient>
            </View>

            <View style={styles.cardFooter}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Feather name="key" size={12} color={colors.onSurfaceVariant} style={{ marginRight: 6 }} />
                <Text style={styles.footerLabel}>Zero-Knowledge Session</Text>
              </View>
              <Text style={styles.footerSignal}>Signal 60fps</Text>
            </View>
          </View>
          <View style={styles.cardShadowBase} />
        </View>

        {/* Specs Section */}
        <View style={styles.specsContainer}>
          <View style={styles.specItem}>
            <Text style={styles.specValue}>0.1ms</Text>
            <Text style={styles.specLabel}>Latency</Text>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specItem}>
            <Text style={styles.specValue}>256-bit</Text>
            <Text style={styles.specLabel}>Hardware AES</Text>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specItem}>
            <Text style={styles.specValue}>100%</Text>
            <Text style={styles.specLabel}>P2P Private</Text>
          </View>
        </View>

      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.actionContainer}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
          onPress={() => router.push({ pathname: '/auth', params: { mode: 'register' } })}
        >
          <LinearGradient
            colors={[colors.primaryContainer, colors.secondaryContainer]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.buttonGradient}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.primaryButtonText}>Sign Up</Text>
              <Feather name="arrow-right" size={16} color="#ffffff" style={{ marginLeft: 6 }} />
            </View>
          </LinearGradient>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && { backgroundColor: colors.outlineVariant }]}
          onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } })}
        >
          <Text style={styles.secondaryButtonText}>Log In</Text>
        </Pressable>

        <Text style={styles.termsText}>
          By continuing, you agree to Chatuk&apos;s <Text style={styles.linkText}>Terms</Text> & <Text style={styles.linkText}>Privacy Policy</Text>.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  glowBlob: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    opacity: 0.2,
  },
  glowBlob1: {
    backgroundColor: '#38bdf8', // Sky 400
    top: -100,
    left: -50,
  },
  glowBlob2: {
    backgroundColor: '#818cf8', // Indigo 400
    top: '30%',
    right: -100,
  },
  glowBlob3: {
    backgroundColor: '#c084fc', // Purple 400
    bottom: -50,
    left: -100,
    opacity: 0.15,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
    zIndex: 10,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  logoIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  logoText: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  statusText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
  },
  heroSection: {
    alignItems: 'center',
    marginTop: 16,
    zIndex: 10,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  secureIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  secureText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: colors.onSurface,
    fontSize: 36,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 44,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.onSurfaceVariant,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  showcaseWrapper: {
    alignItems: 'center',
    marginBottom: 24,
    zIndex: 10,
  },
  showcaseCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  cardHeaderText: {
    justifyContent: 'center',
  },
  cardName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  typingText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '500',
  },
  verifiedIcon: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  chatBubbles: {
    marginBottom: 16,
  },
  receivedBubble: {
    backgroundColor: '#f1f5f9',
    padding: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    maxWidth: '85%',
    alignSelf: 'flex-start',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  receivedBubbleText: {
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 18,
  },
  bubbleTime: {
    color: colors.outline,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  sentBubble: {
    padding: 12,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    maxWidth: '85%',
    alignSelf: 'flex-end',
    shadowColor: colors.primaryContainer,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  audioBubbleContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playIcon: {
    color: '#ffffff',
    fontSize: 16,
    marginRight: 8,
  },
  audioWaveform: {
    width: 100,
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 3,
    marginRight: 8,
    overflow: 'hidden',
  },
  audioProgress: {
    width: '66%',
    height: '100%',
    backgroundColor: '#ffffff',
  },
  audioTime: {
    color: '#ffffff',
    fontSize: 11,
    marginRight: 8,
    fontWeight: '500',
  },
  readIcon: {
    color: '#ffffff',
    fontSize: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  footerLabel: {
    color: colors.tertiary,
    fontSize: 11,
    fontWeight: '600',
  },
  footerSignal: {
    color: colors.outline,
    fontSize: 11,
    fontWeight: '500',
  },
  cardShadowBase: {
    width: '90%',
    height: 12,
    backgroundColor: '#e2e8f0',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    marginTop: -4,
  },
  specsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginVertical: 24,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    zIndex: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  specItem: {
    alignItems: 'center',
  },
  specValue: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  specLabel: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '500',
  },
  specDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.outlineVariant,
  },
  actionContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    zIndex: 10,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: colors.primaryContainer,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  termsText: {
    textAlign: 'center',
    color: colors.onSurfaceVariant,
    fontSize: 11,
  },
  linkText: {
    color: colors.primary,
    fontWeight: '600',
  },
});

