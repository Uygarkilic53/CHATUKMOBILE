import { Platform, Vibration } from 'react-native';
import { Asset } from 'expo-asset';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { appStorage } from '../lib/storage';

export type SenderToneId = 'sending1' | 'sending2' | 'sending3' | 'silent';
export type ReceiverToneId = 'default' | 'silent';

export interface SoundPreset<T = string> {
  id: T;
  title: string;
  subtitle: string;
  assetSource: any;
}

export const SENDER_TONES: SoundPreset<SenderToneId>[] = [
  {
    id: 'sending1',
    title: 'Sending Tone 1',
    subtitle: 'Classic sending chime (sending1.wav)',
    assetSource: require('../../assets/sound/sending1.wav'),
  },
  {
    id: 'sending2',
    title: 'Sending Tone 2',
    subtitle: 'Subtle notification pop (sending2.mp3)',
    assetSource: require('../../assets/sound/sending2.mp3'),
  },
  {
    id: 'sending3',
    title: 'Sending Tone 3',
    subtitle: 'Gentle tap tone (sensing3.mp3)',
    assetSource: require('../../assets/sound/sensing3.mp3'),
  },
  {
    id: 'silent',
    title: 'Silent',
    subtitle: 'No sound when sending messages',
    assetSource: null,
  },
];

export const RECEIVER_TONES: SoundPreset<ReceiverToneId>[] = [
  {
    id: 'default',
    title: 'Notification Sound',
    subtitle: 'Default incoming message alert (notification.mp3)',
    assetSource: require('../../assets/sound/notification.mp3'),
  },
  {
    id: 'silent',
    title: 'Silent',
    subtitle: 'No sound when receiving messages',
    assetSource: null,
  },
];

class SoundService {
  private isConfigured = false;
  private preloadedAssets = false;
  private playerCache = new Map<string, any>();
  private playedReceiverMessageIds = new Set<string>();
  private playedSenderMessageIds = new Set<string>();
  private lastReceiverSoundTime = 0;
  private lastSenderSoundTime = 0;

  private async ensureAudioMode() {
    if (this.isConfigured) return;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      });
      this.isConfigured = true;
    } catch (err) {
      console.warn('[SoundService] Could not set audio mode:', err);
    }
  }

  /**
   * Preload audio assets into device cache so native AVPlayer / MediaPlayer
   * can load local file:/// URIs instantly with 0ms latency.
   */
  async preloadAssets(): Promise<void> {
    if (this.preloadedAssets || Platform.OS === 'web') return;
    try {
      const sources = [
        ...SENDER_TONES.map((t) => t.assetSource).filter(Boolean),
        ...RECEIVER_TONES.map((t) => t.assetSource).filter(Boolean),
      ];
      await Asset.loadAsync(sources);
      this.preloadedAssets = true;
    } catch (err) {
      console.warn('[SoundService] Error preloading sound assets:', err);
    }
  }

  private async getResolvedSource(source: any): Promise<any> {
    if (!source || Platform.OS === 'web' || typeof source !== 'number') {
      return source;
    }
    try {
      const asset = Asset.fromModule(source);
      if (!asset.localUri) {
        await asset.downloadAsync().catch(() => {});
      }
      return asset.localUri ? { uri: asset.localUri } : source;
    } catch (err) {
      console.warn('[SoundService] Error resolving asset source:', err);
      return source;
    }
  }

  private async getOrCreatePlayer(key: string, source: any): Promise<any> {
    if (!source) return null;
    let player = this.playerCache.get(key);
    if (!player) {
      try {
        const resolved = await this.getResolvedSource(source);
        player = createAudioPlayer(resolved);
        this.playerCache.set(key, player);
      } catch (err) {
        console.warn('[SoundService] Error creating player for key', key, err);
      }
    } else {
      try {
        if (typeof player.seekTo === 'function') {
          await player.seekTo(0).catch(() => {});
        }
      } catch {}
    }
    return player;
  }

  private getPreferences(): Record<string, any> {
    try {
      const raw = appStorage.getItem('chatuk_user_preferences');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  }

  /**
   * Play sender sound with optional deduplication key (e.g. clientMessageId)
   */
  async playSenderSoundForMessage(clientMessageId?: string, toneOverride?: SenderToneId): Promise<void> {
    if (clientMessageId) {
      if (this.playedSenderMessageIds.has(clientMessageId)) {
        return; // Already played for this confirmed message!
      }
      this.playedSenderMessageIds.add(clientMessageId);
      if (this.playedSenderMessageIds.size > 200) {
        const first = this.playedSenderMessageIds.values().next().value;
        if (first) this.playedSenderMessageIds.delete(first);
      }
    }

    const now = Date.now();
    // 300ms cooldown to prevent multi-confirmation stutter
    if (now - this.lastSenderSoundTime < 300) {
      return;
    }
    this.lastSenderSoundTime = now;

    await this.playSenderSound(toneOverride);
  }

  /**
   * Play sender sound (when user previews tone or sends message)
   */
  async playSenderSound(toneOverride?: SenderToneId): Promise<void> {
    const prefs = this.getPreferences();

    if (toneOverride === undefined) {
      if (prefs.inAppSounds === false || prefs.sentMessageSound === false) {
        return;
      }
    }

    const selectedTone: SenderToneId = toneOverride || prefs.senderTone || 'sending1';
    if (selectedTone === 'silent') {
      return;
    }

    const preset = SENDER_TONES.find((t) => t.id === selectedTone);
    if (!preset || !preset.assetSource) return;

    try {
      await this.ensureAudioMode();
      const player = await this.getOrCreatePlayer(preset.id, preset.assetSource);
      if (player) {
        player.play();
      }
    } catch (err) {
      console.warn('[SoundService] Error playing sender tone:', err);
    }
  }

  /**
   * Play receiver sound with strict message deduplication & debounce
   */
  async playReceiverSoundForMessage(messageId?: string, toneOverride?: ReceiverToneId): Promise<void> {
    if (messageId) {
      if (this.playedReceiverMessageIds.has(messageId)) {
        return; // Already played for this message!
      }
      this.playedReceiverMessageIds.add(messageId);
      if (this.playedReceiverMessageIds.size > 200) {
        const first = this.playedReceiverMessageIds.values().next().value;
        if (first) this.playedReceiverMessageIds.delete(first);
      }
    }

    const now = Date.now();
    // 500ms cooldown: guarantees receiver sound never fires multiple times in quick succession
    if (now - this.lastReceiverSoundTime < 500) {
      return;
    }
    this.lastReceiverSoundTime = now;

    await this.playReceiverSound(toneOverride);
  }

  /**
   * Play receiver sound (when user previews tone or message arrives)
   */
  async playReceiverSound(toneOverride?: ReceiverToneId): Promise<void> {
    const prefs = this.getPreferences();

    if (toneOverride === undefined) {
      if (prefs.inAppSounds === false) {
        return;
      }
    }

    const selectedTone: ReceiverToneId = toneOverride || prefs.receiverTone || 'default';

    // Trigger vibration if enabled
    if (prefs.vibration !== false) {
      try {
        Vibration.vibrate(100);
      } catch {}
    }

    if (selectedTone === 'silent') {
      return;
    }

    const preset = RECEIVER_TONES.find((t) => t.id === selectedTone);
    if (!preset || !preset.assetSource) return;

    try {
      await this.ensureAudioMode();
      const player = await this.getOrCreatePlayer(preset.id, preset.assetSource);
      if (player) {
        player.play();
      }
    } catch (err) {
      console.warn('[SoundService] Error playing receiver tone:', err);
    }
  }
}

export const soundService = new SoundService();
