import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSession, signOut } from '../lib/auth-client';
import { api, clearSessionAuth, setIsLoggingOut, isLoggingOutState } from '../lib/api';
import { socketService } from '../services/socket';
import { LoadingIndicator } from '../components/LoadingIndicator';
import BackupSettingsModal from '../components/BackupSettingsModal';
import { wipeAllSecureKeys } from '../e2ee/keyStore';
import { wipeLocalDb } from '../e2ee/localDb';
import { useTheme } from '../context/ThemeContext';
import { ThemeMode } from '../constants/theme';
import { getSafeImageSource } from '../utils/image';

interface MenuItemProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isDestructive?: boolean;
  onPress?: () => void;
  badge?: string;
}

const MenuItem = ({ icon, title, subtitle, isDestructive, onPress, badge }: MenuItemProps) => {
  const { theme } = useTheme();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuItem,
        { backgroundColor: pressed ? theme.cardItem : theme.card },
      ]}
      onPress={onPress}
    >
      <View style={styles.menuItemLeft}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: isDestructive ? (theme.isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2') : theme.cardItem },
          ]}
        >
          {icon}
        </View>
        <View style={styles.menuTextContainer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              style={[
                styles.menuTitle,
                { color: isDestructive ? theme.error : theme.onSurface },
              ]}
            >
              {title}
            </Text>
            {badge ? (
              <View
                style={[
                  styles.menuBadge,
                  { backgroundColor: theme.isDark ? 'rgba(14, 165, 233, 0.2)' : 'rgba(79, 70, 229, 0.1)' },
                ]}
              >
                <Text style={[styles.menuBadgeText, { color: theme.primary }]}>{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text
            style={[
              styles.menuSubtitle,
              { color: isDestructive ? '#f87171' : theme.onSurfaceVariant },
            ]}
          >
            {subtitle}
          </Text>
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={theme.outline} />
    </Pressable>
  );
};

export default function ProfileScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  const { theme, themeMode, setTheme, isSyncing } = useTheme();

  const [customAvatarUri, setCustomAvatarUri] = useState<string | null | undefined>(undefined);
  const avatarUri = customAvatarUri !== undefined ? customAvatarUri : (session?.user?.image || null);
  const [isUploading, setIsUploading] = useState(false);
  const [isActionModalVisible, setIsActionModalVisible] = useState(false);
  const [isThemeModalVisible, setIsThemeModalVisible] = useState(false);
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);

  // Bio state
  const [bio, setBio] = useState('My bio...');
  const [isBioModalVisible, setIsBioModalVisible] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [isBioInputFocused, setIsBioInputFocused] = useState(false);

  // Fetch bio and fresh profile on mount
  useEffect(() => {
    let isMounted = true;
    if (!session?.user) return;

    (async () => {
      try {
        const token = (session as any)?.session?.token || (session as any)?.token;
        const res = await api.getProfile(token);
        if (res?.user?.bio && isMounted) {
          setBio(res.user.bio);
        }
      } catch (err) {
        console.warn('Could not load profile bio:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const handleSignOut = async () => {
    if (isLoggingOutState()) return;
    try {
      setIsLoggingOut(true);
      socketService.disconnect();
      await clearSessionAuth().catch(() => {});
      await wipeAllSecureKeys().catch(() => {});
      await wipeLocalDb().catch(() => {});
      await signOut().catch(() => {});
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      await clearSessionAuth().catch(() => {});
      if (router.canDismiss()) {
        router.dismissAll();
      }
      router.replace('/');
      setTimeout(() => {
        setIsLoggingOut(false);
      }, 500);
    }
  };

  const handlePickFromLibrary = async () => {
    setIsActionModalVisible(false);
    try {
      const currentPerm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let hasPermission = currentPerm.granted;

      if (!hasPermission) {
        const requestedPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        hasPermission = requestedPerm.granted;
      }

      if (!hasPermission) {
        Alert.alert(
          'Galeri İzni Gerekli',
          'Profil fotoğrafı seçebilmek için fotoğraf galerisine erişim izni vermeniz gerekiyor.'
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 120));

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const mimeType = asset.mimeType || 'image/jpeg';
        const base64Data = asset.base64
          ? `data:${mimeType};base64,${asset.base64}`
          : asset.uri;

        await uploadAvatar(base64Data);
      }
    } catch (error: any) {
      console.error('Gallery picker error:', error);
      Alert.alert('Hata', error?.message || 'Fotoğraf galerisine erişilemedi.');
    }
  };

  const handleTakePhoto = async () => {
    setIsActionModalVisible(false);
    try {
      const currentPerm = await ImagePicker.getCameraPermissionsAsync();
      let hasPermission = currentPerm.granted;

      if (!hasPermission) {
        const requestedPerm = await ImagePicker.requestCameraPermissionsAsync();
        hasPermission = requestedPerm.granted;
      }

      if (!hasPermission) {
        Alert.alert(
          'Kamera İzni Gerekli',
          'Fotoğraf çekebilmek için kamera erişim izni vermeniz gerekiyor.'
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 120));

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const mimeType = asset.mimeType || 'image/jpeg';
        const base64Data = asset.base64
          ? `data:${mimeType};base64,${asset.base64}`
          : asset.uri;

        await uploadAvatar(base64Data);
      }
    } catch (error: any) {
      console.error('Camera error:', error);
      Alert.alert('Hata', error?.message || 'Kamera açılamadı.');
    }
  };

  const uploadAvatar = async (imageData: string) => {
    setIsUploading(true);
    try {
      const token =
        (session as any)?.session?.token ||
        (session as any)?.token ||
        (session as any)?.sessionToken;

      const res = await api.uploadProfilePicture(imageData, token);
      if (res?.imageUrl) {
        setCustomAvatarUri(res.imageUrl);
        Alert.alert('Başarılı', 'Profil fotoğrafınız güncellendi!');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      Alert.alert('Yükleme Başarısız', err?.message || 'Profil fotoğrafı güncellenemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    setIsActionModalVisible(false);
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile picture?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsUploading(true);
            try {
              const token = (session as any)?.session?.token || (session as any)?.token;
              await api.deleteProfilePicture(token);
              setCustomAvatarUri(null);
              Alert.alert('Success', 'Profile picture removed.');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to remove profile picture');
            } finally {
              setIsUploading(false);
            }
          },
        },
      ]
    );
  };

  const handleSelectTheme = async (mode: ThemeMode) => {
    await setTheme(mode);
  };

  const handleSaveBio = async () => {
    if (isSavingBio) return;
    setIsSavingBio(true);
    Keyboard.dismiss();
    try {
      const trimmed = bioInput.trim();
      const token = (session as any)?.session?.token || (session as any)?.token;
      await api.updateBio(trimmed, token);
      setBio(trimmed || 'My bio...');
      setIsBioModalVisible(false);
      Alert.alert('Success', 'Bio updated successfully!');
    } catch (err: any) {
      console.error('Failed to update bio:', err);
      Alert.alert('Error', err?.message || 'Failed to update bio');
    } finally {
      setIsSavingBio(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
          style={[
            styles.backButton,
            {
              backgroundColor: theme.card,
              borderColor: theme.cardBorder,
            },
          ]}
        >
          <Feather name="arrow-left" size={20} color={theme.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Settings</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View
          style={[
            styles.profileCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.cardBorder,
            },
          ]}
        >
          <View style={styles.avatarContainer}>
            <Image
              source={getSafeImageSource(avatarUri)}
              style={[
                styles.avatarLarge,
                {
                  borderColor: theme.primary,
                  backgroundColor: theme.cardItem,
                },
              ]}
              contentFit="cover"
            />
            {isUploading && (
              <View style={styles.avatarLoadingOverlay}>
                <LoadingIndicator
                  variant="bar"
                  width={54}
                  height={5}
                  gradientColors={['#ffffff', '#c7d2fe', '#ffffff']}
                  trackColor="rgba(255, 255, 255, 0.3)"
                />
              </View>
            )}
            <Pressable
              style={[
                styles.editBadge,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.card,
                },
              ]}
              onPress={() => setIsActionModalVisible(true)}
              disabled={isUploading}
            >
              <Feather name="camera" size={14} color="#ffffff" />
            </Pressable>
          </View>

          <View style={styles.identityContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.nameText, { color: theme.onSurface }]}>
                {session?.user?.name || 'User'}
              </Text>
              <Ionicons name="checkmark-circle" size={18} color={theme.primary} />
            </View>
            <Text style={[styles.emailText, { color: theme.onSurfaceVariant }]}>
              {session?.user?.email}
            </Text>
          </View>

          {/* Editable Bio Pill */}
          <Pressable
            style={({ pressed }) => [
              styles.bioPill,
              {
                backgroundColor: pressed ? (theme.isDark ? '#1a2236' : '#eef2ff') : theme.cardItem,
                borderColor: theme.cardBorder,
              },
            ]}
            onPress={() => {
              setBioInput(bio === 'My bio...' ? '' : bio);
              setIsBioModalVisible(true);
            }}
          >
            <Feather name="message-square" size={13} color={theme.primary} style={{ marginRight: 6 }} />
            <Text
              style={[
                styles.bioText,
                {
                  color: bio && bio !== 'My bio...' ? theme.onSurface : theme.onSurfaceVariant,
                  fontStyle: !bio || bio === 'My bio...' ? 'italic' : 'normal',
                },
              ]}
              numberOfLines={2}
            >
              {bio && bio !== 'My bio...' ? bio : 'Add a bio...'}
            </Text>
            <Feather name="edit-2" size={12} color={theme.primaryLight} style={{ marginLeft: 8 }} />
          </Pressable>

          <View style={styles.quickActions}>
            <Pressable
              style={[
                styles.actionButton,
                {
                  backgroundColor: theme.cardItem,
                  borderColor: theme.cardBorder,
                },
              ]}
              onPress={() => setIsActionModalVisible(true)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="edit-3" size={14} color={theme.primaryLight} />
                <Text style={[styles.actionButtonText, { color: theme.onSurface }]}>Edit Photo</Text>
              </View>
            </Pressable>

            <Pressable
              style={[
                styles.actionButton,
                {
                  backgroundColor: theme.cardItem,
                  borderColor: theme.cardBorder,
                },
              ]}
              onPress={() => { }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="share-2" size={14} color={theme.primaryLight} />
                <Text style={[styles.actionButtonText, { color: theme.onSurface }]}>Share</Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* Preferences Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: theme.onSurfaceVariant }]}>PREFERENCES</Text>
          <View style={[styles.menuGroup, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <MenuItem
              icon={<Feather name="shield" size={18} color={theme.primary} />}
              title="Account & Security"
              subtitle="Change password, account details & security"
              onPress={() => router.push('/security')}
            />
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <MenuItem
              icon={<Feather name="lock" size={18} color={theme.secondaryContainer} />}
              title="Privacy & Permissions"
              subtitle="Last seen, read receipts, blocked contacts"
              onPress={() => router.push('/privacy')}
            />
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <MenuItem
              icon={<Feather name="bell" size={18} color={theme.tertiary} />}
              title="Notifications & Sounds"
              subtitle="In-app sounds, vibration, banner alerts"
              onPress={() => router.push('/notifications')}
            />
          </View>
        </View>

        {/* App & Experience Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: theme.onSurfaceVariant }]}>APP & EXPERIENCE</Text>
          <View style={[styles.menuGroup, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <MenuItem
              icon={<Feather name={theme.isDark ? 'moon' : 'sun'} size={18} color={theme.primary} />}
              title="Appearance & Theme"
              subtitle={`${theme.name} • Saved to account`}
              badge={theme.isDark ? 'Obsidian' : 'Light'}
              onPress={() => setIsThemeModalVisible(true)}
            />
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <MenuItem
              icon={<Feather name="image" size={18} color="#ec4899" />}
              title="Chat Wallpaper"
              subtitle="Custom chat backgrounds & themes"
              onPress={() => router.push('/wallpaper')}
            />
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <MenuItem
              icon={<Feather name="database" size={18} color="#06b6d4" />}
              title="Data & Storage"
              subtitle="Storage metrics, cache & auto-download"
              onPress={() => router.push('/storage')}
            />
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <MenuItem
              icon={<Feather name="cloud" size={18} color="#6366f1" />}
              title="Encrypted Chat Backup"
              subtitle="Zero-knowledge cloud backup & restore"
              badge="E2EE"
              onPress={() => setIsBackupModalVisible(true)}
            />
          </View>
        </View>

        {/* Support Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: theme.onSurfaceVariant }]}>SUPPORT</Text>
          <View style={[styles.menuGroup, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <MenuItem
              icon={<Feather name="help-circle" size={18} color={theme.success} />}
              title="Help Center & FAQ"
              subtitle="Guides, bug reporting, contact team"
              onPress={() => router.push('/help')}
            />
            <View style={[styles.divider, { backgroundColor: theme.divider }]} />
            <MenuItem
              icon={<Feather name="log-out" size={18} color={theme.error} />}
              title="Log Out"
              subtitle="Sign out of Chatuk on this device"
              isDestructive
              onPress={handleSignOut}
            />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.onSurfaceVariant }]}>
            Chatuk for Mobile • v0.0.1
          </Text>
          <Text style={[styles.footerSubText, { color: theme.outline }]}>
            Encrypted & Crafted with Care
          </Text>
        </View>
      </ScrollView>

      {/* Theme Selection Bottom Sheet Modal */}
      {isThemeModalVisible && (
        <View style={styles.sheetOverlay}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setIsThemeModalVisible(false)}
          />
          <View
            style={[
              styles.sheetContent,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: theme.outlineVariant }]} />
            <Text style={[styles.sheetTitle, { color: theme.onSurface }]}>Appearance & Theme</Text>
            <Text style={[styles.sheetSubtitle, { color: theme.onSurfaceVariant }]}>
              Select your UI template. Your choice is permanently saved to your account.
            </Text>

            <View style={styles.themeOptionsContainer}>
              {/* Option 1: Chatuk Light */}
              <Pressable
                style={[
                  styles.themeOptionCard,
                  {
                    backgroundColor: themeMode === 'light' ? (theme.isDark ? '#1a2236' : '#f0f4ff') : theme.cardItem,
                    borderColor: themeMode === 'light' ? theme.primary : theme.cardBorder,
                  },
                ]}
                onPress={() => handleSelectTheme('light')}
              >
                <View style={styles.themeOptionHeader}>
                  <View style={styles.themeOptionLeft}>
                    <View
                      style={[
                        styles.themeIconBox,
                        { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderWidth: 1 },
                      ]}
                    >
                      <Feather name="sun" size={18} color="#4f46e5" />
                    </View>
                    <View style={styles.themeOptionTextContainer}>
                      <View style={styles.themeOptionTitleRow}>
                        <Text style={[styles.themeOptionTitle, { color: theme.onSurface }]}>
                          Chatuk Light
                        </Text>
                        <View style={styles.tagBadgeLight}>
                          <Text style={styles.tagBadgeLightText}>Light</Text>
                        </View>
                      </View>
                      <Text style={[styles.themeOptionTagline, { color: theme.onSurfaceVariant }]}>
                        Clean indigo canvas with crisp daytime readability
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.radioCircle,
                      {
                        borderColor: themeMode === 'light' ? theme.primary : theme.outline,
                        backgroundColor: themeMode === 'light' ? theme.primary : 'transparent',
                      },
                    ]}
                  >
                    {themeMode === 'light' && <Feather name="check" size={13} color="#ffffff" />}
                  </View>
                </View>

                {/* Swatches */}
                <View style={styles.swatchRow}>
                  <View style={[styles.swatchDot, { backgroundColor: '#ffffff', borderColor: '#cbd5e1', borderWidth: 1 }]} />
                  <View style={[styles.swatchDot, { backgroundColor: '#4f46e5' }]} />
                  <View style={[styles.swatchDot, { backgroundColor: '#0284c7' }]} />
                  <View style={[styles.swatchDot, { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderWidth: 1 }]} />
                  <Text style={[styles.swatchLabel, { color: theme.outline }]}>Indigo & Pure Slate</Text>
                </View>
              </Pressable>

              {/* Option 2: Obsidian Sky Messenger */}
              <Pressable
                style={[
                  styles.themeOptionCard,
                  {
                    backgroundColor: themeMode === 'obsidian-sky' ? (theme.isDark ? '#0f172a' : '#f0f9ff') : theme.cardItem,
                    borderColor: themeMode === 'obsidian-sky' ? theme.primary : theme.cardBorder,
                  },
                ]}
                onPress={() => handleSelectTheme('obsidian-sky')}
              >
                <View style={styles.themeOptionHeader}>
                  <View style={styles.themeOptionLeft}>
                    <View
                      style={[
                        styles.themeIconBox,
                        { backgroundColor: '#0B0F17', borderColor: '#1E293B', borderWidth: 1 },
                      ]}
                    >
                      <Feather name="moon" size={18} color="#0EA5E9" />
                    </View>
                    <View style={styles.themeOptionTextContainer}>
                      <View style={styles.themeOptionTitleRow}>
                        <Text style={[styles.themeOptionTitle, { color: theme.onSurface }]}>
                          Obsidian Sky Messenger
                        </Text>
                        <View style={styles.tagBadgeDark}>
                          <Text style={styles.tagBadgeDarkText}>Dark</Text>
                        </View>
                      </View>
                      <Text style={[styles.themeOptionTagline, { color: theme.onSurfaceVariant }]}>
                        Deep space obsidian with electric sky blue neon
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.radioCircle,
                      {
                        borderColor: themeMode === 'obsidian-sky' ? theme.primary : theme.outline,
                        backgroundColor: themeMode === 'obsidian-sky' ? theme.primary : 'transparent',
                      },
                    ]}
                  >
                    {themeMode === 'obsidian-sky' && <Feather name="check" size={13} color="#ffffff" />}
                  </View>
                </View>

                {/* Swatches */}
                <View style={styles.swatchRow}>
                  <View style={[styles.swatchDot, { backgroundColor: '#0B0F17' }]} />
                  <View style={[styles.swatchDot, { backgroundColor: '#0EA5E9' }]} />
                  <View style={[styles.swatchDot, { backgroundColor: '#38BDF8' }]} />
                  <View style={[styles.swatchDot, { backgroundColor: '#131B2E' }]} />
                  <Text style={[styles.swatchLabel, { color: theme.outline }]}>Obsidian & Sky Blue</Text>
                </View>
              </Pressable>
            </View>

            {isSyncing && (
              <View style={styles.syncStatusContainer}>
                <Text style={[styles.syncStatusText, { color: theme.primary }]}>
                  Saving template to your account...
                </Text>
              </View>
            )}

            <Pressable
              style={[styles.sheetDoneButton, { backgroundColor: theme.primary }]}
              onPress={() => setIsThemeModalVisible(false)}
            >
              <Text style={styles.sheetDoneButtonText}>Apply & Close</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Edit Bio Bottom Sheet Modal */}
      <Modal
        visible={isBioModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          Keyboard.dismiss();
          setIsBioModalVisible(false);
        }}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.bioModalOverlay}
        >
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => {
              Keyboard.dismiss();
              setIsBioModalVisible(false);
            }}
          />
          <View
            style={[
              styles.bioSheetContent,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: theme.outlineVariant }]} />

            {/* Header with Title and Close (X) button */}
            <View style={styles.bioModalHeader}>
              <View style={styles.bioModalHeaderLeft}>
                <View
                  style={[
                    styles.bioIconBadge,
                    { backgroundColor: theme.isDark ? 'rgba(14, 165, 233, 0.15)' : 'rgba(79, 70, 229, 0.1)' },
                  ]}
                >
                  <Feather name="edit-3" size={16} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bioModalTitle, { color: theme.onSurface }]}>
                    Edit Bio
                  </Text>
                  <Text style={[styles.bioHeaderSubtitle, { color: theme.onSurfaceVariant }]}>
                    Share a brief bio or status with your Chatuk contacts
                  </Text>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.bioCloseButton,
                  {
                    backgroundColor: pressed ? theme.cardItem : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                    borderColor: theme.cardBorder,
                  },
                ]}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsBioModalVisible(false);
                }}
                hitSlop={8}
              >
                <Feather name="x" size={18} color={theme.onSurfaceVariant} />
              </Pressable>
            </View>

            {/* Bio Text Input Card */}
            <View
              style={[
                styles.bioInputCard,
                {
                  backgroundColor: theme.cardItem,
                  borderColor: isBioInputFocused ? theme.primary : theme.cardBorder,
                  borderWidth: isBioInputFocused ? 1.5 : 1,
                },
              ]}
            >
              <TextInput
                style={[
                  styles.bioTextInput,
                  {
                    color: theme.onSurface,
                  },
                ]}
                placeholder="Tell others about yourself..."
                placeholderTextColor={theme.outline}
                value={bioInput}
                onChangeText={setBioInput}
                maxLength={120}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                onFocus={() => setIsBioInputFocused(true)}
                onBlur={() => setIsBioInputFocused(false)}
                autoFocus
              />

              {/* Bottom bar inside input card: Clear button + Char counter */}
              <View style={[styles.bioCardFooter, { borderTopColor: theme.cardBorder }]}>
                {bioInput.length > 0 ? (
                  <Pressable
                    style={styles.bioClearBtn}
                    onPress={() => setBioInput('')}
                    hitSlop={6}
                  >
                    <Feather name="x-circle" size={13} color={theme.outline} />
                    <Text style={[styles.bioClearText, { color: theme.outline }]}>Clear</Text>
                  </Pressable>
                ) : (
                  <View />
                )}

                <View style={styles.charCountContainer}>
                  <Text
                    style={[
                      styles.charCountText,
                      {
                        color:
                          bioInput.length >= 115
                            ? theme.error
                            : bioInput.length >= 95
                            ? (theme.isDark ? '#38bdf8' : '#6366f1')
                            : theme.outline,
                        fontWeight: bioInput.length >= 100 ? '700' : '500',
                      },
                    ]}
                  >
                    {bioInput.length}/120
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Status Chips */}
            <View style={styles.bioQuickSection}>
              <Text style={[styles.bioQuickLabel, { color: theme.outline }]}>
                QUICK IDEAS
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bioChipsScroll}
                keyboardShouldPersistTaps="handled"
              >
                {[
                  '👋 Hey there! I am using Chatuk',
                  '💻 Coding & creating',
                  '🚀 Building something cool',
                  '☕ Coffee & deep focus',
                  '🎧 In the zone',
                  '✨ Living in the moment',
                ].map((preset, idx) => (
                  <Pressable
                    key={idx}
                    style={({ pressed }) => [
                      styles.bioChip,
                      {
                        backgroundColor: pressed ? (theme.isDark ? '#1e293b' : '#e0e7ff') : theme.cardItem,
                        borderColor: bioInput === preset ? theme.primary : theme.cardBorder,
                      },
                    ]}
                    onPress={() => setBioInput(preset)}
                  >
                    <Text
                      style={[
                        styles.bioChipText,
                        {
                          color: bioInput === preset ? theme.primary : theme.onSurfaceVariant,
                          fontWeight: bioInput === preset ? '700' : '500',
                        },
                      ]}
                    >
                      {preset}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            {/* Action Buttons Row */}
            <View style={styles.bioActionsRow}>
              <Pressable
                style={[
                  styles.bioCancelBtn,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                  },
                ]}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsBioModalVisible(false);
                }}
                disabled={isSavingBio}
              >
                <Text style={[styles.bioCancelBtnText, { color: theme.onSurfaceVariant }]}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.bioSaveBtn,
                  {
                    backgroundColor: theme.primary,
                    opacity: isSavingBio ? 0.7 : 1,
                  },
                ]}
                onPress={handleSaveBio}
                disabled={isSavingBio}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {isSavingBio ? (
                    <LoadingIndicator
                      variant="bar"
                      width={28}
                      height={3}
                      gradientColors={['#ffffff', '#c7d2fe', '#ffffff']}
                      trackColor="rgba(255, 255, 255, 0.3)"
                    />
                  ) : (
                    <>
                      <Feather name="check" size={16} color="#ffffff" />
                      <Text style={styles.bioSaveBtnText}>Save Bio</Text>
                    </>
                  )}
                </View>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Profile Picture Actions Bottom Sheet Overlay */}
      {isActionModalVisible && (
        <View style={styles.sheetOverlay}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setIsActionModalVisible(false)}
          />
          <View
            style={[
              styles.sheetContent,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: theme.outlineVariant }]} />
            <Text style={[styles.sheetTitle, { color: theme.onSurface }]}>Profile Photo</Text>
            <Text style={[styles.sheetSubtitle, { color: theme.onSurfaceVariant }]}>
              Sync with Cloudinary and your account
            </Text>

            <View style={styles.sheetActions}>
              <Pressable
                style={[
                  styles.sheetOption,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                  },
                ]}
                onPress={handleTakePhoto}
              >
                <View
                  style={[
                    styles.sheetOptionIcon,
                    { backgroundColor: theme.isDark ? 'rgba(14, 165, 233, 0.15)' : '#eef2ff' },
                  ]}
                >
                  <Feather name="camera" size={18} color={theme.primary} />
                </View>
                <Text style={[styles.sheetOptionText, { color: theme.onSurface }]}>Take Photo</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.sheetOption,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                  },
                ]}
                onPress={handlePickFromLibrary}
              >
                <View
                  style={[
                    styles.sheetOptionIcon,
                    { backgroundColor: theme.isDark ? 'rgba(56, 189, 248, 0.15)' : '#f0f9ff' },
                  ]}
                >
                  <Feather name="image" size={18} color={theme.secondaryContainer} />
                </View>
                <Text style={[styles.sheetOptionText, { color: theme.onSurface }]}>Choose from Gallery</Text>
              </Pressable>

              {avatarUri ? (
                <Pressable
                  style={[
                    styles.sheetOption,
                    {
                      backgroundColor: theme.cardItem,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                  onPress={handleDeleteAvatar}
                >
                  <View
                    style={[
                      styles.sheetOptionIcon,
                      { backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2' },
                    ]}
                  >
                    <Feather name="trash-2" size={18} color={theme.error} />
                  </View>
                  <Text style={[styles.sheetOptionText, { color: theme.error }]}>Remove Photo</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={[styles.sheetCancelButton, { backgroundColor: theme.card }]}
                onPress={() => setIsActionModalVisible(false)}
              >
                <Text style={[styles.sheetCancelText, { color: theme.onSurfaceVariant }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Zero-Knowledge Encrypted Cloud Backup & Restore Modal */}
      <BackupSettingsModal
        visible={isBackupModalVisible}
        onClose={() => setIsBackupModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    width: 40,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  profileCard: {
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatarLarge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
  },
  avatarLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 48,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  identityContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  nameText: {
    fontSize: 22,
    fontWeight: '800',
  },
  emailText: {
    fontSize: 14,
    marginTop: 2,
    fontWeight: '500',
  },
  bioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    maxWidth: '90%',
  },
  bioText: {
    fontSize: 13,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 8,
  },
  menuGroup: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  menuSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  menuBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  menuBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    marginLeft: 72,
  },
  footer: {
    alignItems: 'center',
    marginTop: 16,
    paddingBottom: 24,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  footerSubText: {
    fontSize: 11,
    marginTop: 4,
  },
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheetContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  themeOptionsContainer: {
    gap: 12,
    marginBottom: 16,
  },
  themeOptionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
  },
  themeOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  themeOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 12,
  },
  themeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  themeOptionTextContainer: {
    flex: 1,
  },
  themeOptionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  themeOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  themeOptionTagline: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  tagBadgeLight: {
    backgroundColor: 'rgba(79, 70, 229, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  tagBadgeLightText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4f46e5',
  },
  tagBadgeDark: {
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  tagBadgeDarkText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0ea5e9',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  swatchDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  swatchLabel: {
    fontSize: 11,
    marginLeft: 4,
    fontWeight: '500',
  },
  syncStatusContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  syncStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bioModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bioSheetContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 28 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 16,
  },
  bioModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  bioModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  bioIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bioModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  bioHeaderSubtitle: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  bioCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginLeft: 8,
  },
  bioInputCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    marginBottom: 14,
  },
  bioTextInput: {
    fontSize: 15,
    minHeight: 76,
    maxHeight: 110,
    lineHeight: 22,
    padding: 0,
    margin: 0,
  },
  bioCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    marginTop: 4,
  },
  bioClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  bioClearText: {
    fontSize: 11,
    fontWeight: '600',
  },
  charCountContainer: {
    marginLeft: 'auto',
  },
  charCountText: {
    fontSize: 11,
  },
  bioQuickSection: {
    marginBottom: 16,
  },
  bioQuickLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  bioChipsScroll: {
    gap: 8,
    paddingRight: 12,
  },
  bioChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  bioChipText: {
    fontSize: 12,
  },
  bioActionsRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  bioCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bioCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bioSaveBtn: {
    flex: 1.5,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bioSaveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sheetDoneButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  sheetDoneButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  sheetActions: {
    gap: 10,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  sheetOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  sheetOptionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetCancelButton: {
    marginTop: 6,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
