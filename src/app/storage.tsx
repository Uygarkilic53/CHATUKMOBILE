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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import {
  calculateStorageDiagnostics,
  clearAppCache,
  getAutoDownloadPreference,
  setAutoDownloadPreference,
  StorageBreakdown,
  formatBytes,
} from '../utils/storageDiagnostics';

export default function StorageScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [storage, setStorage] = useState<StorageBreakdown>({
    messagesBytes: 0,
    mediaBytes: 0,
    audioVideoBytes: 0,
    totalBytes: 0,
    formattedMessages: '0 B',
    formattedMedia: '0 B',
    formattedAudioVideo: '0 B',
    formattedTotal: '0 B',
  });
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);

  // Load diagnostics and auto-download preference on mount
  const refreshDiagnostics = useCallback(async () => {
    try {
      const [diag, autoPref] = await Promise.all([
        calculateStorageDiagnostics(),
        getAutoDownloadPreference(),
      ]);
      setStorage(diag);
      setAutoDownloadEnabled(autoPref);
    } catch (err) {
      console.warn('Failed to load storage diagnostics:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [diag, autoPref] = await Promise.all([
          calculateStorageDiagnostics(),
          getAutoDownloadPreference(),
        ]);
        if (isMounted) {
          setStorage(diag);
          setAutoDownloadEnabled(autoPref);
        }
      } catch (err) {
        console.warn('Failed to load storage diagnostics:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleToggleAutoDownload = async (value: boolean) => {
    setAutoDownloadEnabled(value);
    await setAutoDownloadPreference(value);
    showToast(
      value
        ? 'Media auto-download enabled'
        : 'Media auto-download disabled (tap to download)',
      { type: 'info' }
    );
  };

  const handleClearCachePrompt = () => {
    Alert.alert(
      'Clear Transient Cache?',
      `This will free up approximately ${storage.formattedTotal} of temporary image and media files.\n\nYour login session, chat history, and E2EE cryptographic keys will remain completely safe.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: executeClearCache,
        },
      ]
    );
  };

  const executeClearCache = async () => {
    setIsClearing(true);
    try {
      const { freedBytes } = await clearAppCache();
      showToast(`Cleaned ${formatBytes(freedBytes)} of cached files!`, { type: 'success' });
      // Recalculate storage metrics
      const freshDiag = await calculateStorageDiagnostics();
      setStorage({
        ...freshDiag,
        mediaBytes: 0,
        audioVideoBytes: 0,
        totalBytes: freshDiag.messagesBytes,
        formattedMedia: '0 B',
        formattedAudioVideo: '0 B',
        formattedTotal: formatBytes(freshDiag.messagesBytes),
      });
    } catch {
      showToast('Failed to clear cache', { type: 'error' });
    } finally {
      setIsClearing(false);
    }
  };

  // Percentage shares for bar gauge
  const total = storage.totalBytes || 1;
  const msgPercent = Math.max(5, Math.round((storage.messagesBytes / total) * 100));
  const mediaPercent = Math.max(5, Math.round((storage.mediaBytes / total) * 100));
  const avPercent = Math.max(5, 100 - msgPercent - mediaPercent);

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
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Data & Storage</Text>
          <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
            Storage breakdown & cache control
          </Text>
        </View>
        <Pressable
          onPress={refreshDiagnostics}
          style={({ pressed }) => [
            styles.refreshButton,
            { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
            pressed && styles.buttonPressed,
          ]}
          hitSlop={8}
          accessibilityLabel="Refresh"
        >
          <Feather name="refresh-cw" size={17} color={theme.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.onSurfaceVariant }]}>
              Analyzing device storage...
            </Text>
          </View>
        ) : (
          <>
            {/* ─── Storage Gauge Card ─── */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <View style={styles.gaugeHeaderRow}>
                <View>
                  <Text style={[styles.gaugeLabel, { color: theme.onSurfaceVariant }]}>
                    TOTAL APP STORAGE
                  </Text>
                  <Text style={[styles.gaugeValue, { color: theme.onSurface }]}>
                    {storage.formattedTotal}
                  </Text>
                </View>
                <View
                  style={[
                    styles.storageBadge,
                    {
                      backgroundColor: theme.isDark ? 'rgba(14, 165, 233, 0.15)' : 'rgba(79, 70, 229, 0.1)',
                    },
                  ]}
                >
                  <Feather name="database" size={14} color={theme.primary} />
                  <Text style={[styles.storageBadgeText, { color: theme.primary }]}>Local</Text>
                </View>
              </View>

              {/* Multi-segment Progress Bar */}
              <View style={[styles.progressBarTrack, { backgroundColor: theme.cardItem }]}>
                <View
                  style={[
                    styles.progressBarSegment,
                    { width: `${msgPercent}%`, backgroundColor: '#6366F1' },
                  ]}
                />
                <View
                  style={[
                    styles.progressBarSegment,
                    { width: `${mediaPercent}%`, backgroundColor: '#EC4899' },
                  ]}
                />
                <View
                  style={[
                    styles.progressBarSegment,
                    { width: `${avPercent}%`, backgroundColor: '#0EA5E9' },
                  ]}
                />
              </View>

              {/* Legend Row */}
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#6366F1' }]} />
                  <Text style={[styles.legendText, { color: theme.onSurfaceVariant }]}>Messages</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#EC4899' }]} />
                  <Text style={[styles.legendText, { color: theme.onSurfaceVariant }]}>Photos</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#0EA5E9' }]} />
                  <Text style={[styles.legendText, { color: theme.onSurfaceVariant }]}>Audio/Video</Text>
                </View>
              </View>
            </View>

            {/* ─── Categorized Breakdown Section ─── */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                STORAGE BREAKDOWN
              </Text>

              {/* Card 1: Messages & SQLite */}
              <View
                style={[
                  styles.categoryCard,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder },
                ]}
              >
                <View style={styles.categoryCardLeft}>
                  <View style={[styles.categoryIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
                    <Feather name="message-square" size={18} color="#6366F1" />
                  </View>
                  <View style={styles.categoryTextContainer}>
                    <Text style={[styles.categoryTitle, { color: theme.onSurface }]}>
                      Messages & Local DB
                    </Text>
                    <Text style={[styles.categorySubtitle, { color: theme.onSurfaceVariant }]}>
                      SQLite message database & search indices
                    </Text>
                  </View>
                </View>
                <View style={[styles.sizeBadge, { backgroundColor: theme.cardItem }]}>
                  <Text style={[styles.sizeBadgeText, { color: theme.onSurface }]}>
                    {storage.formattedMessages}
                  </Text>
                </View>
              </View>

              {/* Card 2: Photos & Avatars */}
              <View
                style={[
                  styles.categoryCard,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder, marginTop: 8 },
                ]}
              >
                <View style={styles.categoryCardLeft}>
                  <View style={[styles.categoryIconBox, { backgroundColor: 'rgba(236, 72, 153, 0.12)' }]}>
                    <Feather name="image" size={18} color="#EC4899" />
                  </View>
                  <View style={styles.categoryTextContainer}>
                    <Text style={[styles.categoryTitle, { color: theme.onSurface }]}>
                      Photos & Wallpapers
                    </Text>
                    <Text style={[styles.categorySubtitle, { color: theme.onSurfaceVariant }]}>
                      Cached avatars & photo attachments
                    </Text>
                  </View>
                </View>
                <View style={[styles.sizeBadge, { backgroundColor: theme.cardItem }]}>
                  <Text style={[styles.sizeBadgeText, { color: theme.onSurface }]}>
                    {storage.formattedMedia}
                  </Text>
                </View>
              </View>

              {/* Card 3: Audio & Video */}
              <View
                style={[
                  styles.categoryCard,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder, marginTop: 8 },
                ]}
              >
                <View style={styles.categoryCardLeft}>
                  <View style={[styles.categoryIconBox, { backgroundColor: 'rgba(14, 165, 233, 0.12)' }]}>
                    <Feather name="video" size={18} color="#0EA5E9" />
                  </View>
                  <View style={styles.categoryTextContainer}>
                    <Text style={[styles.categoryTitle, { color: theme.onSurface }]}>
                      Voice & Video Media
                    </Text>
                    <Text style={[styles.categorySubtitle, { color: theme.onSurfaceVariant }]}>
                      Voice notes & video clips
                    </Text>
                  </View>
                </View>
                <View style={[styles.sizeBadge, { backgroundColor: theme.cardItem }]}>
                  <Text style={[styles.sizeBadgeText, { color: theme.onSurface }]}>
                    {storage.formattedAudioVideo}
                  </Text>
                </View>
              </View>
            </View>

            {/* ─── Media Auto-Download Section (WhatsApp Style) ─── */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                NETWORK & DOWNLOAD PREFERENCES
              </Text>

              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <View style={styles.switchRow}>
                  <View style={styles.switchTextContainer}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="download-cloud" size={17} color={theme.primary} />
                      <Text style={[styles.switchTitle, { color: theme.onSurface }]}>
                        Auto-Download Media
                      </Text>
                    </View>
                    <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                      When disabled, incoming photos and videos display a WhatsApp-style blurred
                      placeholder with a download button.
                    </Text>
                  </View>

                  <Switch
                    value={autoDownloadEnabled}
                    onValueChange={handleToggleAutoDownload}
                    trackColor={{
                      false: theme.isDark ? '#334155' : '#CBD5E1',
                      true: theme.primary,
                    }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {/* Status Indicator */}
                <View
                  style={[
                    styles.autoDownloadBanner,
                    {
                      backgroundColor: autoDownloadEnabled
                        ? theme.isDark
                          ? 'rgba(16, 185, 129, 0.1)'
                          : 'rgba(16, 185, 129, 0.08)'
                        : theme.isDark
                        ? 'rgba(245, 158, 11, 0.1)'
                        : 'rgba(245, 158, 11, 0.08)',
                      borderColor: autoDownloadEnabled ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)',
                    },
                  ]}
                >
                  <Ionicons
                    name={autoDownloadEnabled ? 'checkmark-circle-outline' : 'pause-circle-outline'}
                    size={16}
                    color={autoDownloadEnabled ? theme.success : '#F59E0B'}
                  />
                  <Text
                    style={[
                      styles.autoDownloadBannerText,
                      { color: autoDownloadEnabled ? theme.success : '#D97706' },
                    ]}
                  >
                    {autoDownloadEnabled
                      ? 'Media will be downloaded and decrypted automatically.'
                      : 'Media requires tap to download on demand in chat.'}
                  </Text>
                </View>
              </View>
            </View>

            {/* ─── Cache Purge Section ─── */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                CACHE MANAGEMENT
              </Text>

              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <View style={styles.cacheWarningRow}>
                  <View style={[styles.warningIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                    <Feather name="trash-2" size={18} color={theme.error} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cacheCardTitle, { color: theme.onSurface }]}>
                      Clear Transient Cache
                    </Text>
                    <Text style={[styles.cacheCardSubtitle, { color: theme.onSurfaceVariant }]}>
                      Safely frees storage by deleting cached images and temporary files. Login tokens
                      and encryption keys are never touched.
                    </Text>
                  </View>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.clearCacheButton,
                    {
                      backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
                      borderColor: theme.isDark ? 'rgba(239, 68, 68, 0.35)' : '#FCA5A5',
                    },
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={handleClearCachePrompt}
                  disabled={isClearing}
                >
                  {isClearing ? (
                    <ActivityIndicator size="small" color={theme.error} />
                  ) : (
                    <>
                      <Feather name="trash-2" size={16} color={theme.error} />
                      <Text style={[styles.clearCacheButtonText, { color: theme.error }]}>
                        Clear All Cache ({storage.formattedTotal})
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Footer Guarantee */}
            <View style={styles.footerNote}>
              <Feather name="shield" size={14} color={theme.outline} />
              <Text style={[styles.footerNoteText, { color: theme.outline }]}>
                Chatuk guarantees zero loss of E2EE cryptographic identity keys.
              </Text>
            </View>
          </>
        )}
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
  refreshButton: {
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
    paddingBottom: 40,
  },
  centerLoading: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  gaugeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  gaugeLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  gaugeValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 26,
    letterSpacing: -0.5,
    marginTop: 4,
  },
  storageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  storageBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
  },
  progressBarTrack: {
    height: 10,
    borderRadius: 5,
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 16,
  },
  progressBarSegment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 11,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  categoryCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  categoryIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryTextContainer: {
    flex: 1,
  },
  categoryTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
  },
  categorySubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    marginTop: 2,
  },
  sizeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  sizeBadgeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchTextContainer: {
    flex: 1,
    paddingRight: 14,
  },
  switchTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
  },
  switchSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  autoDownloadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 14,
  },
  autoDownloadBannerText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 11,
    flex: 1,
  },
  cacheWarningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  warningIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cacheCardTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
  },
  cacheCardSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  clearCacheButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  clearCacheButtonText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingHorizontal: 16,
  },
  footerNoteText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 11,
    textAlign: 'center',
  },
});
