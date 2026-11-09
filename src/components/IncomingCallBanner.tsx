import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useCall } from '../context/CallContext';
import { useTheme } from '../context/ThemeContext';
import { getSafeImageSource } from '../utils/image';

export const IncomingCallBanner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { status, callerName, callerImage, acceptCall, declineCall } = useCall();

  const [translateY] = useState(() => new Animated.Value(-160));

  const isRinging = status === 'ringing';

  useEffect(() => {
    if (isRinging) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: -160,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [isRinging, translateY]);

  if (!isRinging) return null;

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        {
          paddingTop: Math.max(insets.top, 12),
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.bannerCard,
          {
            backgroundColor: theme.isDark ? '#0F172A' : '#FFFFFF',
            borderColor: theme.cardBorder,
          },
        ]}
      >
        {/* Caller Avatar */}
        <View style={styles.avatarWrapper}>
          <Image
            source={getSafeImageSource(callerImage)}
            style={styles.avatar}
            contentFit="cover"
          />
          <View style={styles.callBadge}>
            <Ionicons name="call" size={10} color="#FFFFFF" />
          </View>
        </View>

        {/* Caller Details */}
        <View style={styles.infoCol}>
          <Text style={[styles.callerName, { color: theme.onSurface }]} numberOfLines={1}>
            {callerName || 'Unknown Caller'}
          </Text>
          <Text style={[styles.callSubtitle, { color: theme.onSurfaceVariant }]}>
            Incoming Voice Call...
          </Text>
        </View>

        {/* Action Buttons: Decline & Accept */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={declineCall}
            style={({ pressed }) => [styles.actionCircle, styles.declineButton, pressed && styles.pressed]}
            hitSlop={6}
            accessibilityLabel="Decline Call"
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>

          <Pressable
            onPress={acceptCall}
            style={({ pressed }) => [styles.actionCircle, styles.acceptButton, pressed && styles.pressed]}
            hitSlop={6}
            accessibilityLabel="Accept Call"
          >
            <Ionicons name="call" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#334155',
  },
  callBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  callerName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  callSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 10,
  },
  actionCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  declineButton: {
    backgroundColor: '#EF4444',
  },
  acceptButton: {
    backgroundColor: '#10B981',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.94 }],
  },
});
