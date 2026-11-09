import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { requestPasswordReset } from '../lib/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useToast } from '../components/Toast';

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
  success: '#10B981',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { showToast } = useToast();

  const [email, setEmail] = useState(() => (params.email ? String(params.email).trim() : ''));
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [countdown, setCountdown] = useState(0);

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const startCountdown = () => {
    setCountdown(RESEND_COOLDOWN_SECONDS);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendResetEmail = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);

    try {
      await requestPasswordReset({ email: trimmedEmail });
      setIsSubmitted(true);
      startCountdown();
      showToast('Password reset link sent to your email.', 'success');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to send reset email. Please try again later.';
      setErrorMsg(message);
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || isSubmitting) return;
    await handleSendResetEmail();
  };

  const handleBackToLogin = () => {
    router.replace({ pathname: '/auth', params: { mode: 'login' } });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.glowBlob, styles.glowBlob1]} pointerEvents="none" />
      <View style={[styles.glowBlob, styles.glowBlob2]} pointerEvents="none" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header Bar */}
          <View style={styles.header}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  handleBackToLogin();
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="arrow-left" size={20} color={colors.onSurface} />
            </Pressable>

            <View style={styles.headerBrand}>
              <View style={styles.headerIcon}>
                <Ionicons name="chatbubble-ellipses" size={16} color="#ffffff" />
              </View>
              <Text style={styles.headerTitle}>Chatuk</Text>
            </View>

            <View style={{ width: 40 }} />
          </View>

          {!isSubmitted ? (
            /* Stage 1: Request Password Reset Form */
            <View style={styles.content}>
              <View style={styles.iconCircle}>
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  style={styles.iconGradient}
                >
                  <Feather name="key" size={32} color="#ffffff" />
                </LinearGradient>
              </View>

              <Text style={styles.title}>Forgot Password?</Text>
              <Text style={styles.subtitle}>
                No worries! Enter your registered account email and we will send you a reset link.
              </Text>

              {errorMsg ? (
                <View style={styles.errorContainer}>
                  <Feather name="alert-circle" size={16} color={colors.error} style={{ marginRight: 8 }} />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.inputContainer}>
                  <Feather name="mail" size={18} color={colors.onSurfaceVariant} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="name@example.com"
                    placeholderTextColor={colors.onSurfaceVariant}
                    value={email}
                    onChangeText={(val) => {
                      setEmail(val);
                      if (errorMsg) setErrorMsg('');
                    }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    editable={!isSubmitting}
                  />
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  (isSubmitting || !email.trim()) && styles.submitButtonDisabled,
                  pressed && { opacity: 0.9 },
                ]}
                onPress={handleSendResetEmail}
                disabled={isSubmitting || !email.trim()}
                accessibilityRole="button"
                accessibilityLabel="Send Reset Link"
              >
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
                    <View style={styles.submitContent}>
                      <Text style={styles.submitText}>Send Reset Link</Text>
                      <Feather name="arrow-right" size={16} color="#ffffff" style={{ marginLeft: 6 }} />
                    </View>
                  )}
                </LinearGradient>
              </Pressable>

              <Pressable
                style={styles.backToLoginPressable}
                onPress={handleBackToLogin}
                accessibilityRole="button"
                accessibilityLabel="Back to Sign In"
              >
                <Feather name="arrow-left" size={15} color={colors.tertiary} style={{ marginRight: 6 }} />
                <Text style={styles.backToLoginText}>Remember your password? <Text style={styles.linkAccent}>Sign In</Text></Text>
              </Pressable>
            </View>
          ) : (
            /* Stage 2: Wait for reset password link / Check email */
            <View style={styles.content}>
              <View style={styles.successIconCircle}>
                <View style={styles.successIconPulse}>
                  <Feather name="mail" size={38} color="#6366F1" />
                </View>
              </View>

              <Text style={styles.title}>Check Your Email</Text>
              <Text style={styles.subtitle}>
                We have sent a password reset link to:
              </Text>

              <View style={styles.emailChip}>
                <Feather name="mail" size={14} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.emailChipText} numberOfLines={1}>{email.trim()}</Text>
              </View>

              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <View style={styles.infoBullet} />
                  <Text style={styles.infoText}>Click the reset link in the email to set your new password.</Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoBullet} />
                  <Text style={styles.infoText}>The reset link will automatically expire in 1 hour.</Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={styles.infoBullet} />
                  <Text style={styles.infoText}>Check your Spam or Junk folder if you do not see it in a few moments.</Text>
                </View>
              </View>

              {/* Resend Cooldown Action */}
              <View style={styles.resendContainer}>
                <Text style={styles.resendQuestion}>Did not receive the email?</Text>
                <Pressable
                  onPress={handleResend}
                  disabled={countdown > 0 || isSubmitting}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Resend email"
                >
                  <Text
                    style={[
                      styles.resendButtonText,
                      (countdown > 0 || isSubmitting) && styles.resendButtonDisabled,
                    ]}
                  >
                    {countdown > 0 ? `Resend email in ${countdown}s` : 'Resend Email'}
                  </Text>
                </Pressable>
              </View>

              {/* Primary Action: Back to Login */}
              <Pressable
                style={({ pressed }) => [styles.submitButton, pressed && { opacity: 0.9 }]}
                onPress={handleBackToLogin}
                accessibilityRole="button"
                accessibilityLabel="Back to Sign In"
              >
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitGradient}
                >
                  <Text style={styles.submitText}>Return to Sign In</Text>
                </LinearGradient>
              </Pressable>

              {/* Try another email */}
              <Pressable
                style={styles.tryAnotherPressable}
                onPress={() => {
                  setIsSubmitted(false);
                  setErrorMsg('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Try another email address"
              >
                <Text style={styles.tryAnotherText}>Try a different email address</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  glowBlob: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.15,
  },
  glowBlob1: {
    backgroundColor: '#38bdf8',
    top: -120,
    left: -80,
  },
  glowBlob2: {
    backgroundColor: '#818cf8',
    bottom: 40,
    right: -100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 28,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outline,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingVertical: 12,
  },
  iconCircle: {
    marginBottom: 24,
  },
  iconGradient: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  successIconCircle: {
    marginBottom: 20,
  },
  successIconPulse: {
    width: 80,
    height: 80,
    borderRadius: 26,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(99, 102, 241, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 12,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 18,
    width: '100%',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  inputGroup: {
    width: '100%',
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    height: '100%',
  },
  submitButton: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  submitButtonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  backToLoginPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 8,
  },
  backToLoginText: {
    color: colors.onSurfaceVariant,
    fontSize: 14,
  },
  linkAccent: {
    color: colors.tertiary,
    fontWeight: '600',
  },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 24,
    maxWidth: '100%',
  },
  emailChipText: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '600',
  },
  infoCard: {
    width: '100%',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: 18,
    marginBottom: 24,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 6,
    marginRight: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  resendQuestion: {
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  resendButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.tertiary,
  },
  resendButtonDisabled: {
    color: colors.onSurfaceVariant,
    opacity: 0.6,
  },
  tryAnotherPressable: {
    marginTop: 16,
    paddingVertical: 8,
  },
  tryAnotherText: {
    fontSize: 13,
    color: colors.onSurfaceVariant,
    textDecorationLine: 'underline',
  },
});

