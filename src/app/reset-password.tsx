import React, { useState } from 'react';
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
import { resetPasswordWithToken } from '../lib/api';
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

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = params.token ? String(params.token).trim() : '';
  const { showToast } = useToast();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const calculateStrength = (pass: string) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass) || pass.length >= 12) score++;
    return score;
  };

  const strength = calculateStrength(password);

  const getStrengthLabel = () => {
    switch (strength) {
      case 1:
        return { label: 'Weak', color: '#EF4444' };
      case 2:
        return { label: 'Fair', color: '#F59E0B' };
      case 3:
        return { label: 'Good', color: '#3B82F6' };
      case 4:
        return { label: 'Strong', color: '#10B981' };
      default:
        return { label: 'At least 8 characters', color: colors.onSurfaceVariant };
    }
  };

  const handleResetPassword = async () => {
    if (!token) {
      setErrorMsg('Missing password reset token. Please request a new reset email.');
      return;
    }

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please re-enter.');
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);

    try {
      await resetPasswordWithToken({
        token,
        newPassword: password,
      });

      setIsSuccess(true);
      showToast('Password reset successfully! Please sign in with your new password.', 'success');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to reset password. The link may have expired or is invalid.';
      setErrorMsg(message);
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
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

          {!token ? (
            /* Missing Token Error View */
            <View style={styles.content}>
              <View style={styles.missingTokenBadge}>
                <Feather name="alert-triangle" size={36} color="#F59E0B" />
              </View>
              <Text style={styles.title}>Invalid Reset Link</Text>
              <Text style={styles.subtitle}>
                This password reset link is missing its security token or has expired. Please request a new password reset link.
              </Text>

              <Pressable
                style={styles.submitButton}
                onPress={() => router.replace('/forgot-password')}
                accessibilityRole="button"
                accessibilityLabel="Request New Reset Link"
              >
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitGradient}
                >
                  <Text style={styles.submitText}>Request New Reset Link</Text>
                </LinearGradient>
              </Pressable>

              <Pressable style={styles.secondaryActionPressable} onPress={handleBackToLogin}>
                <Text style={styles.secondaryActionText}>Return to Sign In</Text>
              </Pressable>
            </View>
          ) : isSuccess ? (
            /* Success State */
            <View style={styles.content}>
              <View style={styles.successIconCircle}>
                <View style={styles.successIconPulse}>
                  <Feather name="check" size={38} color="#10B981" />
                </View>
              </View>

              <Text style={styles.title}>Password Changed!</Text>
              <Text style={styles.subtitle}>
                Your password has been successfully reset. You can now sign in using your new credentials.
              </Text>

              <Pressable
                style={styles.submitButton}
                onPress={handleBackToLogin}
                accessibilityRole="button"
                accessibilityLabel="Sign In Now"
              >
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitGradient}
                >
                  <Text style={styles.submitText}>Sign In Now</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            /* Form View */
            <View style={styles.content}>
              <View style={styles.iconCircle}>
                <LinearGradient
                  colors={[colors.primaryContainer, colors.secondaryContainer]}
                  style={styles.iconGradient}
                >
                  <Feather name="lock" size={32} color="#ffffff" />
                </LinearGradient>
              </View>

              <Text style={styles.title}>Create New Password</Text>
              <Text style={styles.subtitle}>
                Your new password must be at least 8 characters long.
              </Text>

              {errorMsg ? (
                <View style={styles.errorContainer}>
                  <Feather name="alert-circle" size={16} color={colors.error} style={{ marginRight: 8 }} />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              {/* New Password Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password</Text>
                <View style={styles.inputContainer}>
                  <Feather name="lock" size={18} color={colors.onSurfaceVariant} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter new password"
                    placeholderTextColor={colors.onSurfaceVariant}
                    value={password}
                    onChangeText={(val) => {
                      setPassword(val);
                      if (errorMsg) setErrorMsg('');
                    }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                  />
                  <Pressable
                    onPress={() => setShowPassword((prev) => !prev)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.eyeButton}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={18}
                      color={colors.onSurfaceVariant}
                    />
                  </Pressable>
                </View>

                {/* Strength Bars */}
                {password.length > 0 && (
                  <View style={styles.strengthContainer}>
                    <View style={styles.strengthBars}>
                      {[1, 2, 3, 4].map((level) => (
                        <View
                          key={level}
                          style={[
                            styles.strengthBar,
                            strength >= level && { backgroundColor: getStrengthLabel().color },
                          ]}
                        />
                      ))}
                    </View>
                    <Text style={[styles.strengthLabel, { color: getStrengthLabel().color }]}>
                      {getStrengthLabel().label}
                    </Text>
                  </View>
                )}
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm New Password</Text>
                <View style={styles.inputContainer}>
                  <Feather name="check-circle" size={18} color={colors.onSurfaceVariant} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.onSurfaceVariant}
                    value={confirmPassword}
                    onChangeText={(val) => {
                      setConfirmPassword(val);
                      if (errorMsg) setErrorMsg('');
                    }}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                  />
                  <Pressable
                    onPress={() => setShowConfirmPassword((prev) => !prev)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.eyeButton}
                  >
                    <Feather
                      name={showConfirmPassword ? 'eye-off' : 'eye'}
                      size={18}
                      color={colors.onSurfaceVariant}
                    />
                  </Pressable>
                </View>

                {confirmPassword.length > 0 && (
                  <Text
                    style={[
                      styles.matchText,
                      password === confirmPassword ? { color: colors.success } : { color: colors.error },
                    ]}
                  >
                    {password === confirmPassword ? '\u2713 Passwords match' : '\u2717 Passwords do not match'}
                  </Text>
                )}
              </View>

              {/* Submit Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  (isSubmitting || password.length < 8 || password !== confirmPassword) &&
                    styles.submitButtonDisabled,
                  pressed && { opacity: 0.9 },
                ]}
                onPress={handleResetPassword}
                disabled={isSubmitting || password.length < 8 || password !== confirmPassword}
                accessibilityRole="button"
                accessibilityLabel="Reset Password"
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
                    <Text style={styles.submitText}>Reset Password</Text>
                  )}
                </LinearGradient>
              </Pressable>

              <Pressable style={styles.secondaryActionPressable} onPress={handleBackToLogin}>
                <Text style={styles.secondaryActionText}>Cancel &amp; Return to Sign In</Text>
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
  missingTokenBadge: {
    width: 76,
    height: 76,
    borderRadius: 26,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successIconCircle: {
    marginBottom: 20,
  },
  successIconPulse: {
    width: 80,
    height: 80,
    borderRadius: 26,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.4)',
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
  eyeButton: {
    padding: 6,
  },
  strengthContainer: {
    marginTop: 8,
  },
  strengthBars: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outline,
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  matchText: {
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
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
  submitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryActionPressable: {
    marginTop: 20,
    paddingVertical: 8,
  },
  secondaryActionText: {
    color: colors.onSurfaceVariant,
    fontSize: 14,
  },
});

