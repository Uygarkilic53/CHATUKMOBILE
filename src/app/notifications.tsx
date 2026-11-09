import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import { usePreferences } from '../context/PreferencesContext';
import {
  soundService,
  SENDER_TONES,
  RECEIVER_TONES,
  SenderToneId,
  ReceiverToneId,
  SoundPreset,
} from '../services/soundService';

export default function NotificationsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { preferences, updatePreferences, resetPreferences } = usePreferences();

  const handleSelectSenderTone = (tone: SoundPreset<SenderToneId>) => {
    updatePreferences({ senderTone: tone.id });
    soundService.playSenderSound(tone.id);
    showToast(`Sending tone: ${tone.title}`, { type: 'info' });
  };

  const handleSelectReceiverTone = (tone: SoundPreset<ReceiverToneId>) => {
    updatePreferences({ receiverTone: tone.id, notificationTone: tone.id });
    soundService.playReceiverSound(tone.id);
    showToast(`Receiver tone: ${tone.title}`, { type: 'info' });
  };

  const handleResetDefaultsPrompt = () => {
    Alert.alert(
      'Reset All Notification Preferences?',
      'This will restore all sounds, vibrations, and in-app banner alerts back to factory default settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset to Defaults',
          style: 'destructive',
          onPress: async () => {
            await resetPreferences();
            showToast('Notification preferences reset to defaults', { type: 'success' });
          },
        },
      ]
    );
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
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Notifications & Sounds</Text>
          <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
            In-app sounds, vibration & alerts
          </Text>
        </View>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── In-App Sounds & Tones Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Feather name="bell" size={18} color={theme.primary} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>In-App Sounds & Tones</Text>
            </View>
          </View>

          {/* Master In-App Sounds switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>In-App Sounds</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Play audio effects for incoming and outgoing messages
              </Text>
            </View>
            <Switch
              value={preferences.inAppSounds}
              onValueChange={(val) => {
                updatePreferences({ inAppSounds: val });
                showToast(val ? 'In-app sounds enabled' : 'In-app sounds disabled', { type: 'info' });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Sent Message Sound switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Sent Message Chime</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Audio feedback when your message successfully sends
              </Text>
            </View>
            <Switch
              value={preferences.sentMessageSound}
              disabled={!preferences.inAppSounds}
              onValueChange={(val) => {
                updatePreferences({ sentMessageSound: val });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Receiver Tones (Incoming Messages) */}
          <View style={styles.toneSelectorContainer}>
            <View style={styles.toneHeaderRow}>
              <Feather name="download" size={13} color={theme.primary} />
              <Text style={[styles.toneSectionLabel, { color: theme.onSurfaceVariant }]}>
                RECEIVER TONE (INCOMING MESSAGES)
              </Text>
            </View>

            <View style={styles.toneList}>
              {RECEIVER_TONES.map((tone) => {
                const currentReceiverTone = preferences.receiverTone || 'default';
                const isSelected = currentReceiverTone === tone.id;
                return (
                  <Pressable
                    key={tone.id}
                    style={({ pressed }) => [
                      styles.toneRow,
                      {
                        backgroundColor: isSelected
                          ? theme.isDark
                            ? 'rgba(14, 165, 233, 0.12)'
                            : 'rgba(79, 70, 229, 0.08)'
                          : theme.cardItem,
                        borderColor: isSelected ? theme.primary : theme.cardBorder,
                      },
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => handleSelectReceiverTone(tone)}
                  >
                    <View style={styles.toneLeft}>
                      <View
                        style={[
                          styles.radioCircle,
                          {
                            borderColor: isSelected ? theme.primary : theme.outline,
                            backgroundColor: isSelected ? theme.primary : 'transparent',
                          },
                        ]}
                      >
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                      <View style={styles.toneTextContainer}>
                        <Text
                          style={[
                            styles.toneTitle,
                            { color: isSelected ? theme.primary : theme.onSurface },
                          ]}
                        >
                          {tone.title}
                        </Text>
                        <Text style={[styles.toneDescription, { color: theme.onSurfaceVariant }]}>
                          {tone.subtitle}
                        </Text>
                      </View>
                    </View>

                    {tone.assetSource && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.previewPlayButton,
                          { backgroundColor: theme.card, borderColor: theme.cardBorder },
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          soundService.playReceiverSound(tone.id);
                        }}
                        hitSlop={8}
                        accessibilityLabel={`Preview ${tone.title}`}
                      >
                        <Feather name="volume-2" size={15} color={theme.primary} />
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Sender Tones (Outgoing Messages) */}
          <View style={styles.toneSelectorContainer}>
            <View style={styles.toneHeaderRow}>
              <Feather name="upload" size={13} color={theme.secondaryContainer} />
              <Text style={[styles.toneSectionLabel, { color: theme.onSurfaceVariant }]}>
                SENDER TONE (OUTGOING MESSAGES)
              </Text>
            </View>

            <View style={styles.toneList}>
              {SENDER_TONES.map((tone) => {
                const currentSenderTone = preferences.senderTone || 'sending1';
                const isSelected = currentSenderTone === tone.id;
                return (
                  <Pressable
                    key={tone.id}
                    style={({ pressed }) => [
                      styles.toneRow,
                      {
                        backgroundColor: isSelected
                          ? theme.isDark
                            ? 'rgba(14, 165, 233, 0.12)'
                            : 'rgba(79, 70, 229, 0.08)'
                          : theme.cardItem,
                        borderColor: isSelected ? theme.primary : theme.cardBorder,
                      },
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => handleSelectSenderTone(tone)}
                  >
                    <View style={styles.toneLeft}>
                      <View
                        style={[
                          styles.radioCircle,
                          {
                            borderColor: isSelected ? theme.primary : theme.outline,
                            backgroundColor: isSelected ? theme.primary : 'transparent',
                          },
                        ]}
                      >
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                      <View style={styles.toneTextContainer}>
                        <Text
                          style={[
                            styles.toneTitle,
                            { color: isSelected ? theme.primary : theme.onSurface },
                          ]}
                        >
                          {tone.title}
                        </Text>
                        <Text style={[styles.toneDescription, { color: theme.onSurfaceVariant }]}>
                          {tone.subtitle}
                        </Text>
                      </View>
                    </View>

                    {tone.assetSource && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.previewPlayButton,
                          { backgroundColor: theme.card, borderColor: theme.cardBorder },
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          soundService.playSenderSound(tone.id);
                        }}
                        hitSlop={8}
                        accessibilityLabel={`Preview ${tone.title}`}
                      >
                        <Feather name="volume-2" size={15} color={theme.primary} />
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* ─── Haptics & Vibration Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <MaterialCommunityIcons name="vibrate" size={18} color={theme.primary} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>Vibration & Haptics</Text>
            </View>
          </View>

          {/* Vibrate on Messages Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Vibrate on Messages</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Trigger tactile vibration pulse when an incoming message is received
              </Text>
            </View>
            <Switch
              value={preferences.vibration}
              onValueChange={(val) => {
                updatePreferences({ vibration: val });
                if (val) {
                  soundService.playReceiverSound('silent');
                }
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Haptic Touch Feedback Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Haptic Touch Feedback</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Subtle physical vibration when pressing buttons and recording audio
              </Text>
            </View>
            <Switch
              value={preferences.hapticFeedback}
              onValueChange={(val) => {
                updatePreferences({ hapticFeedback: val });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>
        </View>

        {/* ─── In-App Floating Banners Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Feather name="message-square" size={18} color={theme.primary} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>In-App Banners</Text>
            </View>
          </View>

          {/* Show In-App Banners Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Show In-App Banners</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Display drop-down notification banners while using other screens in Chatuk
              </Text>
            </View>
            <Switch
              value={preferences.inAppBanners}
              onValueChange={(val) => {
                updatePreferences({ inAppBanners: val });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Message Preview Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Message Preview</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Show sender text preview in banner notifications (turn off for privacy)
              </Text>
            </View>
            <Switch
              value={preferences.messagePreview}
              disabled={!preferences.inAppBanners}
              onValueChange={(val) => {
                updatePreferences({ messagePreview: val });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>
        </View>

        {/* ─── Voice & Video Calls Card ─── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Feather name="phone-call" size={18} color={theme.primary} />
              <Text style={[styles.cardSectionTitle, { color: theme.onSurface }]}>Voice & Video Calls</Text>
            </View>
          </View>

          {/* Call Ringtones Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Call Ringtone</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Play ringtone when receiving incoming voice or video calls
              </Text>
            </View>
            <Switch
              value={preferences.callRingtone}
              onValueChange={(val) => {
                updatePreferences({ callRingtone: val });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Call Vibration Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: theme.onSurface }]}>Call Vibration</Text>
              <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>
                Vibrate continuously during incoming WebRTC call alerts
              </Text>
            </View>
            <Switch
              value={preferences.callVibration}
              onValueChange={(val) => {
                updatePreferences({ callVibration: val });
              }}
              trackColor={{ false: theme.divider, true: theme.primary }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
            />
          </View>
        </View>

        {/* ─── Reset to Defaults Button ─── */}
        <Pressable
          style={({ pressed }) => [
            styles.resetButton,
            { backgroundColor: theme.card, borderColor: theme.cardBorder },
            pressed && styles.buttonPressed,
          ]}
          onPress={handleResetDefaultsPrompt}
        >
          <Feather name="rotate-ccw" size={16} color={theme.primary} />
          <Text style={[styles.resetButtonText, { color: theme.onSurface }]}>
            Reset to Defaults
          </Text>
        </Pressable>
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
  toneSelectorContainer: {
    gap: 8,
    marginTop: 2,
  },
  toneHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toneSectionLabel: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Bold',
    letterSpacing: 0.5,
  },
  toneList: {
    gap: 8,
  },
  toneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  toneLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  toneTextContainer: {
    flex: 1,
  },
  toneTitle: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  toneDescription: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 1,
  },
  previewPlayButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  resetButtonText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
});
