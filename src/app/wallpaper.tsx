import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useWallpaper } from '../context/WallpaperContext';
import { WALLPAPERS, WallpaperItem, DEFAULT_WALLPAPER_ID, getWallpaperById } from '../constants/wallpapers';
import { getCachedWallpapers } from '../services/wallpaperCacheService';
import { useToast } from '../components/Toast';

export default function WallpaperScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { selectedWallpaper, syncStatus, isOffline, setWallpaper, resetWallpaper } = useWallpaper();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();

  // Local pending selection so user can preview before applying
  const [pendingWallpaperId, setPendingWallpaperId] = useState<string>(selectedWallpaper);
  const [isSaving, setIsSaving] = useState(false);
  const [wallpapersList, setWallpapersList] = useState<WallpaperItem[]>(WALLPAPERS);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const cached = await getCachedWallpapers();
        if (isMounted && cached.length > 0) {
          setWallpapersList(cached);
        }
      } catch {}
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const previewWallpaper: WallpaperItem = useMemo(() => {
    const match = wallpapersList.find((w) => w.id === pendingWallpaperId);
    return match || getWallpaperById(pendingWallpaperId);
  }, [wallpapersList, pendingWallpaperId]);

  const isApplied = pendingWallpaperId === selectedWallpaper;

  // Grid item width calculation (2 columns with padding and gap)
  const contentPadding = 16;
  const gap = 12;
  const itemWidth = Math.floor((width - contentPadding * 2 - gap) / 2);

  const handleSelect = (id: string) => {
    setPendingWallpaperId(id);
  };

  const handleApply = async () => {
    setIsSaving(true);
    try {
      await setWallpaper(pendingWallpaperId);
      const willSyncLater = isOffline || syncStatus === 'pending';
      showToast(
        pendingWallpaperId === DEFAULT_WALLPAPER_ID
          ? 'Reset to default chat background'
          : willSyncLater
          ? 'Wallpaper applied (will sync when online)'
          : `Wallpaper applied: ${previewWallpaper.name}`,
        { type: 'success' }
      );
    } catch {
      showToast('Failed to apply wallpaper', { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      setPendingWallpaperId(DEFAULT_WALLPAPER_ID);
      await resetWallpaper();
      showToast('Reset to default background', { type: 'info' });
    } catch {
      showToast('Failed to reset wallpaper', { type: 'error' });
    } finally {
      setIsSaving(false);
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
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Chat Wallpaper</Text>
          <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
            Personalize your messaging canvas
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ─── Offline Connectivity Banner ─── */}
        {isOffline ? (
          <View
            style={[
              styles.offlineBanner,
              {
                backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : '#FEF9C3',
                borderColor: theme.isDark ? 'rgba(234, 179, 8, 0.3)' : '#FDE047',
              },
            ]}
          >
            <Feather name="cloud-off" size={16} color={theme.isDark ? '#FACC15' : '#CA8A04'} />
            <Text
              style={[
                styles.offlineBannerText,
                { color: theme.isDark ? '#FEF08A' : '#854D0E' },
              ]}
            >
              Offline Mode — Changes will automatically sync when connection is restored
            </Text>
          </View>
        ) : null}

        {/* ─── Live Chat Bubble Preview Card ─── */}
        <View style={[styles.previewSection, { borderColor: theme.cardBorder }]}>
          <View style={styles.previewHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Feather name="eye" size={15} color={theme.primary} />
              <Text style={[styles.previewSectionLabel, { color: theme.onSurfaceVariant }]}>
                LIVE CHAT PREVIEW
              </Text>
            </View>
            <View
              style={[
                styles.categoryPill,
                {
                  backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                },
              ]}
            >
              <Text style={[styles.categoryPillText, { color: theme.primary }]}>
                {previewWallpaper.category}
              </Text>
            </View>
          </View>

          {/* Chat Mockup Window */}
          <View
            style={[
              styles.previewWindow,
              {
                backgroundColor: theme.isDark ? '#0B0F17' : '#F8FAFC',
                borderColor: theme.cardBorder,
              },
            ]}
          >
            {/* Background Wallpaper Image */}
            {previewWallpaper.source ? (
              <Image
                source={previewWallpaper.source}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
              />
            ) : null}

            {/* Contrast Overlay */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: previewWallpaper.source
                    ? theme.isDark
                      ? 'rgba(11, 19, 38, 0.35)'
                      : 'rgba(255, 255, 255, 0.18)'
                    : 'transparent',
                },
              ]}
            />

            {/* Mock Date Chip */}
            <View style={styles.mockDateContainer}>
              <View
                style={[
                  styles.mockDateChip,
                  {
                    backgroundColor: theme.isDark ? 'rgba(30, 41, 59, 0.85)' : 'rgba(255, 255, 255, 0.9)',
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.mockDateText, { color: theme.onSurfaceVariant }]}>Today</Text>
              </View>
            </View>

            {/* Received Bubble */}
            <View style={styles.mockReceivedRow}>
              <View
                style={[
                  styles.mockReceivedBubble,
                  {
                    backgroundColor: theme.isDark ? '#1E293B' : '#FFFFFF',
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.mockReceivedText, { color: theme.onSurface }]}>
                  How does the new chat background look? ✨
                </Text>
                <View style={styles.mockMetaRow}>
                  <Text style={[styles.mockTimeText, { color: theme.outline }]}>10:42 AM</Text>
                </View>
              </View>
            </View>

            {/* Sent Bubble */}
            <View style={styles.mockSentRow}>
              <LinearGradient
                colors={['#6366F1', '#A855F7']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.mockSentBubble}
              >
                <Text style={styles.mockSentText}>
                  Crisp contrast and pristine legibility! 🔥
                </Text>
                <View style={styles.mockSentMetaRow}>
                  <Text style={styles.mockSentTimeText}>10:43 AM</Text>
                  <Ionicons name="checkmark-done" size={13} color="#E0E7FF" style={{ marginLeft: 3 }} />
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* Wallpaper Caption Footer */}
          <View style={styles.previewFooterRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.previewWallpaperName, { color: theme.onSurface }]}>
                {previewWallpaper.name}
              </Text>
              <Text style={[styles.previewWallpaperAesthetic, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                {previewWallpaper.aesthetic}
              </Text>
            </View>
            {isApplied ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={[
                    styles.appliedBadge,
                    { backgroundColor: theme.isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.1)' },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={14} color={theme.success} />
                  <Text style={[styles.appliedBadgeText, { color: theme.success }]}>Current</Text>
                </View>
                {syncStatus === 'pending' || syncStatus === 'failed' ? (
                  <View
                    style={[
                      styles.pendingSyncBadge,
                      { backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.12)' },
                    ]}
                  >
                    <Feather name="clock" size={12} color={theme.isDark ? '#FACC15' : '#CA8A04'} />
                    <Text
                      style={[
                        styles.pendingSyncBadgeText,
                        { color: theme.isDark ? '#FACC15' : '#CA8A04' },
                      ]}
                    >
                      Pending Sync
                    </Text>
                  </View>
                ) : syncStatus === 'syncing' ? (
                  <View
                    style={[
                      styles.pendingSyncBadge,
                      { backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)' },
                    ]}
                  >
                    <Feather name="refresh-cw" size={12} color={theme.primary} />
                    <Text
                      style={[
                        styles.pendingSyncBadgeText,
                        { color: theme.primary },
                      ]}
                    >
                      Syncing
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* ─── Wallpaper Gallery Grid ─── */}
        <View style={styles.gallerySection}>
          <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
            SELECT A WALLPAPER
          </Text>

          <View style={styles.gridContainer}>
            {wallpapersList.map((item) => {
              const isSelected = item.id === pendingWallpaperId;
              const isCurrentActive = item.id === selectedWallpaper;

              return (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [
                    styles.gridItem,
                    {
                      width: itemWidth,
                      backgroundColor: theme.card,
                      borderColor: isSelected ? theme.primary : theme.cardBorder,
                      borderWidth: isSelected ? 2 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                  onPress={() => handleSelect(item.id)}
                >
                  {/* Thumbnail Container */}
                  <View
                    style={[
                      styles.thumbnailContainer,
                      {
                        backgroundColor: item.source ? '#000000' : theme.isDark ? '#0B0F17' : '#E2E8F0',
                      },
                    ]}
                  >
                    {item.source ? (
                      <Image
                        source={item.source}
                        style={styles.thumbnailImage}
                        contentFit="cover"
                        transition={150}
                      />
                    ) : (
                      <View style={styles.defaultThumbnailPlaceholder}>
                        <Feather name="slash" size={26} color={theme.outline} />
                        <Text style={[styles.defaultPlaceholderText, { color: theme.outline }]}>
                          No Wallpaper
                        </Text>
                      </View>
                    )}

                    {/* Active Selected Check Badge */}
                    {isSelected && (
                      <View style={[styles.checkBadge, { backgroundColor: theme.primary }]}>
                        <Feather name="check" size={14} color="#FFFFFF" />
                      </View>
                    )}

                    {/* Currently in-use badge */}
                    {isCurrentActive && !isSelected && (
                      <View style={styles.currentDotBadge}>
                        <View
                          style={[
                            styles.currentDot,
                            {
                              backgroundColor:
                                syncStatus === 'pending' || syncStatus === 'failed'
                                  ? '#EAB308'
                                  : theme.success,
                            },
                          ]}
                        />
                      </View>
                    )}
                  </View>

                  {/* Thumbnail Details */}
                  <View style={styles.gridItemInfo}>
                    <Text
                      style={[
                        styles.gridItemTitle,
                        { color: isSelected ? theme.primary : theme.onSurface },
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.gridItemCategory, { color: theme.outline }]} numberOfLines={1}>
                      {item.category}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* ─── Bottom Floating Action Bar ─── */}
      <View
        style={[
          styles.bottomActionBar,
          {
            backgroundColor: theme.card,
            borderTopColor: theme.cardBorder,
          },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.resetButton,
            {
              backgroundColor: theme.cardItem,
              borderColor: theme.cardBorder,
            },
            pressed && styles.buttonPressed,
          ]}
          onPress={handleReset}
          disabled={isSaving}
        >
          <Feather name="rotate-ccw" size={15} color={theme.onSurfaceVariant} />
          <Text style={[styles.resetButtonText, { color: theme.onSurfaceVariant }]}>Default</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.applyButton,
            {
              backgroundColor: isApplied ? (theme.isDark ? '#1E293B' : '#E2E8F0') : theme.primary,
              opacity: isSaving ? 0.7 : 1,
            },
            pressed && styles.buttonPressed,
          ]}
          onPress={handleApply}
          disabled={isSaving || isApplied}
        >
          <Feather
            name={isApplied ? 'check' : 'check-circle'}
            size={16}
            color={isApplied ? theme.onSurfaceVariant : '#FFFFFF'}
          />
          <Text
            style={[
              styles.applyButtonText,
              { color: isApplied ? theme.onSurfaceVariant : '#FFFFFF' },
            ]}
          >
            {isApplied ? 'Applied' : 'Apply Wallpaper'}
          </Text>
        </Pressable>
      </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    marginTop: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
  },
  previewSection: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 24,
  },
  previewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  previewSectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  categoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  categoryPillText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
  },
  previewWindow: {
    height: 200,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'space-between',
    padding: 14,
  },
  mockDateContainer: {
    alignItems: 'center',
  },
  mockDateChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  mockDateText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 10,
  },
  mockReceivedRow: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
  },
  mockReceivedBubble: {
    borderRadius: 14,
    borderBottomLeftRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  mockReceivedText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  mockMetaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 3,
  },
  mockTimeText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 9,
  },
  mockSentRow: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
  },
  mockSentBubble: {
    borderRadius: 14,
    borderBottomRightRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mockSentText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: '#FFFFFF',
  },
  mockSentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 3,
  },
  mockSentTimeText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  previewFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.2)',
  },
  previewWallpaperName: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
  },
  previewWallpaperAesthetic: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    marginTop: 1,
  },
  appliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  appliedBadgeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
  },
  gallerySection: {
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 6,
  },
  thumbnailContainer: {
    height: 150,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  defaultThumbnailPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  defaultPlaceholderText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 11,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  currentDotBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gridItemInfo: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 4,
  },
  gridItemTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
  },
  gridItemCategory: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 10,
    marginTop: 1,
  },
  bottomActionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 1,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  resetButtonText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
  },
  applyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  applyButtonText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  offlineBannerText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  pendingSyncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 6,
  },
  pendingSyncBadgeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
  },
});
