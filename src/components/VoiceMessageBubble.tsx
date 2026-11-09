import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useTheme } from '../context/ThemeContext';
import { getPlayableAudioUrl } from '../utils/audio';

export interface VoiceMessageBubbleProps {
  audioUrl: string;
  isOutgoing: boolean;
  durationSec?: number;
}

const SPEED_OPTIONS = [1, 1.5, 2];

function applyPlaybackRate(audioPlayer: any, rate: number): void {
  if (!audioPlayer) return;
  try {
    if (typeof audioPlayer.setPlaybackRate === 'function') {
      audioPlayer.setPlaybackRate(rate);
    } else if ('playbackRate' in audioPlayer) {
      audioPlayer.playbackRate = rate;
    }
  } catch (err) {
    console.warn('[VoiceMessageBubble] Error applying playback rate:', err);
  }
}

export const VoiceMessageBubble: React.FC<VoiceMessageBubbleProps> = ({
  audioUrl,
  isOutgoing,
  durationSec,
}) => {
  const { theme } = useTheme();
  const playableUrl = getPlayableAudioUrl(audioUrl);
  const player = useAudioPlayer(playableUrl);
  const status = useAudioPlayerStatus(player);
  const [speedIndex, setSpeedIndex] = useState(0);

  useEffect(() => {
    // Ensure audio plays properly through speakers in silent mode
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
    }).catch(() => {});
  }, []);

  const isPlaying = status.playing;
  const currentTime = status.currentTime || 0;
  // Use duration from player status or fallback to prop
  const totalDuration = status.duration > 0 ? status.duration : durationSec || 0;

  const togglePlayPause = async () => {
    if (!player) return;
    try {
      if (isPlaying) {
        player.pause();
      } else {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        }).catch(() => {});
        if (currentTime >= totalDuration && totalDuration > 0) {
          player.seekTo(0);
        }
        player.play();
      }
    } catch (err) {
      console.warn('[VoiceMessageBubble] Error toggling play/pause:', err);
    }
  };

  useEffect(() => {
    applyPlaybackRate(player, SPEED_OPTIONS[speedIndex]);
  }, [player, speedIndex]);

  const handleSpeedToggle = () => {
    setSpeedIndex((prev) => (prev + 1) % SPEED_OPTIONS.length);
  };

  const handleSeek = (progressRatio: number) => {
    if (!player || totalDuration <= 0) return;
    const targetSeconds = Math.max(0, Math.min(totalDuration, progressRatio * totalDuration));
    player.seekTo(targetSeconds);
  };

  const formatTime = (seconds: number) => {
    const rounded = Math.floor(seconds);
    const mins = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const progressPercent =
    totalDuration > 0 ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100)) : 0;

  // Waveform bars simulation
  const WAVE_BARS = [0.3, 0.7, 0.4, 0.9, 0.6, 1.0, 0.5, 0.8, 0.35, 0.75, 0.45, 0.95, 0.55, 0.3];

  return (
    <View style={styles.container}>
      {/* Play / Pause Action Button */}
      <Pressable
        onPress={togglePlayPause}
        style={({ pressed }) => [
          styles.playButton,
          {
            backgroundColor: isOutgoing ? '#FFFFFF' : theme.primary,
          },
          pressed && styles.pressed,
        ]}
        hitSlop={8}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={16}
          color={isOutgoing ? '#6366F1' : '#FFFFFF'}
          style={!isPlaying ? { marginLeft: 2 } : undefined}
        />
      </Pressable>

      {/* Progress & Waveform Section */}
      <View style={styles.trackSection}>
        {/* Interactive progress bar */}
        <Pressable
          style={styles.progressBarWrapper}
          onPress={(e) => {
            const { locationX } = e.nativeEvent;
            // Approximate bar width of 120
            const ratio = Math.max(0, Math.min(1, locationX / 120));
            handleSeek(ratio);
          }}
        >
          <View
            style={[
              styles.progressBarBg,
              { backgroundColor: isOutgoing ? 'rgba(255,255,255,0.28)' : theme.outlineVariant },
            ]}
          >
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${progressPercent}%`,
                  backgroundColor: isOutgoing ? '#FFFFFF' : theme.primary,
                },
              ]}
            />
          </View>
        </Pressable>

        {/* Waveform Visualization Bars */}
        <View style={styles.waveformRow}>
          {WAVE_BARS.map((heightFactor, index) => {
            const barProgress = ((index + 1) / WAVE_BARS.length) * 100;
            const isPlayed = progressPercent >= barProgress;
            return (
              <View
                key={index}
                style={[
                  styles.waveformBar,
                  {
                    height: Math.max(4, heightFactor * 14),
                    backgroundColor: isOutgoing
                      ? isPlayed
                        ? '#FFFFFF'
                        : 'rgba(255,255,255,0.38)'
                      : isPlayed
                      ? theme.primary
                      : theme.outlineVariant,
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Duration / Elapsed Text */}
        <View style={styles.metaRow}>
          <Text
            style={[
              styles.durationText,
              { color: isOutgoing ? 'rgba(255,255,255,0.85)' : theme.onSurfaceVariant },
            ]}
          >
            {formatTime(isPlaying ? currentTime : totalDuration)}
          </Text>
        </View>
      </View>

      {/* Speed Rate Toggle Pill */}
      <Pressable
        onPress={handleSpeedToggle}
        style={({ pressed }) => [
          styles.speedButton,
          {
            backgroundColor: isOutgoing ? 'rgba(255,255,255,0.22)' : theme.surfaceContainerHigh,
            borderColor: isOutgoing ? 'rgba(255,255,255,0.35)' : theme.cardBorder,
          },
          pressed && styles.pressed,
        ]}
        hitSlop={6}
      >
        <Text
          style={[
            styles.speedText,
            { color: isOutgoing ? '#FFFFFF' : theme.onSurface },
          ]}
        >
          {SPEED_OPTIONS[speedIndex]}x
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 4,
    minWidth: 210,
    maxWidth: 260,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
    marginRight: 10,
  },
  trackSection: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  progressBarWrapper: {
    height: 12,
    justifyContent: 'center',
  },
  progressBarBg: {
    height: 3.5,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 14,
    gap: 3,
    marginTop: 2,
  },
  waveformBar: {
    width: 2.5,
    borderRadius: 1.5,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  speedButton: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },
});
