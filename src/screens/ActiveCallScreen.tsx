import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCall } from '../context/CallContext';
import { getSafeImageSource } from '../utils/image';

export const ActiveCallScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{
    recipientName?: string;
    recipientImage?: string;
  }>();

  const {
    status,
    callerName,
    callerImage,
    isMuted,
    isSpeaker,
    duration,
    connectionState,
    endCall,
    toggleMute,
    toggleSpeaker,
  } = useCall();

  // Resolved contact info
  const displayName = callerName || params.recipientName || 'Contact';
  const displayImage = callerImage || params.recipientImage || null;

  // Pulse animation for avatar ring
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [pulseOpacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (status === 'outgoing' || connectionState === 'connecting') {
      anim = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.4,
              duration: 1200,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 1200,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(pulseOpacity, {
              toValue: 0.1,
              duration: 1200,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 0.5,
              duration: 1200,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      anim.start();
    } else {
      pulseAnim.setValue(1);
      pulseOpacity.setValue(0.2);
    }
    return () => {
      if (anim) anim.stop();
    };
  }, [status, connectionState, pulseAnim, pulseOpacity]);

  // Navigate back when call ends
  useEffect(() => {
    if (status === 'ended') {
      const timer = setTimeout(() => {
        try {
          router.back();
        } catch {}
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [status, router]);

  const formatDuration = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getStatusLabel = () => {
    if (status === 'ended') return 'Call Ended';
    if (status === 'active') return formatDuration(duration);
    if (status === 'outgoing') return 'Calling...';
    if (connectionState === 'connecting') return 'Connecting...';
    return 'Voice Call';
  };

  return (
    <LinearGradient
      colors={['#0F172A', '#020617', '#0A0E1A']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* Header E2EE indicator */}
        <View style={styles.header}>
          <View style={styles.securityBadge}>
            <Ionicons name="lock-closed" size={13} color="#10B981" />
            <Text style={styles.securityText}>End-to-End Encrypted</Text>
          </View>
        </View>

        {/* Central Contact Details & Avatar */}
        <View style={styles.centerSection}>
          <View style={styles.avatarContainer}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseAnim }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            <Image
              source={getSafeImageSource(displayImage)}
              style={styles.avatar}
              contentFit="cover"
            />
          </View>

          <Text style={styles.contactName} numberOfLines={1}>
            {displayName}
          </Text>

          <Text style={styles.callStatus}>
            {getStatusLabel()}
          </Text>
        </View>

        {/* Bottom Control Actions */}
        <View style={styles.bottomControls}>
          {/* Mute Button */}
          <View style={styles.controlItem}>
            <Pressable
              onPress={toggleMute}
              style={({ pressed }) => [
                styles.controlButton,
                isMuted && styles.controlButtonActive,
                pressed && styles.buttonPressed,
              ]}
              hitSlop={8}
            >
              <Feather
                name={isMuted ? 'mic-off' : 'mic'}
                size={24}
                color={isMuted ? '#EF4444' : '#FFFFFF'}
              />
            </Pressable>
            <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </View>

          {/* End Call Button */}
          <View style={styles.controlItem}>
            <Pressable
              onPress={endCall}
              style={({ pressed }) => [
                styles.endCallButton,
                pressed && styles.buttonPressed,
              ]}
              hitSlop={8}
            >
              <MaterialIcons name="call-end" size={32} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.controlLabel}>End</Text>
          </View>

          {/* Speaker Button */}
          <View style={styles.controlItem}>
            <Pressable
              onPress={toggleSpeaker}
              style={({ pressed }) => [
                styles.controlButton,
                isSpeaker && styles.controlButtonActive,
                pressed && styles.buttonPressed,
              ]}
              hitSlop={8}
            >
              <Ionicons
                name={isSpeaker ? 'volume-high' : 'volume-medium-outline'}
                size={25}
                color={isSpeaker ? '#10B981' : '#FFFFFF'}
              />
            </Pressable>
            <Text style={styles.controlLabel}>Speaker</Text>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  securityText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#6366F1',
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#334155',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  contactName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  callStatus: {
    fontSize: 16,
    fontWeight: '500',
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 24,
  },
  controlItem: {
    alignItems: 'center',
    gap: 8,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  endCallButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  controlLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.94 }],
  },
});
