import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
  icon?: keyof typeof Feather.glyphMap;
}

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  icon?: keyof typeof Feather.glyphMap;
}

interface ToastContextType {
  showToast: (message: string, options?: ToastType | ToastOptions) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export interface ToastProps {
  visible: boolean;
  message: string;
  type?: ToastType;
  icon?: keyof typeof Feather.glyphMap;
  onDismiss?: () => void;
}

/**
 * Standalone Toast component for isolated use cases
 */
export const Toast: React.FC<ToastProps> = ({
  visible,
  message,
  type = 'info',
  icon,
  onDismiss,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(-100));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 9,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -100,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, opacity]);

  if (!visible) return null;

  const getIconName = (): keyof typeof Feather.glyphMap => {
    if (icon) return icon;
    switch (type) {
      case 'success':
        return 'check-circle';
      case 'error':
        return 'alert-circle';
      case 'warning':
        return 'alert-triangle';
      default:
        return 'info';
    }
  };

  const getAccentColor = (): string => {
    switch (type) {
      case 'success':
        return '#10B981';
      case 'error':
        return '#EF4444';
      case 'warning':
        return '#F59E0B';
      default:
        return '#6366F1';
    }
  };

  const accentColor = getAccentColor();

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.toastWrapper,
        {
          top: Math.max(insets.top, 16) + 8,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.toastCard,
          {
            backgroundColor: theme.isDark ? '#1E293B' : '#FFFFFF',
            borderColor: theme.cardBorder,
            shadowColor: theme.isDark ? '#000000' : '#0F172A',
          },
          pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        ]}
      >
        <View style={[styles.iconContainer, { backgroundColor: `${accentColor}1A` }]}>
          <Feather name={getIconName()} size={18} color={accentColor} />
        </View>

        <Text
          numberOfLines={2}
          style={[styles.toastText, { color: theme.onSurface }]}
        >
          {message}
        </Text>

        {onDismiss && (
          <View style={styles.closeBtn}>
            <Feather name="x" size={14} color={theme.outline} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [currentToast, setCurrentToast] = useState<ToastState | null>(null);

  const [translateY] = useState(() => new Animated.Value(-120));
  const [opacity] = useState(() => new Animated.Value(0));
  const dismissTimer = useRef<NodeJS.Timeout | null>(null);

  const hideToast = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentToast(null);
    });
  }, [translateY, opacity]);

  const showToast = useCallback(
    (message: string, options?: ToastType | ToastOptions) => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }

      let type: ToastType = 'info';
      let duration = 3000;
      let icon: keyof typeof Feather.glyphMap | undefined;

      if (typeof options === 'string') {
        type = options;
      } else if (options && typeof options === 'object') {
        if (options.type) type = options.type;
        if (options.duration) duration = options.duration;
        if (options.icon) icon = options.icon;
      }

      const newToast: ToastState = {
        id: Date.now(),
        message,
        type,
        duration,
        icon,
      };

      setCurrentToast(newToast);

      translateY.setValue(-120);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 75,
          friction: 9,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      if (duration > 0) {
        dismissTimer.current = setTimeout(() => {
          hideToast();
        }, duration);
      }
    },
    [hideToast, translateY, opacity]
  );

  const getIconName = (type: ToastType, customIcon?: keyof typeof Feather.glyphMap): keyof typeof Feather.glyphMap => {
    if (customIcon) return customIcon;
    switch (type) {
      case 'success':
        return 'check-circle';
      case 'error':
        return 'alert-circle';
      case 'warning':
        return 'alert-triangle';
      default:
        return 'info';
    }
  };

  const getAccentColor = (type: ToastType): string => {
    switch (type) {
      case 'success':
        return '#10B981';
      case 'error':
        return '#EF4444';
      case 'warning':
        return '#F59E0B';
      default:
        return '#6366F1';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {currentToast && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.toastWrapper,
            {
              top: Math.max(insets.top, 16) + 8,
              transform: [{ translateY }],
              opacity,
            },
          ]}
        >
          <Pressable
            onPress={hideToast}
            style={({ pressed }) => [
              styles.toastCard,
              {
                backgroundColor: theme.isDark ? '#1E293B' : '#FFFFFF',
                borderColor: theme.cardBorder,
                shadowColor: theme.isDark ? '#000000' : '#0F172A',
              },
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: `${getAccentColor(currentToast.type)}1A` },
              ]}
            >
              <Feather
                name={getIconName(currentToast.type, currentToast.icon)}
                size={18}
                color={getAccentColor(currentToast.type)}
              />
            </View>

            <Text
              numberOfLines={2}
              style={[styles.toastText, { color: theme.onSurface }]}
            >
              {currentToast.message}
            </Text>

            <View style={styles.closeBtn}>
              <Feather name="x" size={14} color={theme.outline} />
            </View>
          </Pressable>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  toastWrapper: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 999999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    minHeight: 50,
    maxWidth: 480,
    width: '100%',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)',
      },
    }),
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  toastText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium',
    lineHeight: 19,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
});
