import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  ViewStyle,
  StyleProp,
  Platform,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import lottieSource from '../../assets/animations/loading-bar.json';

export interface LoadingIndicatorProps {
  /**
   * The animation display mode:
   * - 'lottie': Renders the exact LottieFiles vector animation using LottieView
   * - 'bar': 60FPS Native Animated gradient sweep matching the Valentina Horváth design
   * - 'spinner': Circular rotating gradient ring with the same violet-indigo aesthetic
   */
  variant?: 'lottie' | 'bar' | 'spinner';
  
  /** Width of the loader bar (number or percentage string, e.g. 240 or '100%') */
  width?: number | string;
  
  /** Height / thickness of the loader bar (default: 8) */
  height?: number;
  
  /** Corner radius (default: 999 for full pill shape) */
  borderRadius?: number;
  
  /** Track background color (default: #e2e8f0 in light mode, #334155 in dark mode) */
  trackColor?: string;
  
  /** Gradient colors for the indicator (default: violet-to-indigo brand palette) */
  gradientColors?: [string, string, ...string[]];
  
  /** Duration of one animation cycle in milliseconds (default: 1600ms) */
  duration?: number;
  
  /** Optional loading text displayed beneath or next to the loader */
  label?: string;
  
  /** If true, renders as a full-screen overlay/modal with darkened backdrop */
  overlay?: boolean;
  
  /** Custom container style */
  style?: StyleProp<ViewStyle>;
}

/**
 * Pure 60FPS Native Animated Linear Bar
 * Faithful native reproduction of Valentina Horváth's LottieFiles design:
 * - Rounded pill track
 * - Gradient bar sweeping smoothly left-to-right
 * - Ease-in-out velocity with opacity fade-in/fade-out at edges
 */
const AnimatedBar = ({
  width = 240,
  height = 8,
  borderRadius = 999,
  trackColor = '#e2e8f0',
  gradientColors = ['#8268ff', '#6366f1', '#4f46e5'],
  duration = 1600,
}: Omit<LoadingIndicatorProps, 'variant' | 'overlay' | 'label'>) => {
  const [animValue] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(animValue, {
        toValue: 1,
        duration,
        easing: Easing.bezier(0.42, 0, 0.58, 1),
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [animValue, duration]);

  const numericWidth = typeof width === 'number' ? width : 240;
  const indicatorWidth = Math.min(140, Math.max(28, Math.round(numericWidth * 0.45)));
  const midX = Math.round((numericWidth - indicatorWidth) / 2);

  // Indicator slides smoothly across the track
  const translateX = animValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [-indicatorWidth, midX, numericWidth + 10],
  });

  const opacity = animValue.interpolate({
    inputRange: [0, 0.15, 0.5, 0.85, 1],
    outputRange: [0, 1, 1, 1, 0],
  });

  const scaleX = animValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.75, 1.15, 0.75],
  });

  return (
    <View
      style={[
        styles.barTrack,
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: trackColor,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.barIndicatorWrapper,
          {
            width: indicatorWidth,
            height,
            borderRadius,
            opacity,
            transform: [{ translateX }, { scaleX }],
          },
        ]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.gradientFill, { borderRadius }]}
        />
      </Animated.View>
    </View>
  );
};

/**
 * Lottie Player Variant
 * Directly executes the exact vector Lottie animation from LottieFiles
 */
const LottieBar = ({
  width = 280,
  height = 16,
  style,
}: {
  width?: number | string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) => {
  if (Platform.OS === 'web') {
    return (
      <AnimatedBar
        width={width}
        height={height}
        trackColor="#e2e8f0"
        gradientColors={['#8268ff', '#6366f1', '#4f46e5']}
        duration={1600}
        style={style}
      />
    );
  }

  return (
    <View style={[{ width: width as any, height, overflow: 'hidden' }, style]}>
      <LottieView
        source={lottieSource}
        autoPlay
        loop
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
      />
    </View>
  );
};

/**
 * Circular Spinner Variant
 * Complements the linear loader with a matching violet-indigo glowing ring
 */
const CircularSpinner = ({
  size = 36,
  gradientColors = ['#8268ff', '#4f46e5'],
}: {
  size?: number;
  gradientColors?: [string, string, ...string[]];
}) => {
  const [rotateAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        styles.spinnerContainer,
        {
          width: size,
          height: size,
          transform: [{ rotate: spin }],
        },
      ]}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.spinnerCircle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: Math.max(3, Math.round(size / 9)),
            borderColor: 'transparent',
            borderTopColor: gradientColors[0],
            borderRightColor: gradientColors[1] || gradientColors[0],
          },
        ]}
      />
    </Animated.View>
  );
};

/**
 * Main LoadingIndicator Component
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  variant = 'bar',
  width = 240,
  height = 8,
  borderRadius = 999,
  trackColor = '#e2e8f0',
  gradientColors = ['#8268ff', '#6366f1', '#4f46e5'],
  duration = 1600,
  label,
  overlay = false,
  style,
}) => {
  const renderLoader = () => {
    switch (variant) {
      case 'lottie':
        return <LottieBar width={width} height={height} style={style} />;
      case 'spinner':
        return <CircularSpinner size={typeof width === 'number' ? Math.min(width, 44) : 40} gradientColors={gradientColors} />;
      case 'bar':
      default:
        return (
          <AnimatedBar
            width={width}
            height={height}
            borderRadius={borderRadius}
            trackColor={trackColor}
            gradientColors={gradientColors}
            duration={duration}
            style={style}
          />
        );
    }
  };

  const content = (
    <View style={[styles.centerContainer, style]}>
      {renderLoader()}
      {label ? <Text style={styles.labelText}>{label}</Text> : null}
    </View>
  );

  if (overlay) {
    return (
      <Modal transparent animationType="fade" visible>
        <View style={styles.overlayBackdrop}>
          <View style={styles.overlayCard}>
            {content}
          </View>
        </View>
      </Modal>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTrack: {
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  barIndicatorWrapper: {
    width: 140,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  gradientFill: {
    width: '100%',
    height: '100%',
  },
  spinnerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerCircle: {
    backgroundColor: 'transparent',
  },
  labelText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
    color: '#475569',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
    minWidth: 220,
  },
});

export default LoadingIndicator;
