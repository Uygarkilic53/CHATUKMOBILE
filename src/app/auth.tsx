import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { signIn, signUp, useSession, authClient } from '../lib/auth-client';
import { appStorage } from '../lib/storage';
import { setActiveUserInfo } from '../lib/api';
import { socketService } from '../services/socket';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useToast } from '../components/Toast';
import * as Linking from 'expo-linking';
import Constants, { ExecutionEnvironment } from 'expo-constants';

// Design system colors (Stitch Chatuk palette)
const colors = {
  surface: '#0F172A',
  onSurface: '#F8FAFC',
  onSurfaceVariant: '#94A3B8',
  primary: '#6366F1',
  primaryContainer: '#6366F1',
  secondaryContainer: '#A855F7',
  tertiary: '#C084FC',
  surfaceContainerHighest: '#2D3449',
  surfaceContainerHigh: '#1E293B',
  surfaceContainerLow: '#131B2E',
  surfaceContainer: '#171F33',
  surfaceContainerLowest: '#060E20',
  surfaceVariant: 'rgba(255, 255, 255, 0.05)',
  outline: '#334155',
  outlineVariant: 'rgba(255, 255, 255, 0.1)',
  error: '#EF4444',
};

export default function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [isLogin, setIsLogin] = useState(() => (params.mode ? params.mode === 'login' : true));

  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const { showToast } = useToast();

  const { data: session } = useSession();

  useEffect(() => {
    const checkRememberedSession = async () => {
      try {
        const savedRemember = await appStorage.getItemAsync('chatuk_remember_me');
        if (savedRemember === 'true' && session) {
          router.replace('/chats');
        }
      } catch { }
    };
    checkRememberedSession();
  }, [session, router]);

  useEffect(() => {
    const loadRememberedData = async () => {
      try {
        const savedRemember = await appStorage.getItemAsync('chatuk_remember_me');
        const savedEmail = await appStorage.getItemAsync('chatuk_remembered_email');
        if (savedRemember === 'true' && savedEmail) {
          setEmail(savedEmail);
          setRememberMe(true);
        }
      } catch (e) {
        console.error('Failed to load remembered email:', e);
      }
    };
    loadRememberedData();
  }, []);

  const handleToggle = (mode: 'login' | 'register') => {
    if (isSubmittingRef.current || isSubmitting || isGoogleSubmitting) return;
    setIsLogin(mode === 'login');
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current || isSubmitting || isGoogleSubmitting) return;
    setErrorMsg('');
    const cleanEmail = email.trim().toLowerCase();

    // Validation
    if (!cleanEmail) {
      return setErrorMsg('Email is required');
    }
    if (!password) {
      return setErrorMsg('Password is required');
    }
    if (password.length < 8) {
      return setErrorMsg('Password must be at least 8 characters long');
    }
    if (!isLogin && !name.trim()) {
      return setErrorMsg('Full Name is required');
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const withTimeout = <T,>(promise: Promise<T>, timeoutMs = 15000): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out. Please verify the backend server is reachable.')), timeoutMs)
          ),
        ]);
      };

      if (isLogin) {
        const { data, error } = await withTimeout(
          signIn.email({
            email: cleanEmail,
            password,
            rememberMe,
          })
        );
        if (error) {
          const msg = error.message || "Failed to sign in. Please check your credentials.";
          setErrorMsg(msg);
          showToast(msg, { type: 'error' });
        } else {
          // Explicitly persist session token across Web and Native
          if (data) {
            const token = (data as any)?.token || (data as any)?.session?.token;
            if (token) {
              await appStorage.setItemAsync('chatuk_session_token', token);
            }
            if ((data as any)?.session || (data as any)?.user) {
              await appStorage.setItemAsync('chatuk_session_data', JSON.stringify(data));
            }
            if ((data as any)?.user?.id) {
              setActiveUserInfo((data as any).user.id, (data as any).user.email);
            }
          }

          // Persist or clear Remember Me
          if (rememberMe) {
            await appStorage.setItemAsync('chatuk_remember_me', 'true');
            await appStorage.setItemAsync('chatuk_remembered_email', cleanEmail);
          } else {
            await appStorage.setItemAsync('chatuk_remember_me', 'false');
            await appStorage.deleteItemAsync('chatuk_remembered_email');
          }
          socketService.disconnect();
          router.replace('/chats');
        }
      } else {
        const { data, error } = await withTimeout(
          signUp.email({
            email: cleanEmail,
            password,
            name: name.trim() || "User",
          })
        );
        if (error) {
          const msg = error.message || "Failed to sign up.";
          setErrorMsg(msg);
          showToast(msg, { type: 'error' });
        } else {
          if (data) {
            const token = (data as any)?.token || (data as any)?.session?.token;
            if (token) {
              await appStorage.setItemAsync('chatuk_session_token', token);
            }
            if ((data as any)?.session || (data as any)?.user) {
              await appStorage.setItemAsync('chatuk_session_data', JSON.stringify(data));
            }
            if ((data as any)?.user?.id) {
              setActiveUserInfo((data as any).user.id, (data as any).user.email);
            }
          }
          socketService.disconnect();
          router.replace('/chats');
        }
      }
    } catch (err: any) {
      const msg = err?.message || "Connection error. Please ensure the backend server is reachable.";
      setErrorMsg(msg);
      showToast(msg, { type: 'error' });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isSubmittingRef.current || isSubmitting || isGoogleSubmitting) return;
    setErrorMsg('');
    isSubmittingRef.current = true;
    setIsGoogleSubmitting(true);

    try {
      const isExpoGo =
        Constants.appOwnership === 'expo' ||
        (Constants as any).executionEnvironment === ExecutionEnvironment.StoreClient;

      const callbackURL = Platform.OS === 'web'
        ? (typeof window !== 'undefined' ? `${window.location.origin}/chats` : '/chats')
        : (isExpoGo ? Linking.createURL('chats') : 'chatuk://chats');

      const result = await signIn.social({
        provider: 'google',
        callbackURL,
      });

      if (result?.error) {
        const msg = result.error.message || 'Google sign in failed';
        setErrorMsg(msg);
        showToast(msg, { type: 'error' });
        return;
      }

      // Retrieve active session to populate local storage
      const sessionRes = await authClient.getSession();
      if (sessionRes?.error) {
        const msg = sessionRes.error.message || 'Failed to retrieve user session after Google sign in';
        setErrorMsg(msg);
        showToast(msg, { type: 'error' });
        return;
      }

      if (sessionRes?.data?.user) {
        const { user, session: activeSession } = sessionRes.data;
        if (activeSession?.token) {
          await appStorage.setItemAsync('chatuk_session_token', activeSession.token);
        }
        await appStorage.setItemAsync('chatuk_session_data', JSON.stringify(sessionRes.data));
        if (user?.id) {
          setActiveUserInfo(user.id, user.email);
        }
        await appStorage.setItemAsync('chatuk_remember_me', 'true');
        if (user?.email) {
          await appStorage.setItemAsync('chatuk_remembered_email', user.email);
        }
        socketService.disconnect();
        router.replace('/chats');
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to authenticate with Google. Please check your network connection.';
      setErrorMsg(msg);
      showToast(msg, { type: 'error' });
    } finally {
      isSubmittingRef.current = false;
      setIsGoogleSubmitting(false);
    }
  };


  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Background Blurs */}
          <View style={[styles.glowBlob, styles.glowBlob1]} />
          <View style={[styles.glowBlob, styles.glowBlob2]} />

          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => {
                if (isSubmittingRef.current || isSubmitting || isGoogleSubmitting) return;
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/');
                }
              }}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Feather name="arrow-left" size={20} color="#0F172A" />
            </Pressable>

            <View style={styles.logoContainer}>
              <Image
                source={require('../assets/images/chatuk_logo.png')}
                style={styles.logoIcon}
                contentFit="contain"
                accessibilityLabel="Chatuk Logo"
              />
              <Text style={styles.logoText}>Chatuk</Text>
            </View>
            <View style={styles.headerRight} />
          </View>

          <View style={styles.cardContainer}>

            {/* Segmented Control */}
            <View style={styles.segmentedControl}>
              <View style={[
                styles.segmentIndicator,
                { left: isLogin ? 4 : '50%', right: isLogin ? '50%' : 4 }
              ]}>
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.segmentGradient}
                />
              </View>
              <Pressable style={styles.segmentButton} onPress={() => handleToggle('login')}>
                <Text style={[styles.segmentText, isLogin ? styles.segmentTextActive : styles.segmentTextInactive]}>Log In</Text>
              </Pressable>
              <Pressable style={styles.segmentButton} onPress={() => handleToggle('register')}>
                <Text style={[styles.segmentText, !isLogin ? styles.segmentTextActive : styles.segmentTextInactive]}>Register</Text>
              </Pressable>
            </View>

            {/* Title */}
            <View style={styles.titleContainer}>
              <Text style={styles.title}>{isLogin ? 'Welcome Back' : 'Create Account'}</Text>
              <Text style={styles.subtitle}>
                {isLogin ? 'Enter your credentials to access your secure chats' : 'Join Chatuk for end-to-end encrypted messaging'}
              </Text>
            </View>

            {/* Form */}
            <View style={styles.formContainer}>
              {!isLogin && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Alex Morgan"
                    placeholderTextColor="#94A3B8"
                    value={name}
                    onChangeText={setName}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="alex@chatuk.io"
                  placeholderTextColor="#94A3B8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.passwordLabelRow}>
                  <Text style={styles.inputLabel}>Password</Text>
                  {!isLogin && <Text style={styles.passwordHint}>Min. 8 characters</Text>}
                </View>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    placeholder="••••••••••••"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <Pressable
                    style={styles.visibilityToggle}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Feather name={showPassword ? "eye" : "eye-off"} size={18} color={colors.outline} />
                  </Pressable>
                </View>
              </View>

              {errorMsg ? (
                <Text style={styles.errorText}>{errorMsg}</Text>
              ) : null}

              {isLogin && (
                <View style={styles.loginOptions}>
                  <Pressable
                    style={styles.rememberMe}
                    onPress={() => setRememberMe((prev) => !prev)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: rememberMe }}
                  >
                    <View style={[styles.radioButton, rememberMe && styles.radioButtonActive]}>
                      {rememberMe && <View style={styles.radioButtonInner} />}
                    </View>
                    <Text style={styles.rememberText}>Remember me</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push({ pathname: '/forgot-password', params: { email: email.trim() } })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                  >
                    <Text style={styles.forgotPassword}>Forgot Password?</Text>
                  </Pressable>
                </View>
              )}

              <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={isSubmitting || isGoogleSubmitting}>
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitGradient}
                >
                  {isSubmitting ? (
                    <LoadingIndicator
                      variant="bar"
                      width={110}
                      height={6}
                      gradientColors={['#ffffff', '#e0e7ff', '#ffffff']}
                      trackColor="rgba(255, 255, 255, 0.25)"
                    />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.submitText}>{isLogin ? 'Sign In' : 'Get Started'}</Text>
                      <Feather name="arrow-right" size={16} color="#ffffff" style={{ marginLeft: 6 }} />
                    </View>
                  )}
                </LinearGradient>
              </Pressable>
            </View>

            {/* Social Logins */}
            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.socialButtonsContainer}>
              <Pressable
                style={({ pressed }) => [
                  styles.googleButton,
                  pressed && styles.buttonPressed,
                  (isSubmitting || isGoogleSubmitting) && styles.buttonDisabled,
                ]}
                onPress={handleGoogleSignIn}
                disabled={isSubmitting || isGoogleSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
                accessibilityState={{
                  disabled: isSubmitting || isGoogleSubmitting,
                  busy: isGoogleSubmitting,
                }}
              >
                {isGoogleSubmitting ? (
                  <View style={styles.googleButtonContent}>
                    <LoadingIndicator
                      variant="bar"
                      width={80}
                      height={4}
                      gradientColors={['#4285F4', '#34A853', '#FBBC05']}
                      trackColor="#E2E8F0"
                    />
                    <Text style={styles.googleLoadingText}>Connecting to Google...</Text>
                  </View>
                ) : (
                  <View style={styles.googleButtonContent}>
                    <Ionicons name="logo-google" size={18} color="#4285F4" style={styles.googleIcon} />
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.footerPrompt}>
            <Text style={styles.footerPromptText}>
              {isLogin ? "Don't have an account? " : "Already have an account? "}
            </Text>
            <Pressable onPress={() => handleToggle(isLogin ? 'register' : 'login')}>
              <Text style={styles.footerPromptLink}>{isLogin ? 'Create an account' : 'Sign In'}</Text>
            </Pressable>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingTop: 16,
    paddingBottom: 40,
    minHeight: '100%',
  },
  glowBlob: {
    position: 'absolute',
    borderRadius: 200,
    opacity: 0.2,
    pointerEvents: 'none',
  },
  glowBlob1: {
    width: 384,
    height: 384,
    backgroundColor: '#38bdf8', // Sky 400
    top: -128,
    left: '50%',
    transform: [{ translateX: -192 }],
  },
  glowBlob2: {
    width: 340,
    height: 320,
    backgroundColor: '#818cf8', // Indigo 400
    bottom: -96,
    left: '50%',
    transform: [{ translateX: -170 }],
    opacity: 0.2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  backIcon: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: '600',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 8,
  },
  logoText: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    width: 40,
    height: 40,
  },
  cardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    zIndex: 10,
    marginTop: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 24,
    padding: 4,
    marginBottom: 24,
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  segmentIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: colors.primaryContainer,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentGradient: {
    flex: 1,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#ffffff',
  },
  segmentTextInactive: {
    color: '#64748B',
  },
  titleContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  formContainer: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
    paddingHorizontal: 4,
  },
  input: {
    height: 48,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 16,
    color: '#0F172A',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  passwordHint: {
    fontSize: 11,
    color: colors.tertiary,
    fontWeight: '600',
  },
  passwordInputContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  visibilityToggle: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  visibilityIcon: {
    fontSize: 16,
  },
  loginOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  rememberMe: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.outline,
    backgroundColor: '#ffffff',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonActive: {
    borderColor: colors.primaryContainer,
    backgroundColor: '#ffffff',
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primaryContainer,
  },
  rememberText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  forgotPassword: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '500',
  },
  submitButton: {
    height: 50,
    borderRadius: 25,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: colors.primaryContainer,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 11,
    color: colors.outline,
    letterSpacing: 1,
    fontWeight: '600',
  },
  socialButtonsContainer: {
    width: '100%',
  },
  googleButton: {
    width: '100%',
    height: 48,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    marginRight: 10,
  },
  googleButtonText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  googleLoadingText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 8,
  },
  buttonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  footerPrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerPromptText: {
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  footerPromptLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '700',
  }
});

