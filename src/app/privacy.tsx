import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule } from 'expo-audio';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import { usePreferences } from '../context/PreferencesContext';
import { api } from '../lib/api';
import { getSafeImageSource } from '../utils/image';

interface BlockedUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface PermissionState {
  granted: boolean;
  canAskAgain: boolean;
}

export default function PrivacyScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { preferences, updatePreferences } = usePreferences();

  // Blocked contacts state
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState<boolean>(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // System permissions state
  const [cameraPerm, setCameraPerm] = useState<PermissionState>({ granted: false, canAskAgain: true });
  const [micPerm, setMicPerm] = useState<PermissionState>({ granted: false, canAskAgain: true });
  const [photosPerm, setPhotosPerm] = useState<PermissionState>({ granted: false, canAskAgain: true });
  const [isLoadingPerms, setIsLoadingPerms] = useState<boolean>(true);

  // Check all hardware permissions
  const checkPermissions = useCallback(async () => {
    try {
      const [camera, mic, photos] = await Promise.all([
        ImagePicker.getCameraPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true })),
        AudioModule.getRecordingPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true })),
        ImagePicker.getMediaLibraryPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true })),
      ]);

      setCameraPerm({ granted: Boolean(camera.granted), canAskAgain: Boolean(camera.canAskAgain) });
      setMicPerm({ granted: Boolean(mic.granted), canAskAgain: Boolean(mic.canAskAgain) });
      setPhotosPerm({ granted: Boolean(photos.granted), canAskAgain: Boolean(photos.canAskAgain) });
    } catch (err) {
      console.warn('[PrivacyScreen] Error checking hardware permissions:', err);
    } finally {
      setIsLoadingPerms(false);
    }
  }, []);

  // Fetch blocked users
  const fetchBlockedUsers = useCallback(async () => {
    try {
      const res = await api.getBlockedUsers();
      if (res?.blockedUsers && Array.isArray(res.blockedUsers)) {
        setBlockedUsers(res.blockedUsers);
      } else if (res?.blockedUserIds && Array.isArray(res.blockedUserIds)) {
        // Fallback if profiles not yet populated
        setBlockedUsers(
          res.blockedUserIds.map((id: string) => ({
            id,
            name: 'Blocked Contact',
            email: '',
            image: null,
          }))
        );
      }
    } catch (err) {
      console.warn('[PrivacyScreen] Error loading blocked users:', err);
    } finally {
      setIsLoadingBlocked(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      if (!isMounted) return;
      await checkPermissions();
      await fetchBlockedUsers();
    })();

    // Re-check permissions when returning from system settings
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkPermissions();
      }
    });

    return () => {
      isMounted = false;
      sub.remove();
    };
  }, [checkPermissions, fetchBlockedUsers]);

  // Request or open settings for Camera
  const handleCameraPermission = async () => {
    if (cameraPerm.granted) return;
    try {
      const res = await ImagePicker.requestCameraPermissionsAsync();
      setCameraPerm({ granted: Boolean(res.granted), canAskAgain: Boolean(res.canAskAgain) });
      if (!res.granted && !res.canAskAgain && Platform.OS !== 'web') {
        Linking.openSettings();
      }
    } catch {
      if (Platform.OS !== 'web') Linking.openSettings();
    }
  };

  // Request or open settings for Microphone
  const handleMicPermission = async () => {
    if (micPerm.granted) return;
    try {
      const res = await AudioModule.requestRecordingPermissionsAsync();
      setMicPerm({ granted: Boolean(res.granted), canAskAgain: Boolean(res.canAskAgain) });
      if (!res.granted && !res.canAskAgain && Platform.OS !== 'web') {
        Linking.openSettings();
      }
    } catch {
      if (Platform.OS !== 'web') Linking.openSettings();
    }
  };

  // Request or open settings for Photos
  const handlePhotosPermission = async () => {
    if (photosPerm.granted) return;
    try {
      const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
      setPhotosPerm({ granted: Boolean(res.granted), canAskAgain: Boolean(res.canAskAgain) });
      if (!res.granted && !res.canAskAgain && Platform.OS !== 'web') {
        Linking.openSettings();
      }
    } catch {
      if (Platform.OS !== 'web') Linking.openSettings();
    }
  };

  // Unblock user confirmation
  const handleUnblockPrompt = (user: BlockedUser) => {
    Alert.alert(
      `Unblock ${user.name}?`,
      'They will be able to message you and see when you are online.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: () => executeUnblock(user),
        },
      ]
    );
  };

  const executeUnblock = async (user: BlockedUser) => {
    setUnblockingId(user.id);
    const previous = [...blockedUsers];
    // Optimistic removal
    setBlockedUsers((prev) => prev.filter((u) => u.id !== user.id));

    try {
      await api.unblockUser(user.id);
      showToast(`${user.name} has been unblocked`, { type: 'success' });
    } catch (err: any) {
      console.error('[PrivacyScreen] Failed to unblock user:', err);
      setBlockedUsers(previous);
      showToast(err?.message || 'Failed to unblock user', { type: 'error' });
    } finally {
      setUnblockingId(null);
    }
  };

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
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Privacy & Permissions</Text>
          <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
            Read receipts, blocked contacts & hardware
          </Text>
        </View>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Privacy Controls Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Feather name="lock" size={18} color={theme.primary} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>Privacy Controls</Text>
            </View>
          </View>

          {/* Read Receipts Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Read Receipts</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                {"If turned off, you won't send or see blue checkmarks when messages are viewed"}
              </Text>
            </View>
            <Switch
              value={preferences.readReceipts}
              onValueChange={(val) => {
                updatePreferences({ readReceipts: val });
                showToast(val ? 'Read receipts enabled' : 'Read receipts disabled', { type: 'info' });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Last Seen / Online Presence Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Online Status & Presence</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Allow contacts to see your online presence and last seen indicators
              </Text>
            </View>
            <Switch
              value={preferences.showLastSeen}
              onValueChange={(val) => {
                updatePreferences({ showLastSeen: val });
                showToast(val ? 'Online presence visible' : 'Online presence hidden', { type: 'info' });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>
        </View>

        {/* ─── Blocked Contacts Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Feather name="slash" size={18} color={theme.error} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>
                Blocked Contacts ({blockedUsers.length})
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>
            Blocked contacts cannot send you messages or start audio/video calls with you.
          </Text>

          {isLoadingBlocked ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          ) : blockedUsers.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="shield-check-outline" size={42} color={theme.outline} />
              <Text style={[styles.emptyTitle, { color: theme.onSurface }]}>No Blocked Contacts</Text>
              <Text style={[styles.emptySubtitle, { color: theme.onSurfaceVariant }]}>
                Contacts you block from individual conversations or profile settings will appear here.
              </Text>
            </View>
          ) : (
            <View style={styles.blockedList}>
              {blockedUsers.map((user, index) => {
                const isUnblocking = unblockingId === user.id;
                return (
                  <React.Fragment key={user.id}>
                    {index > 0 && <View style={[styles.divider, { backgroundColor: theme.divider }]} />}
                    <View style={styles.blockedUserRow}>
                      <Image
                        source={getSafeImageSource(user.image)}
                        style={[styles.blockedAvatar, { backgroundColor: theme.cardItem, borderColor: theme.cardBorder }]}
                        contentFit="cover"
                      />
                      <View style={styles.blockedUserInfo}>
                        <Text style={[styles.blockedUserName, { color: theme.onSurface }]} numberOfLines={1}>
                          {user.name}
                        </Text>
                        {user.email ? (
                          <Text style={[styles.blockedUserEmail, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                            {user.email}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        style={({ pressed }) => [
                          styles.unblockButton,
                          {
                            backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
                            borderColor: theme.isDark ? 'rgba(239, 68, 68, 0.3)' : '#FCA5A5',
                          },
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={() => handleUnblockPrompt(user)}
                        disabled={isUnblocking}
                      >
                        {isUnblocking ? (
                          <ActivityIndicator size="small" color="#EF4444" />
                        ) : (
                          <Text style={styles.unblockButtonText}>Unblock</Text>
                        )}
                      </Pressable>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>

        {/* ─── App System Permissions Audit Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Feather name="settings" size={18} color={theme.primary} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>App Hardware Permissions</Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>
            Review mobile device permissions required for full Chatuk communication features.
          </Text>

          {isLoadingPerms ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          ) : (
            <View style={styles.permissionsList}>
              {/* Camera Permission */}
              <View style={styles.permRow}>
                <View style={[styles.permIconContainer, { backgroundColor: theme.cardItem }]}>
                  <Feather name="camera" size={18} color={theme.primary} />
                </View>
                <View style={styles.permTextContainer}>
                  <Text style={[styles.permTitle, { color: theme.onSurface }]}>Camera</Text>
                  <Text style={[styles.permDesc, { color: theme.onSurfaceVariant }]}>
                    Take photos and capture video attachments
                  </Text>
                </View>
                {cameraPerm.granted ? (
                  <View style={[styles.permBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={[styles.permBadgeText, { color: '#10B981' }]}>Granted</Text>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.grantButton,
                      { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleCameraPermission}
                  >
                    <Text style={[styles.grantButtonText, { color: theme.primary }]}>
                      {cameraPerm.canAskAgain ? 'Allow' : 'Settings'}
                    </Text>
                  </Pressable>
                )}
              </View>

              <View style={[styles.divider, { backgroundColor: theme.divider }]} />

              {/* Microphone Permission */}
              <View style={styles.permRow}>
                <View style={[styles.permIconContainer, { backgroundColor: theme.cardItem }]}>
                  <Feather name="mic" size={18} color={theme.secondaryContainer} />
                </View>
                <View style={styles.permTextContainer}>
                  <Text style={[styles.permTitle, { color: theme.onSurface }]}>Microphone</Text>
                  <Text style={[styles.permDesc, { color: theme.onSurfaceVariant }]}>
                    Record voice messages and audio calls
                  </Text>
                </View>
                {micPerm.granted ? (
                  <View style={[styles.permBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={[styles.permBadgeText, { color: '#10B981' }]}>Granted</Text>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.grantButton,
                      { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleMicPermission}
                  >
                    <Text style={[styles.grantButtonText, { color: theme.primary }]}>
                      {micPerm.canAskAgain ? 'Allow' : 'Settings'}
                    </Text>
                  </Pressable>
                )}
              </View>

              <View style={[styles.divider, { backgroundColor: theme.divider }]} />

              {/* Photo Library Permission */}
              <View style={styles.permRow}>
                <View style={[styles.permIconContainer, { backgroundColor: theme.cardItem }]}>
                  <Feather name="image" size={18} color={theme.tertiary} />
                </View>
                <View style={styles.permTextContainer}>
                  <Text style={[styles.permTitle, { color: theme.onSurface }]}>Photo Library</Text>
                  <Text style={[styles.permDesc, { color: theme.onSurfaceVariant }]}>
                    Pick media files and chat wallpapers
                  </Text>
                </View>
                {photosPerm.granted ? (
                  <View style={[styles.permBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={[styles.permBadgeText, { color: '#10B981' }]}>Granted</Text>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.grantButton,
                      { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handlePhotosPermission}
                  >
                    <Text style={[styles.grantButtonText, { color: theme.primary }]}>
                      {photosPerm.canAskAgain ? 'Allow' : 'Settings'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
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
    lineHeight: 16,
  },
  centerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 16,
  },
  blockedList: {
    gap: 4,
  },
  blockedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 12,
  },
  blockedAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
  },
  blockedUserInfo: {
    flex: 1,
  },
  blockedUserName: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  blockedUserEmail: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 1,
  },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockButtonText: {
    color: '#EF4444',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  permissionsList: {
    gap: 4,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 12,
  },
  permIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permTextContainer: {
    flex: 1,
  },
  permTitle: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  permDesc: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 1,
  },
  permBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  permBadgeText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  grantButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  grantButtonText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
});
