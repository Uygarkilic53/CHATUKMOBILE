import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Vibration,
  Pressable,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
import { useTheme } from '../context/ThemeContext';
import { useToast } from './Toast';

export interface VoiceRecordButtonProps {
  onRecordingComplete: (audioUri: string, durationSec: number) => void;
  disabled?: boolean;
}

const CANCEL_DISTANCE = -90; // Pixels dragged left to trigger cancellation
const MAX_RECORDING_SECONDS = 60;

export const VoiceRecordButton: React.FC<VoiceRecordButtonProps> = ({
  onRecordingComplete,
  disabled = false,
}) => {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const recordSeconds = Math.floor(recorderState.durationMillis / 1000);

  // Animated values using useState initializer for React 19 compiler compliance
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [slideAnim] = useState(() => new Animated.Value(0));
  const [micScaleAnim] = useState(() => new Animated.Value(1));

  const cleanupState = useCallback(() => {
    setIsRecording(false);
    setIsCancelled(false);
    slideAnim.setValue(0);
    micScaleAnim.setValue(1);
  }, [micScaleAnim, slideAnim]);

  const finishRecording = useCallback(
    async (cancelled: boolean) => {
      Animated.parallel([
        Animated.spring(micScaleAnim, { toValue: 1, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }),
      ]).start();

      setIsRecording(false);
      setIsCancelled(false);

      // Only attempt to stop if audio recorder is actively recording
      const isActuallyRecording = audioRecorder.isRecording || recorderState.isRecording;
      if (!isActuallyRecording) {
        return;
      }

      try {
        const durationMillis = recorderState.durationMillis;
        await audioRecorder.stop();
        const uri = audioRecorder.uri;
        const elapsed = Math.max(1, Math.round(durationMillis / 1000));

        if (!cancelled && uri && elapsed >= 1) {
          onRecordingComplete(uri, elapsed);
        } else {
          try {
            Vibration.vibrate([0, 25, 50, 25]);
          } catch {}
        }
      } catch (err) {
        console.warn('[VoiceRecordButton] Error stopping recording:', err);
      }
    },
    [audioRecorder, micScaleAnim, onRecordingComplete, recorderState.durationMillis, recorderState.isRecording, slideAnim]
  );

  const startRecording = useCallback(async () => {
    try {
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted) {
        perm = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!perm.granted) {
        showToast('Microphone permission is required to record voice messages', 'error');
        cleanupState();
        return;
      }

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();

      setIsCancelled(false);
      setIsRecording(true);

      try {
        Vibration.vibrate(35);
      } catch {}

      Animated.spring(micScaleAnim, {
        toValue: 1.25,
        useNativeDriver: true,
        friction: 5,
      }).start();
    } catch (err) {
      console.warn('[VoiceRecordButton] Failed to start recording:', err);
      cleanupState();
    }
  }, [audioRecorder, cleanupState, micScaleAnim, showToast]);

  // Red pulse animation while recording
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (isRecording) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.35,
            duration: 650,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => {
      if (loop) loop.stop();
    };
  }, [isRecording, pulseAnim]);

  // Handle max duration auto-stop via timeout
  useEffect(() => {
    if (!isRecording) return;
    const timeout = setTimeout(() => {
      finishRecording(false);
    }, MAX_RECORDING_SECONDS * 1000);

    return () => {
      clearTimeout(timeout);
    };
  }, [isRecording, finishRecording]);

  // PanResponder to track swipe left for cancellation and click to send/stop
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          if (disabled) return;
          if (isRecording) {
            // Tapping the red button while recording stops and sends
            finishRecording(false);
          } else {
            startRecording();
          }
        },
        onPanResponderMove: (_, gestureState) => {
          // Only allow sliding to the left
          const dx = Math.min(0, gestureState.dx);
          slideAnim.setValue(dx);

          if (dx < CANCEL_DISTANCE) {
            setIsCancelled(true);
            try {
              Vibration.vibrate(50);
            } catch {}
          } else {
            setIsCancelled(false);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          const cancelled = gestureState.dx < CANCEL_DISTANCE;
          if (cancelled) {
            finishRecording(true);
          }
        },
        onPanResponderTerminate: () => {
          finishRecording(true);
        },
      }),
    [disabled, finishRecording, isRecording, slideAnim, startRecording]
  );

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <View style={styles.container}>
      {/* Active Recording Overlay with timer and cancel prompt */}
      {isRecording && (
        <View style={[styles.recordingOverlay, { backgroundColor: theme.card }]}>
          <Animated.View
            style={[
              styles.pulseDot,
              {
                backgroundColor: isCancelled ? theme.error : '#EF4444',
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <Text style={[styles.timerText, { color: theme.onSurface }]}>
            {formatTimer(recordSeconds)}
          </Text>

          <Pressable
            hitSlop={8}
            onPress={() => finishRecording(true)}
            style={styles.cancelHintContainer}
          >
            <Feather
              name="trash-2"
              size={14}
              color={isCancelled ? theme.error : theme.onSurfaceVariant}
            />
            <Text
              style={[
                styles.cancelText,
                { color: isCancelled ? theme.error : theme.onSurfaceVariant },
              ]}
            >
              {isCancelled ? 'Release to cancel' : 'Cancel'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Mic Button with horizontal slide tracking */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.micButtonWrapper,
          {
            transform: [
              { translateX: slideAnim },
              { scale: micScaleAnim },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.micButton,
            {
              backgroundColor: isRecording
                ? isCancelled
                  ? theme.error
                  : '#EF4444'
                : theme.primary,
            },
            disabled && styles.disabledButton,
          ]}
        >
          {isRecording ? (
            <Ionicons name="send" size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />
          ) : (
            <Feather name="mic" size={19} color="#FFFFFF" />
          )}
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  recordingOverlay: {
    position: 'absolute',
    right: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  pulseDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 8,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginRight: 12,
  },
  cancelHintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 2,
  },
  micButtonWrapper: {
    zIndex: 10,
  },
  micButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  disabledButton: {
    opacity: 0.4,
  },
});
