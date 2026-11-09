import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import { useSession, authClient } from '../lib/auth-client';
import { api, clearSessionAuth, setIsLoggingOut } from '../lib/api';
import { getStoredDeviceKeys, wipeAllSecureKeys } from '../e2ee/keyStore';
import { wipeLocalDb } from '../e2ee/localDb';
import { socketService } from '../services/socket';
import { getSafeImageSource } from '../utils/image';

interface PasswordStrength {
  score: number; // 0 to 3
  label: string;
  color: string;
}

export default function SecurityScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { data: session } = useSession();

  // Profile data
  const [userProfile, setUserProfile] = useState<{
    id?: string;
    name?: string;
    email?: string;
    image?: string | null;
    createdAt?: string;
  } | null>(null);

  // Form states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingOutEverywhere, setIsLoggingOutEverywhere] = useState(false);

  // Diagnostics states
  const [deviceId, setDeviceId] = useState<string>('Loading...');
  const [hasE2EEKeys, setHasE2EEKeys] = useState<boolean>(false);

  // Fetch profile details & device keys
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const token = (session as any)?.session?.token || (session as any)?.token;
        const res = await api.getProfile(token).catch(() => null);
        if (res?.user && isMounted) {
          setUserProfile(res.user);
        }

        const keys = await getStoredDeviceKeys().catch(() => null);
        if (isMounted) {
          if (keys?.deviceId) {
            setDeviceId(keys.deviceId);
            setHasE2EEKeys(true);
          } else {
            setDeviceId('Not initialized');
            setHasE2EEKeys(false);
          }
        }
      } catch (err) {
        console.warn('[SecurityScreen] Failed to load security diagnostics:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [session]);

  // Determine auth provider (OAuth vs Email/Password)
  const isGoogleUser = useMemo(() => {
    const user = session?.user as any;
    if (!user) return false;
    // Better Auth accounts check or presence of google indicators
    if (user.provider === 'google' || user.authMethod === 'google') return true;
    return false;
  }, [session]);

  // Password strength calculation
  const passwordStrength: PasswordStrength = useMemo(() => {
    if (!newPassword) {
      return { score: 0, label: '', color: theme.outline };
    }
    if (newPassword.length < 8) {
      return { score: 1, label: 'Too short (min 8 characters)', color: '#EF4444' };
    }

    const hasLetters = /[a-zA-Z]/.test(newPassword);
    const hasNumbers = /[0-9]/.test(newPassword);
    const hasSpecial = /[^a-zA-Z0-9]/.test(newPassword);

    if (hasLetters && hasNumbers && hasSpecial && newPassword.length >= 10) {
      return { score: 3, label: 'Strong password', color: '#10B981' };
    }
    if ((hasLetters && hasNumbers) || hasSpecial) {
      return { score: 2, label: 'Medium strength', color: '#F59E0B' };
    }
    return { score: 1, label: 'Weak (add numbers & symbols)', color: '#EF4444' };
  }, [newPassword, theme.outline]);

  // Password matching check
  const passwordsMatch = useMemo(() => {
    if (!confirmPassword) return null;
    return newPassword === confirmPassword;
  }, [newPassword, confirmPassword]);

  // Form submission handler
  const handleChangePassword = async () => {
    if (!currentPassword) {
      showToast('Please enter your current password', { type: 'error' });
      return;
    }
    if (newPassword.length < 8) {
      showToast('New password must be at least 8 characters long', { type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', { type: 'error' });
      return;
    }
    if (currentPassword === newPassword) {
      showToast('New password cannot be the same as current password', { type: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await (authClient as any).changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (res?.error) {
        showToast(res.error.message || 'Failed to change password', { type: 'error' });
      } else {
        showToast('Password changed successfully!', { type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      console.error('[SecurityScreen] Change password error:', err);
      showToast(err?.message || 'Failed to update password', { type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revoke all sessions / Log out everywhere
  const handleLogoutEverywhere = () => {
    Alert.alert(
      'Log Out From All Devices?',
      'This will immediately revoke all active sessions across all your phones, tablets, and browsers. You will need to log back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out Everywhere',
          style: 'destructive',
          onPress: executeLogoutEverywhere,
        },
      ]
    );
  };

  const executeLogoutEverywhere = async () => {
    setIsLoggingOutEverywhere(true);
    try {
      setIsLoggingOut(true);
      socketService.disconnect();
      try {
        if (typeof (authClient as any).revokeSessions === 'function') {
          await (authClient as any).revokeSessions();
        } else if (typeof (authClient as any).revokeOtherSessions === 'function') {
          await (authClient as any).revokeOtherSessions();
        }
      } catch (revokeErr) {
        console.warn('Revoke sessions call warning:', revokeErr);
      }
      await clearSessionAuth().catch(() => {});
      await wipeAllSecureKeys().catch(() => {});
      await wipeLocalDb().catch(() => {});
      showToast('Logged out of all devices successfully', { type: 'success' });
      router.replace('/chats');
    } catch (err: any) {
      console.error('[SecurityScreen] Error revoking all sessions:', err);
      showToast('Error revoking sessions', { type: 'error' });
    } finally {
      setIsLoggingOutEverywhere(false);
    }
  };

  const formattedJoinDate = useMemo(() => {
    const raw = userProfile?.createdAt;
    if (!raw) return 'Active Member';
    try {
      const date = new Date(raw);
      return `Member since ${date.toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })}`;
    } catch {
      return 'Active Member';
    }
  }, [userProfile?.createdAt]);

  const avatarUri = userProfile?.image || session?.user?.image || null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]} edges={['top', 'left', 'right']}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.cardBorder }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
            pressed && styles.buttonPressed,
          ]}
          hitSlop={8}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={theme.onSurface} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Account & Security</Text>
          <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
            Change password, credentials & diagnostics
          </Text>
        </View>
        <View style={styles.headerRightSpacer} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Account Overview Card ─── */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.accountRow}>
              <Image
                source={getSafeImageSource(avatarUri)}
                style={[styles.avatar, { borderColor: theme.primary, backgroundColor: theme.cardItem }]}
                contentFit="cover"
              />
              <View style={styles.accountInfo}>
                <View style={styles.nameRow}>
                  <Text style={[styles.userName, { color: theme.onSurface }]} numberOfLines={1}>
                    {userProfile?.name || session?.user?.name || 'User'}
                  </Text>
                  <Ionicons name="checkmark-circle" size={17} color={theme.primary} />
                </View>
                <Text style={[styles.userEmail, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                  {userProfile?.email || session?.user?.email || ''}
                </Text>
                <Text style={[styles.joinDate, { color: theme.outline }]}>
                  {formattedJoinDate}
                </Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.divider }]} />

            {/* Auth Provider Badge */}
            <View style={styles.providerRow}>
              <View style={styles.providerLeft}>
                <Feather
                  name={isGoogleUser ? 'globe' : 'mail'}
                  size={16}
                  color={theme.primary}
                />
                <Text style={[styles.providerLabel, { color: theme.onSurface }]}>Sign-in Method</Text>
              </View>
              <View
                style={[
                  styles.providerBadge,
                  { backgroundColor: theme.isDark ? 'rgba(14, 165, 233, 0.15)' : 'rgba(79, 70, 229, 0.1)' },
                ]}
              >
                <Text style={[styles.providerBadgeText, { color: theme.primary }]}>
                  {isGoogleUser ? 'Google OAuth' : 'Email & Password'}
                </Text>
              </View>
            </View>
          </View>

          {/* ─── Change Password Section ─── */}
          {isGoogleUser ? (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.oauthNoticeRow}>
                <Ionicons name="information-circle" size={24} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>Google Account Security</Text>
                  <Text style={[styles.oauthNoticeText, { color: theme.onSurfaceVariant }]}>
                    Your account is securely managed by Google Sign-In. To update your password or 2-factor authentication, visit your Google Account security settings.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Feather name="key" size={18} color={theme.primary} />
                  <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>Change Password</Text>
                </View>
              </View>
              <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>
                Ensure your account is using a long, random password to stay secure.
              </Text>

              {/* Current Password Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.onSurface }]}>Current Password</Text>
                <View
                  style={[
                    styles.inputContainer,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  ]}
                >
                  <TextInput
                    style={[styles.textInput, { color: theme.onSurface }]}
                    placeholder="Enter current password"
                    placeholderTextColor={theme.outline}
                    secureTextEntry={!showCurrentPassword}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    onPress={() => setShowCurrentPassword((prev) => !prev)}
                    hitSlop={8}
                    style={styles.eyeButton}
                  >
                    <Feather
                      name={showCurrentPassword ? 'eye-off' : 'eye'}
                      size={18}
                      color={theme.outline}
                    />
                  </Pressable>
                </View>
              </View>

              {/* New Password Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.onSurface }]}>New Password</Text>
                <View
                  style={[
                    styles.inputContainer,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  ]}
                >
                  <TextInput
                    style={[styles.textInput, { color: theme.onSurface }]}
                    placeholder="At least 8 characters"
                    placeholderTextColor={theme.outline}
                    secureTextEntry={!showNewPassword}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    onPress={() => setShowNewPassword((prev) => !prev)}
                    hitSlop={8}
                    style={styles.eyeButton}
                  >
                    <Feather
                      name={showNewPassword ? 'eye-off' : 'eye'}
                      size={18}
                      color={theme.outline}
                    />
                  </Pressable>
                </View>

                {/* Password Strength Indicator */}
                {newPassword.length > 0 && (
                  <View style={styles.strengthContainer}>
                    <View style={styles.strengthBarsRow}>
                      <View
                        style={[
                          styles.strengthBar,
                          {
                            backgroundColor:
                              passwordStrength.score >= 1 ? passwordStrength.color : theme.divider,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.strengthBar,
                          {
                            backgroundColor:
                              passwordStrength.score >= 2 ? passwordStrength.color : theme.divider,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.strengthBar,
                          {
                            backgroundColor:
                              passwordStrength.score >= 3 ? passwordStrength.color : theme.divider,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.strengthText, { color: passwordStrength.color }]}>
                      {passwordStrength.label}
                    </Text>
                  </View>
                )}
              </View>

              {/* Confirm New Password Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.onSurface }]}>Confirm New Password</Text>
                <View
                  style={[
                    styles.inputContainer,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  ]}
                >
                  <TextInput
                    style={[styles.textInput, { color: theme.onSurface }]}
                    placeholder="Re-enter new password"
                    placeholderTextColor={theme.outline}
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    onPress={() => setShowConfirmPassword((prev) => !prev)}
                    hitSlop={8}
                    style={styles.eyeButton}
                  >
                    <Feather
                      name={showConfirmPassword ? 'eye-off' : 'eye'}
                      size={18}
                      color={theme.outline}
                    />
                  </Pressable>
                </View>

                {confirmPassword.length > 0 && (
                  <View style={styles.matchIndicatorRow}>
                    <Ionicons
                      name={passwordsMatch ? 'checkmark-circle' : 'close-circle'}
                      size={14}
                      color={passwordsMatch ? '#10B981' : '#EF4444'}
                    />
                    <Text
                      style={[
                        styles.matchIndicatorText,
                        { color: passwordsMatch ? '#10B981' : '#EF4444' },
                      ]}
                    >
                      {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                    </Text>
                  </View>
                )}
              </View>

              {/* Revoke other sessions switch */}
              <View style={styles.switchRow}>
                <View style={styles.switchTextContainer}>
                  <Text style={[styles.switchTitle, { color: theme.onSurface }]}>
                    Revoke other sessions
                  </Text>
                  <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                    Log out of all other devices upon saving
                  </Text>
                </View>
                <Switch
                  value={revokeOtherSessions}
                  onValueChange={setRevokeOtherSessions}
                  trackColor={{ false: theme.divider, true: theme.primary }}
                  thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
                />
              </View>

              {/* Submit button */}
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: theme.primary },
                  (isSubmitting || !currentPassword || !newPassword || !passwordsMatch) &&
                    styles.saveButtonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleChangePassword}
                disabled={isSubmitting || !currentPassword || !newPassword || !passwordsMatch}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <View style={styles.buttonContent}>
                    <Feather name="check" size={17} color="#ffffff" />
                    <Text style={styles.saveButtonText}>Update Password</Text>
                  </View>
                )}
              </Pressable>
            </View>
          )}

          {/* ─── E2EE & Active Device Diagnostics ─── */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <MaterialCommunityIcons name="shield-lock-outline" size={18} color={theme.primary} />
                <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>Security & E2EE Diagnostics</Text>
              </View>
            </View>

            <View style={styles.diagRow}>
              <View style={styles.diagLeft}>
                <Feather name="smartphone" size={16} color={theme.outline} />
                <Text style={[styles.diagLabel, { color: theme.onSurface }]}>Current Device</Text>
              </View>
              <Text style={[styles.diagValue, { color: theme.onSurfaceVariant }]}>
                {Platform.OS.toUpperCase()} {Platform.Version ? `(v${Platform.Version})` : ''}
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.divider }]} />

            <View style={styles.diagRow}>
              <View style={styles.diagLeft}>
                <Feather name="key" size={16} color={theme.outline} />
                <Text style={[styles.diagLabel, { color: theme.onSurface }]}>E2EE Device ID</Text>
              </View>
              <Text style={[styles.diagValueMono, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                {deviceId ? `${deviceId.slice(0, 16)}...` : 'Unavailable'}
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.divider }]} />

            <View style={styles.diagRow}>
              <View style={styles.diagLeft}>
                <Ionicons
                  name={hasE2EEKeys ? 'shield-checkmark' : 'alert-circle'}
                  size={16}
                  color={hasE2EEKeys ? '#10B981' : '#F59E0B'}
                />
                <Text style={[styles.diagLabel, { color: theme.onSurface }]}>End-to-End Encryption</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: hasE2EEKeys ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
                <Text style={[styles.statusBadgeText, { color: hasE2EEKeys ? '#10B981' : '#F59E0B' }]}>
                  {hasE2EEKeys ? 'Active & Keys Stored' : 'Not Ready'}
                </Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.divider }]} />

            {/* Invalidate all sessions */}
            <Pressable
              style={({ pressed }) => [
                styles.logoutEverywhereButton,
                { backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.12)' : '#FEF2F2' },
                pressed && styles.buttonPressed,
              ]}
              onPress={handleLogoutEverywhere}
              disabled={isLoggingOutEverywhere}
            >
              {isLoggingOutEverywhere ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <View style={styles.logoutEverywhereContent}>
                  <Feather name="log-out" size={16} color="#EF4444" />
                  <Text style={styles.logoutEverywhereText}>Log Out From All Devices</Text>
                </View>
              )}
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans-Bold',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 1,
  },
  headerRightSpacer: {
    width: 38,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
  },
  accountInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  userEmail: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 2,
  },
  joinDate: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
    marginTop: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  providerLabel: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  providerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  providerBadgeText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  oauthNoticeRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  oauthNoticeText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    lineHeight: 18,
    marginTop: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardSectionTitle: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    lineHeight: 17,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
  },
  eyeButton: {
    padding: 6,
  },
  strengthContainer: {
    gap: 4,
    marginTop: 4,
  },
  strengthBarsRow: {
    flexDirection: 'row',
    gap: 6,
    height: 4,
  },
  strengthBar: {
    flex: 1,
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  matchIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  matchIndicatorText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  switchTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  switchTitle: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  switchSubtitle: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 2,
  },
  saveButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  diagLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diagLabel: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  diagValue: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
  },
  diagValueMono: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Medium',
    maxWidth: 160,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  logoutEverywhereButton: {
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  logoutEverywhereContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoutEverywhereText: {
    color: '#EF4444',
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Bold',
  },
});
