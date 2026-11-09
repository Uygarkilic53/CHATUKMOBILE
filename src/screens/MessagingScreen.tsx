import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Modal,
  Alert,
  Keyboard,
  useWindowDimensions,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useCall } from '../context/CallContext';
import { useWallpaper } from '../context/WallpaperContext';
import { getAutoDownloadPreference } from '../utils/storageDiagnostics';
import { useSession } from '../lib/auth-client';
import { api, getActiveUserId, getActiveUserIdSync, getActiveUserEmailSync } from '../lib/api';
import { appStorage } from '../lib/storage';
import { socketService, SocketMessage, MessageReaction } from '../services/socket';
import { EmojiPicker } from '../components/EmojiPicker';
import SecurityCodeModal from '../components/SecurityCodeModal';
import { MessageInfoModal } from '../components/MessageInfoModal';
import { useToast } from '../components/Toast';
import { MessageBubble } from '../components/MessageBubble';
import { VoiceRecordButton } from '../components/VoiceRecordButton';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useVideoPlayer, VideoView } from 'expo-video';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { soundService } from '../services/soundService';

import {
  registerCurrentDevice,
  sendEncryptedMessage,
  processIncomingMessage,
  loadConversationMessages,
} from '../e2ee/messageService';
import { getStoredDeviceKeys } from '../e2ee/keyStore';
import {
  StoredMessage,
  getConversationMessages,
  deleteLocalConversation,
  updateLocalMessageReactions,
  deleteLocalMessage,
  updateLocalMessageDeliveryStatus,
  getLocalMessage,
  saveLocalMessage,
} from '../e2ee/localDb';
import { getSafeImageSource, isValidImageUri } from '../utils/image';
import { sortMessagesChronologically } from '../utils/messageOrder';
import { getPlayableAudioUrl } from '../utils/audio';

const isNativeVideoAvailable = (() => {
  try {
    return !!requireOptionalNativeModule('ExpoVideo');
  } catch {
    return false;
  }
})();

interface Participant {
  _id: string;
  name: string;
  email: string;
  image: string | null;
  isOnline?: boolean;
  lastActiveAt?: string | null;
}

interface ConversationData {
  _id: string;
  type: string;
  name?: string | null;
  description?: string | null;
  adminIds?: string[];
  groupAvatarUrl?: string | null;
  groupAvatarPublicId?: string | null;
  status?: 'pending' | 'accepted';
  initiatorId?: string | null;
  participants: Participant[];
  lastMessage: any;
  isBlocked?: boolean;
  isBlockedBy?: boolean;
  createdAt: string;
  updatedAt: string;
}

const QUICK_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢', '🙏'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const getCurrentTimestamp = (): number => {
  return Date.now();
};

export interface InitialRecipientData {
  _id: string;
  name?: string;
  email?: string;
  image?: string | null;
}

const VideoPlayerContent: React.FC<{ videoUrl: string; onClose: () => void }> = ({
  videoUrl,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const player = useVideoPlayer(videoUrl, (p) => {
    p.play();
  });

  const [translateY] = useState(() => new Animated.Value(0));
  const [bgOpacity] = useState(() => new Animated.Value(1));
  const [mediaScale] = useState(() => new Animated.Value(1));
  const [controlsOpacity] = useState(() => new Animated.Value(1));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return gestureState.dy > 12 && gestureState.dy > Math.abs(gestureState.dx) * 1.5;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          return gestureState.dy > 12 && gestureState.dy > Math.abs(gestureState.dx) * 1.5;
        },
        onPanResponderGrant: () => {
          translateY.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          const dy = gestureState.dy;
          if (dy > 0) {
            translateY.setValue(dy);
            const scaleVal = Math.max(0.8, 1 - (dy / 400) * 0.2);
            mediaScale.setValue(scaleVal);
            const opacityVal = Math.max(0, 1 - (dy / 300) * 0.9);
            bgOpacity.setValue(opacityVal);
            const ctrlVal = Math.max(0, 1 - dy / 60);
            controlsOpacity.setValue(ctrlVal);
          } else {
            translateY.setValue(dy * 0.2);
            mediaScale.setValue(1);
            bgOpacity.setValue(1);
            controlsOpacity.setValue(1);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dy, vy } = gestureState;
          if (dy > 90 || (dy > 30 && vy > 0.6)) {
            Animated.parallel([
              Animated.timing(translateY, {
                toValue: screenHeight,
                duration: 220,
                useNativeDriver: true,
              }),
              Animated.timing(bgOpacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(controlsOpacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
              }),
            ]).start(() => {
              onClose();
            });
          } else {
            Animated.parallel([
              Animated.spring(translateY, {
                toValue: 0,
                friction: 8,
                tension: 50,
                useNativeDriver: true,
              }),
              Animated.spring(mediaScale, {
                toValue: 1,
                friction: 8,
                tension: 50,
                useNativeDriver: true,
              }),
              Animated.timing(bgOpacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
              }),
              Animated.timing(controlsOpacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
              }),
            ]).start();
          }
        },
      }),
    [screenHeight, onClose, translateY, mediaScale, bgOpacity, controlsOpacity]
  );

  return (
    <View style={styles.fullScreenMediaBackdrop} {...panResponder.panHandlers}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: '#000000', opacity: bgOpacity },
        ]}
      />
      <Animated.View
        style={[
          styles.fullScreenHeaderBar,
          { top: Math.max(insets.top, 16), opacity: controlsOpacity },
        ]}
      >
        <Pressable onPress={onClose} style={styles.fullScreenCloseBtn} hitSlop={12}>
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
      <Animated.View
        style={{
          flex: 1,
          width: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          transform: [{ translateY }, { scale: mediaScale }],
        }}
      >
        {isNativeVideoAvailable ? (
          <VideoView
            player={player}
            style={styles.fullScreenVideoView}
            nativeControls
            contentFit="contain"
          />
        ) : (
          <View style={styles.expoGoVideoBanner}>
            <Feather name="video-off" size={36} color="#94A3B8" />
            <Text style={styles.expoGoVideoTitle}>Video Unavailable in Expo Go</Text>
            <Text style={styles.expoGoVideoSubtitle}>
              Video playback requires a development build.
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const VideoPlayerModal: React.FC<{
  videoUrl: string | null;
  onClose: () => void;
}> = ({ videoUrl, onClose }) => {
  if (!videoUrl) return null;
  return (
    <Modal
      visible={!!videoUrl}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <VideoPlayerContent videoUrl={videoUrl} onClose={onClose} />
    </Modal>
  );
};

export interface GalleryMediaItem {
  id: string;
  url: string;
  senderName?: string;
  createdAt?: string;
}

const ImageViewerModal: React.FC<{
  images: GalleryMediaItem[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}> = ({ images, initialIndex, visible, onClose }) => {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList<GalleryMediaItem>>(null);

  const [translateY] = useState(() => new Animated.Value(0));
  const [bgOpacity] = useState(() => new Animated.Value(1));
  const [mediaScale] = useState(() => new Animated.Value(1));
  const [controlsOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
      bgOpacity.setValue(1);
      mediaScale.setValue(1);
      controlsOpacity.setValue(1);
      const timer = setTimeout(() => {
        setCurrentIndex(initialIndex);
        try {
          flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
        } catch { }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [visible, initialIndex, translateY, bgOpacity, mediaScale, controlsOpacity]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Downward drag dominates horizontal swipe
          return gestureState.dy > 12 && gestureState.dy > Math.abs(gestureState.dx) * 1.5;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          return gestureState.dy > 12 && gestureState.dy > Math.abs(gestureState.dx) * 1.5;
        },
        onPanResponderGrant: () => {
          translateY.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          const dy = gestureState.dy;
          if (dy > 0) {
            translateY.setValue(dy);
            const scaleVal = Math.max(0.8, 1 - (dy / 400) * 0.2);
            mediaScale.setValue(scaleVal);
            const opacityVal = Math.max(0, 1 - (dy / 300) * 0.9);
            bgOpacity.setValue(opacityVal);
            const ctrlVal = Math.max(0, 1 - dy / 60);
            controlsOpacity.setValue(ctrlVal);
          } else {
            translateY.setValue(dy * 0.2);
            mediaScale.setValue(1);
            bgOpacity.setValue(1);
            controlsOpacity.setValue(1);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dy, vy } = gestureState;
          if (dy > 90 || (dy > 30 && vy > 0.6)) {
            Animated.parallel([
              Animated.timing(translateY, {
                toValue: screenHeight,
                duration: 220,
                useNativeDriver: true,
              }),
              Animated.timing(bgOpacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(controlsOpacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
              }),
            ]).start(() => {
              onClose();
            });
          } else {
            Animated.parallel([
              Animated.spring(translateY, {
                toValue: 0,
                friction: 8,
                tension: 50,
                useNativeDriver: true,
              }),
              Animated.spring(mediaScale, {
                toValue: 1,
                friction: 8,
                tension: 50,
                useNativeDriver: true,
              }),
              Animated.timing(bgOpacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
              }),
              Animated.timing(controlsOpacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
              }),
            ]).start();
          }
        },
      }),
    [screenHeight, onClose, translateY, mediaScale, bgOpacity, controlsOpacity]
  );

  if (!visible || images.length === 0) return null;

  const currentItem = images[currentIndex] || images[0];

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIdx = Math.round(offsetX / screenWidth);
    if (nextIdx >= 0 && nextIdx < images.length && nextIdx !== currentIndex) {
      setCurrentIndex(nextIdx);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      flatListRef.current?.scrollToIndex({ index: currentIndex - 1, animated: true });
    }
  };

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.fullScreenMediaBackdrop} {...panResponder.panHandlers}>
        {/* Animated dark backdrop that fades as user drags down */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: '#000000', opacity: bgOpacity },
          ]}
        />

        {/* Top Header Bar */}
        <Animated.View
          style={[
            styles.fullScreenHeaderBar,
            { top: Math.max(insets.top, 16), opacity: controlsOpacity },
          ]}
        >
          <View style={styles.galleryMetaInfo}>
            {currentItem?.senderName ? (
              <Text style={styles.gallerySenderText} numberOfLines={1}>
                {currentItem.senderName}
              </Text>
            ) : null}
            {images.length > 1 && (
              <Text style={styles.galleryCounterText}>
                {currentIndex + 1} of {images.length}
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} style={styles.fullScreenCloseBtn} hitSlop={14}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </Animated.View>

        {/* Horizontal Swipable Image List */}
        <Animated.View
          style={{
            flex: 1,
            width: '100%',
            transform: [{ translateY }, { scale: mediaScale }],
          }}
        >
          <FlatList
            ref={flatListRef}
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            initialNumToRender={images.length}
            keyExtractor={(item, index) => item.id || `${item.url}_${index}`}
            getItemLayout={(_, index) => ({
              length: screenWidth,
              offset: screenWidth * index,
              index,
            })}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
              }, 60);
            }}
            onMomentumScrollEnd={handleScroll}
            renderItem={({ item }) => (
              <View
                style={{
                  width: screenWidth,
                  height: screenHeight,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Image
                  source={getSafeImageSource(item.url)}
                  style={styles.fullScreenImageView}
                  contentFit="contain"
                  transition={150}
                />
              </View>
            )}
          />
        </Animated.View>

        {/* Previous Chevron Button (when multiple images) */}
        {images.length > 1 && currentIndex > 0 && (
          <Animated.View
            style={[
              styles.galleryNavArrow,
              { left: 16, opacity: controlsOpacity },
            ]}
          >
            <Pressable onPress={handlePrev} hitSlop={12} style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        )}

        {/* Next Chevron Button (when multiple images) */}
        {images.length > 1 && currentIndex < images.length - 1 && (
          <Animated.View
            style={[
              styles.galleryNavArrow,
              { right: 16, opacity: controlsOpacity },
            ]}
          >
            <Pressable onPress={handleNext} hitSlop={12} style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        )}

        {/* Bottom Pagination Dots for multi-image collections */}
        {images.length > 1 && images.length <= 10 && (
          <Animated.View
            style={[
              styles.galleryDotsContainer,
              { bottom: Math.max(insets.bottom, 20), opacity: controlsOpacity },
            ]}
          >
            {images.map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.galleryDot,
                  idx === currentIndex ? styles.galleryDotActive : styles.galleryDotInactive,
                ]}
              />
            ))}
          </Animated.View>
        )}
      </View>
    </Modal>
  );
};

export { sortMessagesChronologically };

interface MessagingScreenProps {
  conversationId: string;
  initialRecipient?: InitialRecipientData;
}

export default function MessagingScreen({ conversationId, initialRecipient }: MessagingScreenProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const { data: session } = useSession();
  const { showToast } = useToast();
  const { initiateCall } = useCall();
  const { wallpaperSource } = useWallpaper();

  const [isAutoDownloadEnabled, setIsAutoDownloadEnabled] = useState(true);
  const [downloadedMediaIds, setDownloadedMediaIds] = useState<Set<string>>(() => new Set());

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      getAutoDownloadPreference().then((pref) => {
        if (isMounted) setIsAutoDownloadEnabled(pref);
      });
      return () => {
        isMounted = false;
      };
    }, [])
  );

  const [conversation, setConversation] = useState<ConversationData | null>(() => {
    try {
      const activeUid = appStorage.getItem('chatuk_active_user_id') || getActiveUserIdSync();
      const userScopedKey = activeUid ? `chatuk_${activeUid}_conv_${conversationId}` : `chatuk_conv_${conversationId}`;
      const cached = appStorage.getItem(userScopedKey) || appStorage.getItem(`chatuk_conv_${conversationId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch { }
    return null;
  });
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [recipientTyping, setRecipientTyping] = useState<string | null>(null);
  const [isRecipientOnline, setIsRecipientOnline] = useState<boolean>(false);

  // Server-resolved user identity (augmented by getConversation / getMessages / getProfile)
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(() => {
    return appStorage.getItem('chatuk_active_user_id') || getActiveUserIdSync() || null;
  });
  const [resolvedUserEmail, setResolvedUserEmail] = useState<string | null>(() => {
    return appStorage.getItem('chatuk_active_user_email') || getActiveUserEmailSync() || null;
  });

  // Effective current user identity: prefer server-resolved or fallback to session
  const currentUserId = resolvedUserId || session?.user?.id || null;
  const currentUserEmail = resolvedUserEmail || session?.user?.email || null;

  const currentUserIdRef = useRef<string | null>(currentUserId);
  const currentUserEmailRef = useRef<string | null>(currentUserEmail);
  const sessionRef = useRef(session);
  const recipientIdRef = useRef<string>('');
  const messagesRef = useRef<SocketMessage[]>(messages);

  const isGroup = conversation?.type === 'group';
  const groupSubtitle = (() => {
    const participants = conversation?.participants;
    if (!participants || participants.length === 0) {
      return 'Group';
    }
    const myId = currentUserId;
    const names = participants.map((p) => {
      if (myId && (p._id === myId || String(p._id) === String(myId))) {
        return 'You';
      }
      return p.name || p.email?.split('@')[0] || 'Member';
    });
    return names.join(', ');
  })();

  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
    messagesRef.current = messages;
    currentUserIdRef.current = currentUserId;
    currentUserEmailRef.current = currentUserEmail;
    sessionRef.current = session;
  });

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animated dots for typing indicator (using useState to satisfy React Compiler rules)
  const [dot1Anim] = useState(() => new Animated.Value(0));
  const [dot2Anim] = useState(() => new Animated.Value(0));
  const [dot3Anim] = useState(() => new Animated.Value(0));

  // Auto scroll down button state & animation
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [scrollButtonAnim] = useState(() => new Animated.Value(0));
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const userHasScrolledRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isMomentumScrollingRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reaction & Emoji picker state
  const [activeReactingMessage, setActiveReactingMessage] = useState<SocketMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [messageInfoTarget, setMessageInfoTarget] = useState<SocketMessage | null>(null);
  const [animatingHeartMsgId, setAnimatingHeartMsgId] = useState<string | null>(null);
  const [heartScaleAnim] = useState(() => new Animated.Value(0.2));
  const [heartOpacityAnim] = useState(() => new Animated.Value(0));
  const lastTapTimeRef = useRef<{ [msgId: string]: number }>({});

  // E2EE Safety Number & Verification State
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  // Input bar Emoji Picker & Fullscreen Media state
  const [showInputEmojiPicker, setShowInputEmojiPicker] = useState(false);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [galleryViewerState, setGalleryViewerState] = useState<{
    visible: boolean;
    initialIndex: number;
    images: GalleryMediaItem[];
  }>({
    visible: false,
    initialIndex: 0,
    images: [],
  });
  const textInputRef = useRef<any>(null);


  // Converts a local SQLite stored message into a UI SocketMessage
  const formatStoredMessage = useCallback((sm: StoredMessage): SocketMessage => {
    let bodyText = sm.body || '';
    if (!bodyText && sm.type === 'text') {
      bodyText = '🔒 Encrypted message';
    }
    let fileUrl: string | undefined;

    if (sm.attachmentJson) {
      try {
        const att = JSON.parse(sm.attachmentJson);
        fileUrl = att.url || att.fileUrl;
        if (att.caption) bodyText = att.caption;
      } catch { }
    }

    const myId = currentUserIdRef.current;
    let isOutgoing = false;
    if (myId && sm.senderId) {
      isOutgoing = sm.senderId === myId;
    } else {
      isOutgoing = sm.isOutgoing === 1;
    }

    const rawTime = sm.sentAt || sm.createdAt;
    let createdAt = new Date().toISOString();
    if (rawTime) {
      const d = new Date(rawTime);
      if (!isNaN(d.getTime())) {
        createdAt = d.toISOString();
      }
    }

    let reactions: MessageReaction[] | undefined;
    if (sm.reactionJson) {
      try {
        const parsed = JSON.parse(sm.reactionJson);
        if (Array.isArray(parsed)) {
          reactions = parsed;
        }
      } catch { }
    }

    return {
      _id: sm.clientMessageId || `sm-${Date.now()}`,
      clientMessageId: sm.clientMessageId,
      conversationId: sm.conversationId,
      senderId: sm.senderId,
      type: sm.type as any,
      content: bodyText,
      fileUrl,
      isOutgoing,
      reactions,
      readBy: isOutgoing ? ['me'] : [],
      deliveryStatus: sm.deliveryStatus || (isOutgoing ? 'sent' : 'delivered'),
      createdAt,
    } as SocketMessage;
  }, []);

  // Deduplicate array of SocketMessage by clientMessageId or _id and maintain strict chronological order
  const deduplicateMessages = useCallback((msgs: SocketMessage[]): SocketMessage[] => {
    const seen = new Set<string>();
    const result: SocketMessage[] = [];
    for (const m of msgs) {
      const key = m.clientMessageId || m._id;
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      result.push(m);
    }
    return sortMessagesChronologically(result);
  }, []);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/chats');
    }
  }, [router]);

  // Safe area insets & keyboard visibility to guarantee bottom padding
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Bottom gap: when keyboard is closed, respects safe area + padding; when open, compact padding
  const bottomGap = isKeyboardVisible ? 8 : (insets.bottom > 0 ? insets.bottom + 6 : 16);

  // Animate scroll button in/out
  useEffect(() => {
    if (showScrollBottom) {
      Animated.spring(scrollButtonAnim, {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(scrollButtonAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [showScrollBottom, scrollButtonAnim]);

  const messagesLengthRef = useRef(messages.length);
  useEffect(() => {
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((animated = true) => {
    isAtBottomRef.current = true;
    setShowScrollBottom(false);
    setNewMessagesBelow(0);
    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current) {
      clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 450);

    try {
      flatListRef.current?.scrollToEnd({ animated });
    } catch { }
    if (Platform.OS === 'web') {
      try {
        const node = (flatListRef.current as any)?.getScrollableNode?.();
        if (node) {
          node.scrollTop = node.scrollHeight;
        }
      } catch { }
    }
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setIsKeyboardVisible(true);
        if (isAtBottomRef.current) {
          setTimeout(() => {
            scrollToBottom(false);
          }, 60);
        }
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToBottom]);

  // Monitor scroll offset to toggle scroll-down button visibility
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (!layoutMeasurement || !contentOffset || !contentSize) return;

    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    const maxOffset = contentSize.height - layoutMeasurement.height;

    // If a programmatic scrollToEnd is active, ignore intermediate layout offset changes unless near bottom
    if (isProgrammaticScrollRef.current) {
      if (distanceFromBottom < 80) {
        isProgrammaticScrollRef.current = false;
        isAtBottomRef.current = true;
        setShowScrollBottom(false);
        setNewMessagesBelow(0);
      }
      return;
    }

    const isNearBottom = distanceFromBottom < 80;
    isAtBottomRef.current = isNearBottom;

    // Detect if user has scrolled away from bottom
    if (maxOffset > 0 && contentOffset.y < maxOffset - 15) {
      userHasScrolledRef.current = true;
    }

    if (isNearBottom) {
      if (showScrollBottom) {
        setShowScrollBottom(false);
        setNewMessagesBelow(0);
      }
    } else {
      userHasScrolledRef.current = true;
      if (!showScrollBottom) {
        setShowScrollBottom(true);
      }
    }
  }, [showScrollBottom]);

  // Catch web mouse wheel / touchpad scrolling immediately
  useEffect(() => {
    if (Platform.OS === 'web') {
      const node = (flatListRef.current as any)?.getScrollableNode?.();
      if (node) {
        const handleWheel = (e: WheelEvent) => {
          if (e.deltaY < 0) {
            userHasScrolledRef.current = true;
            isProgrammaticScrollRef.current = false;
          }
        };
        node.addEventListener('wheel', handleWheel, { passive: true });
        return () => {
          node.removeEventListener('wheel', handleWheel);
        };
      }
    }
  }, [isLoading]);


  const recipient = useMemo(
    () => {
      const myId = currentUserId || session?.user?.id || getActiveUserIdSync();
      const myEmail = currentUserEmail || session?.user?.email || getActiveUserEmailSync();

      const isMe = (p: Participant) => {
        if (myId && (p._id === myId || String(p._id) === String(myId))) return true;
        if (myEmail && p.email && p.email.toLowerCase() === myEmail.toLowerCase()) return true;
        return false;
      };

      // 1. If conversation participants exist, find the one who is NOT me
      if (conversation?.participants && conversation.participants.length > 0) {
        const other = conversation.participants.find((p) => !isMe(p));
        if (other && (!myId || other._id !== myId)) {
          return other;
        }
      }

      // 2. Check initialRecipient passed via route
      if (initialRecipient && initialRecipient._id && (!myId || initialRecipient._id !== myId)) {
        return {
          _id: initialRecipient._id,
          name: initialRecipient.name || 'Contact',
          email: initialRecipient.email || '',
          image: initialRecipient.image || null,
        };
      }

      // 3. Check cached recipient in storage (scoped or global, and ensure not me)
      try {
        const userScopedKey = myId ? `chatuk_${myId}_recipient_${conversationId}` : `chatuk_recipient_${conversationId}`;
        const cachedRecipientRaw = appStorage.getItem(userScopedKey) || appStorage.getItem(`chatuk_recipient_${conversationId}`);
        if (cachedRecipientRaw) {
          const parsed = JSON.parse(cachedRecipientRaw);
          if (parsed && parsed._id && (!myId || parsed._id !== myId)) {
            return {
              _id: parsed._id,
              name: parsed.name || 'Contact',
              email: parsed.email || '',
              image: parsed.image || null,
            };
          }
        }
      } catch { }

      // 4. Fallback: if there are participants and myId is known, pick any participant !== myId
      if (conversation?.participants && conversation.participants.length > 0) {
        const candidate = conversation.participants.find((p) => !myId || p._id !== myId);
        if (candidate) return candidate;
      }

      return {
        _id: '',
        name: 'Conversation',
        email: '',
        image: null,
      };
    },
    [conversation, currentUserId, currentUserEmail, session, initialRecipient, conversationId]
  );

  useEffect(() => {
    recipientIdRef.current = recipient._id;
  }, [recipient._id]);

  // Determine if this conversation is a pending chat invitation awaiting my response
  const isPendingInvitation = Boolean(
    conversation?.status === 'pending' &&
    conversation?.initiatorId &&
    currentUserId &&
    String(conversation.initiatorId) !== String(currentUserId)
  );

  const [isRespondingInvitation, setIsRespondingInvitation] = useState(false);

  const handleAcceptInvitation = async () => {
    setIsRespondingInvitation(true);
    try {
      await api.acceptConversation(conversationId);
      setConversation((prev) => (prev ? { ...prev, status: 'accepted' } : null));
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to accept invitation');
    } finally {
      setIsRespondingInvitation(false);
    }
  };

  const handleDeclineInvitation = () => {
    Alert.alert(
      'Decline Chat Invitation',
      'Are you sure you want to decline this chat invitation? The conversation and all messages will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline & Delete',
          style: 'destructive',
          onPress: async () => {
            setIsRespondingInvitation(true);
            try {
              await api.denyConversation(conversationId);
              await deleteLocalConversation(conversationId);
              router.replace('/chats');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to decline invitation');
              setIsRespondingInvitation(false);
            }
          },
        },
      ]
    );
  };

  // Animate typing indicator dots
  useEffect(() => {
    if (recipientTyping) {
      const createBounce = (anim: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: -6,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.delay(300),
          ])
        );
      };

      const anim1 = createBounce(dot1Anim, 0);
      const anim2 = createBounce(dot2Anim, 150);
      const anim3 = createBounce(dot3Anim, 300);

      anim1.start();
      anim2.start();
      anim3.start();

      return () => {
        anim1.stop();
        anim2.stop();
        anim3.stop();
        dot1Anim.setValue(0);
        dot2Anim.setValue(0);
        dot3Anim.setValue(0);
      };
    }
  }, [recipientTyping, dot1Anim, dot2Anim, dot3Anim]);

  // Setup Socket.IO connection and data fetching
  useEffect(() => {
    let isMounted = true;
    let unsubscribeNewMessage: (() => void) | undefined;
    let unsubscribeTyping: (() => void) | undefined;
    let unsubscribeStopTyping: (() => void) | undefined;
    let unsubscribeRead: (() => void) | undefined;
    let unsubscribeOnlineList: (() => void) | undefined;
    let unsubscribeStatus: (() => void) | undefined;
    let unsubscribeReaction: (() => void) | undefined;
    let unsubscribeClear: (() => void) | undefined;
    let unsubscribeDelete: (() => void) | undefined;
    let unsubscribeError: (() => void) | undefined;
    let unsubscribeConvDeleted: (() => void) | undefined;
    let unsubscribeConvAccepted: (() => void) | undefined;
    let unsubscribeConfirmed: (() => void) | undefined;
    let unsubscribePersistFailed: (() => void) | undefined;
    let unsubscribeGroupUpdated: (() => void) | undefined;
    let unsubscribeGroupMemberAdded: (() => void) | undefined;
    let unsubscribeGroupMemberRemoved: (() => void) | undefined;
    let unsubscribeGroupAdminChanged: (() => void) | undefined;
    let unsubscribeGroupMemberLeft: (() => void) | undefined;

    const fetchInitialData = async () => {
      try {
        // Reset scroll position refs for fresh conversation mount
        initialScrollDoneRef.current = false;
        userHasScrolledRef.current = false;
        isAtBottomRef.current = true;
        isDraggingRef.current = false;

        // 1. Parallelize local SQLite read, server message sync, and conversation metadata
        let isReconciled = false;
        const localPromise = getConversationMessages(conversationId).catch(() => []);
        const remotePromise = loadConversationMessages(conversationId).catch(() => null);
        const convPromise = api.getConversation(conversationId).catch(() => null);

        // 2. Non-blocking device registration in the background
        registerCurrentDevice().catch((e) => console.warn('[E2EE] Background device registration notice:', e));

        // 3. Race remote reconciliation against 200ms threshold to prevent ghost messages
        const timeoutPromise = new Promise<{ type: 'timeout' }>((resolve) => {
          setTimeout(() => resolve({ type: 'timeout' }), 200);
        });

        const fastRemoteResult = await Promise.race([
          remotePromise.then((msgs) => ({ type: 'remote' as const, msgs })),
          timeoutPromise,
        ]);

        if (fastRemoteResult.type === 'remote' && fastRemoteResult.msgs !== null) {
          // Fast remote response (< 200ms): render clean reconciled data directly, ZERO ghosts painted!
          if (isMounted) {
            setMessages(deduplicateMessages(fastRemoteResult.msgs.map(formatStoredMessage)));
            setIsLoading(false);
            setIsSyncing(false);
            isReconciled = true;
            if (!userHasScrolledRef.current && !initialScrollDoneRef.current) {
              initialScrollDoneRef.current = true;
              requestAnimationFrame(() => {
                if (!userHasScrolledRef.current) {
                  scrollToBottom(false);
                }
              });
            }
          }
        } else {
          // Over 200ms or offline: fall back to cached local to preserve offline usability
          const cachedLocal = await localPromise;
          if (isMounted && !isReconciled && cachedLocal && cachedLocal.length > 0) {
            setMessages(deduplicateMessages(cachedLocal.map(formatStoredMessage)));
            setIsLoading(false);
            setIsSyncing(true);
            if (!userHasScrolledRef.current && !initialScrollDoneRef.current) {
              initialScrollDoneRef.current = true;
              requestAnimationFrame(() => {
                if (!userHasScrolledRef.current) {
                  scrollToBottom(false);
                }
              });
            }
          }
        }

        // 4. Process conversation details when resolved
        const convRes = await convPromise;
        let resolvedId: string | null = null;
        let resolvedEmail: string | null = null;

        if (isMounted && convRes) {
          const fallbackId = await getActiveUserId();
          resolvedId =
            (convRes as any)?.currentUserId ||
            sessionRef.current?.user?.id ||
            fallbackId ||
            null;
          resolvedEmail =
            (convRes as any)?.currentUserEmail ||
            sessionRef.current?.user?.email ||
            null;

          if (resolvedId) {
            setResolvedUserId(resolvedId);
          }
          if (resolvedEmail) {
            setResolvedUserEmail(resolvedEmail);
          }

          if (convRes?.conversation) {
            setConversation(convRes.conversation);
            const activeUid = resolvedId || currentUserIdRef.current;
            if (activeUid) {
              appStorage.setItem(`chatuk_${activeUid}_conv_${conversationId}`, JSON.stringify(convRes.conversation));
            }
            appStorage.setItem(`chatuk_conv_${conversationId}`, JSON.stringify(convRes.conversation));
            const rec = convRes.conversation.participants.find(
              (p: Participant) =>
                (resolvedId ? p._id !== resolvedId : true) &&
                (resolvedEmail ? p.email?.toLowerCase() !== resolvedEmail.toLowerCase() : true)
            ) || (resolvedId ? convRes.conversation.participants.find((p: Participant) => p._id !== resolvedId) : undefined);
            if (rec) {
              if (activeUid) {
                appStorage.setItem(`chatuk_${activeUid}_recipient_${conversationId}`, JSON.stringify(rec));
              }
              appStorage.setItem(`chatuk_recipient_${conversationId}`, JSON.stringify(rec));
              if (typeof rec.isOnline === 'boolean') {
                setIsRecipientOnline(rec.isOnline);
              }
            }
          }
        }

        // 5. If remote sync exceeded 200ms, apply latest remote result once it finishes
        const finalRemote = await remotePromise;
        if (isMounted) {
          setIsSyncing(false);
          if (finalRemote !== null && !isReconciled) {
            setMessages(deduplicateMessages(finalRemote.map(formatStoredMessage)));
            setIsLoading(false);
            isReconciled = true;
            if (!userHasScrolledRef.current && !initialScrollDoneRef.current) {
              initialScrollDoneRef.current = true;
              requestAnimationFrame(() => {
                if (!userHasScrolledRef.current) {
                  scrollToBottom(false);
                }
              });
            }
          } else if (!isReconciled) {
            // Fallback: if local storage has no messages yet and remote returned null, display server-loaded messages
            try {
              const serverMsgsRes = await api.getMessages(conversationId);
              if (serverMsgsRes?.messages && serverMsgsRes.messages.length > 0 && isMounted) {
                const activeUid = resolvedId || currentUserIdRef.current;
                const decryptedServerMsgs = await Promise.all(
                  serverMsgsRes.messages.map(async (msg: any) => {
                    const isOutgoing = activeUid && msg.senderId
                      ? msg.senderId === activeUid
                      : Boolean((msg as any).isOutgoing);
                    if (msg.encrypted) {
                      const payload = await processIncomingMessage({ message: msg, envelope: msg.envelope }).catch(() => null);
                      if (payload) {
                        return {
                          ...msg,
                          isOutgoing,
                          content: payload.body || '🔒 Encrypted message',
                          fileUrl: payload.attachment?.url || msg.fileUrl,
                        };
                      }
                      return {
                        ...msg,
                        isOutgoing,
                        content: msg.content || '🔒 Encrypted message',
                      };
                    }
                    return {
                      ...msg,
                      isOutgoing,
                    };
                  })
                );
                setMessages(deduplicateMessages(decryptedServerMsgs));
                setIsLoading(false);
                if (!userHasScrolledRef.current && !initialScrollDoneRef.current) {
                  initialScrollDoneRef.current = true;
                  requestAnimationFrame(() => {
                    if (!userHasScrolledRef.current) {
                      scrollToBottom(false);
                    }
                  });
                }
              }
            } catch (fallbackErr) {
              console.warn('[MessagingScreen] Fallback server message fetch failed:', fallbackErr);
            }
          }
        }

        // Resilient fallback: fetch profile to guarantee user identification
        if (isMounted && (!currentUserIdRef.current || !currentUserEmailRef.current)) {
          try {
            const profileRes = await api.getProfile();
            if (profileRes?.user && isMounted) {
              if (profileRes.user.id) {
                setResolvedUserId(profileRes.user.id);
              }
              if (profileRes.user.email) {
                setResolvedUserEmail(profileRes.user.email);
              }
            }
          } catch { }
        }
      } catch (err) {
        console.error('Failed to load conversation:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsSyncing(false);
        }
      }
    };

    const setupSocket = async () => {
      await socketService.connect();
      socketService.joinConversation(conversationId);
      socketService.markRead(conversationId);

      // Listen for incoming messages and decrypt on device
      unsubscribeNewMessage = socketService.onNewMessage(async (newMsg) => {
        if (newMsg.conversationId === conversationId) {
          let displayContent = newMsg.content;
          let displayUrl = newMsg.fileUrl;

          let targetEnvelope = newMsg.envelope;
          if (newMsg.encrypted) {
            try {
              const keys = await getStoredDeviceKeys();
              if (keys?.deviceId) {
                if (targetEnvelope?.deviceId && targetEnvelope.deviceId !== keys.deviceId) {
                  targetEnvelope = null;
                }
                if (!targetEnvelope && Array.isArray((newMsg as any).envelopes)) {
                  targetEnvelope = (newMsg as any).envelopes.find((e: any) => e.deviceId === keys.deviceId) || null;
                }
              }
            } catch { }

            if (targetEnvelope) {
              try {
                const decrypted = await processIncomingMessage({
                  message: newMsg,
                  envelope: targetEnvelope,
                });
                if (decrypted) {
                  if (decrypted.kind === 'text') {
                    displayContent = decrypted.body || '';
                  } else if (
                    decrypted.kind === 'image' ||
                    decrypted.kind === 'video' ||
                    decrypted.kind === 'audio'
                  ) {
                    displayUrl = decrypted.attachment?.url || newMsg.fileUrl || displayUrl;
                    displayContent = decrypted.body || '';
                  }
                }
              } catch (decryptErr) {
                console.warn('[E2EE] Could not decrypt incoming realtime message:', decryptErr);
                displayContent = '🔒 Encrypted message (key not available on this device)';
              }
            } else {
              displayContent = '🔒 Encrypted message (key not available on this device)';
            }
          }

          if (!displayUrl && newMsg.fileUrl) {
            displayUrl = newMsg.fileUrl;
          }

          const myId = currentUserIdRef.current;
          const myEmail = currentUserEmailRef.current;
          const isSentByMe = myId && newMsg.senderId
            ? newMsg.senderId === myId
            : (newMsg.senderEmail && myEmail && newMsg.senderEmail.toLowerCase() === myEmail.toLowerCase()) ||
            Boolean((newMsg as any).isOutgoing);

          // If sent by me, ensure we never display an encrypted placeholder on sender device
          if (isSentByMe && (!displayContent || displayContent.startsWith('🔒 Encrypted message'))) {
            const existingOpt = messagesRef.current.find(
              (m) =>
                (newMsg.clientMessageId && (m.clientMessageId === newMsg.clientMessageId || m._id === newMsg.clientMessageId)) ||
                (newMsg._id && (m._id === newMsg._id || m.clientMessageId === newMsg._id))
            );
            if (existingOpt?.content && !existingOpt.content.startsWith('🔒 Encrypted message')) {
              displayContent = existingOpt.content;
            }
          }

          const resolvedType =
            newMsg.type === 'audio' || (newMsg as any).kind === 'audio'
              ? 'audio'
              : newMsg.type || 'text';

          const resolvedMsg: SocketMessage = {
            ...newMsg,
            type: resolvedType,
            content: displayContent,
            fileUrl: displayUrl,
            isOutgoing: isSentByMe,
          } as SocketMessage;

          setMessages((prev) => {
            // 1. Check if this resolves an optimistic temporary message strictly by unique message IDs
            const optIndex = prev.findIndex(
              (m) =>
                (resolvedMsg.clientMessageId &&
                  (m.clientMessageId === resolvedMsg.clientMessageId || m._id === resolvedMsg.clientMessageId)) ||
                (resolvedMsg._id && (m._id === resolvedMsg._id || m.clientMessageId === resolvedMsg._id))
            );

            if (optIndex !== -1) {
              const copy = [...prev];
              const existingMsg = copy[optIndex];
              const hasExistingPlaintext =
                existingMsg.content &&
                !existingMsg.content.startsWith('🔒 Encrypted message');
              const newIsEncryptedPlaceholder =
                !displayContent ||
                displayContent.startsWith('🔒 Encrypted message');

              const resolvedContent = (hasExistingPlaintext && newIsEncryptedPlaceholder)
                ? existingMsg.content
                : (displayContent || existingMsg.content);

              copy[optIndex] = {
                ...resolvedMsg,
                content: resolvedContent,
                type: resolvedType,
                fileUrl: resolvedMsg.fileUrl || existingMsg.fileUrl,
                deliveryStatus: 'sent',
              };
              // Cleanly purge any extra duplicate temporary or matching clientMessageId entries
              const filtered = copy.filter(
                (m, idx) =>
                  idx === optIndex ||
                  (m._id !== resolvedMsg._id &&
                    (!resolvedMsg.clientMessageId || m.clientMessageId !== resolvedMsg.clientMessageId))
              );
              return sortMessagesChronologically(filtered);
            }

            // 2. Otherwise check for exact duplicates
            const isDuplicate = prev.some(
              (m) =>
                m._id === resolvedMsg._id ||
                (resolvedMsg.clientMessageId && m.clientMessageId === resolvedMsg.clientMessageId)
            );
            if (isDuplicate) {
              return prev;
            }

            return sortMessagesChronologically([...prev, { ...resolvedMsg, deliveryStatus: isSentByMe ? 'sent' : 'delivered' }]);
          });

          if (!isSentByMe) {
            setRecipientTyping(null);
            socketService.markRead(conversationId);
            soundService.playReceiverSoundForMessage(newMsg._id || newMsg.clientMessageId);
          }

          if (isSentByMe) {
            setTimeout(() => {
              scrollToBottom(true);
            }, 80);
          } else if (isAtBottomRef.current && !isDraggingRef.current && !isMomentumScrollingRef.current) {
            setTimeout(() => {
              if (isAtBottomRef.current && !isDraggingRef.current && !isMomentumScrollingRef.current) {
                scrollToBottom(true);
              } else {
                setNewMessagesBelow((prev) => prev + 1);
              }
            }, 80);
          } else {
            setNewMessagesBelow((prev) => prev + 1);
          }
        }
      });

      // Listen for typing indicators
      unsubscribeTyping = socketService.onUserTyping((data) => {
        const myId = currentUserIdRef.current;
        if (data.conversationId === conversationId && data.userId !== myId) {
          setRecipientTyping(data.userName || 'Someone');
        }
      });

      unsubscribeStopTyping = socketService.onUserStopTyping((data) => {
        const myId = currentUserIdRef.current;
        if (data.conversationId === conversationId && data.userId !== myId) {
          setRecipientTyping(null);
        }
      });

      // Listen for read receipts
      unsubscribeRead = socketService.onMessagesRead((data) => {
        if (data.conversationId === conversationId && data.readBy) {
          setMessages((prev) =>
            prev.map((msg) => {
              const currentReadBy = Array.isArray(msg.readBy) ? msg.readBy : [];
              if (!currentReadBy.includes(data.readBy)) {
                return { ...msg, readBy: [...currentReadBy, data.readBy] };
              }
              return msg;
            })
          );
        }
      });

      // Listen for message reaction updates
      unsubscribeReaction = socketService.onMessageReactionUpdated((data: any) => {
        if (data.conversationId === conversationId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === data.messageId ||
                (data.clientMessageId && (msg._id === data.clientMessageId || msg.clientMessageId === data.clientMessageId)) ||
                (msg.clientMessageId && msg.clientMessageId === data.messageId)
                ? { ...msg, reactions: data.reactions }
                : msg
            )
          );
          if (data.clientMessageId) {
            updateLocalMessageReactions(conversationId, data.clientMessageId, data.reactions);
          }
          if (data.messageId) {
            updateLocalMessageReactions(conversationId, data.messageId, data.reactions);
          }
        }
      });

      // Listen for conversation clear events (only clear if triggered by current user)
      unsubscribeClear = socketService.onConversationCleared(async (data) => {
        if (data.conversationId === conversationId) {
          const myId = currentUserIdRef.current;
          if (!data.clearedBy || (myId && data.clearedBy === myId)) {
            setMessages([]);
            await deleteLocalConversation(conversationId);
          }
        }
      });

      // Listen for message deleted events
      unsubscribeDelete = socketService.onMessageDeleted((data) => {
        if (data.conversationId === conversationId) {
          setMessages((prev) =>
            prev.filter(
              (m) =>
                m._id !== data.messageId &&
                (!data.clientMessageId || (m.clientMessageId !== data.clientMessageId && m._id !== data.clientMessageId)) &&
                (!data.messageId || m.clientMessageId !== data.messageId)
            )
          );
          deleteLocalMessage(conversationId, data.messageId, data.clientMessageId).catch(() => { });
        }
      });

      // Listen for socket errors (e.g. blocked notice or device reactivation)
      unsubscribeError = socketService.onErrorMessage((data) => {
        if (data?.error && data.error.toLowerCase().includes('senderdeviceid is not active for sender')) {
          registerCurrentDevice(true).catch(console.warn);
          setMessages((prev) => {
            const hasPending = prev.some((m) => m.deliveryStatus === 'pending');
            if (!hasPending) return prev;
            return prev.map((m) => {
              if (m.deliveryStatus === 'pending') {
                if (m.clientMessageId) {
                  updateLocalMessageDeliveryStatus(m.clientMessageId, 'failed', conversationId).catch(console.warn);
                }
                return { ...m, deliveryStatus: 'failed' as const };
              }
              return m;
            });
          });
          showToastRef.current?.('Device re-activated. Tap message to retry.', { type: 'info' });
          return;
        }
        Alert.alert('Notice', data.error);
      });

      // Listen for active online users list
      unsubscribeOnlineList = socketService.onOnlineUsersList((ids) => {
        const targetId = recipientIdRef.current;
        if (targetId) {
          setIsRecipientOnline(Array.isArray(ids) ? ids.includes(targetId) : false);
        }
      });

      // Listen for individual user status changes
      unsubscribeStatus = socketService.onUserStatusChanged(({ userId, isOnline }) => {
        const targetId = recipientIdRef.current;
        if (targetId && userId === targetId) {
          setIsRecipientOnline(isOnline);
        }
      });

      // Listen for conversation deleted / denied events
      unsubscribeConvDeleted = socketService.onConversationDeleted(async (data) => {
        if (data.conversationId === conversationId) {
          await deleteLocalConversation(conversationId);
          router.replace('/chats');
        }
      });

      // Listen for conversation accepted events
      unsubscribeConvAccepted = socketService.onConversationAccepted((data) => {
        if (data.conversationId === conversationId) {
          setConversation((prev) => (prev ? { ...prev, status: 'accepted' } : null));
        }
      });

      // Listen for message persistence confirmation from backend
      unsubscribeConfirmed = socketService.onMessageConfirmed((data) => {
        if (!data?.clientMessageId) return;
        soundService.playSenderSoundForMessage(data.clientMessageId);
        updateLocalMessageDeliveryStatus(data.clientMessageId, 'sent', data.conversationId || conversationId).catch(console.warn);
        setMessages((prev) => {
          const updated: SocketMessage[] = prev.map((m) => {
            if (m.clientMessageId === data.clientMessageId || m._id === data.clientMessageId) {
              return {
                ...m,
                _id: data._id,
                deliveryStatus: 'sent' as const,
                createdAt: data.createdAt || m.createdAt,
              };
            }
            return m;
          });
          return sortMessagesChronologically(updated);
        });
      });

      // Listen for message persistence failure notification
      unsubscribePersistFailed = socketService.onMessagePersistFailed((data) => {
        if (data.conversationId === conversationId || !data.conversationId) {
          updateLocalMessageDeliveryStatus(data.clientMessageId, 'failed', data.conversationId || conversationId).catch(console.warn);
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === data.clientMessageId || m._id === data.clientMessageId
                ? { ...m, deliveryStatus: 'failed' as const }
                : m
            )
          );
          showToastRef.current('Failed to save message to live database. Tap to retry.', { type: 'error' });
        }
      });

      // Listen for group events in real-time
      unsubscribeGroupUpdated = socketService.onGroupUpdated((data) => {
        if (data.conversationId === conversationId) {
          setConversation((prev) =>
            prev
              ? {
                ...prev,
                name: data.name !== undefined ? data.name : prev.name,
                description: data.description !== undefined ? data.description : prev.description,
                groupAvatarUrl: data.groupAvatarUrl !== undefined ? data.groupAvatarUrl : prev.groupAvatarUrl,
              }
              : null
          );
        }
      });

      unsubscribeGroupMemberAdded = socketService.onGroupMemberAdded((data) => {
        if (data.conversationId === conversationId) {
          setConversation((prev) =>
            prev
              ? {
                ...prev,
                participants: data.participants || prev.participants,
                adminIds: data.adminIds || prev.adminIds,
              }
              : null
          );
        }
      });

      unsubscribeGroupMemberRemoved = socketService.onGroupMemberRemoved((data) => {
        if (data.conversationId === conversationId) {
          const myId = currentUserIdRef.current;
          if (myId && String(data.userId) === String(myId)) {
            showToastRef.current?.('You were removed from this group', { type: 'error' });
            router.replace('/chats');
          } else {
            setConversation((prev) =>
              prev
                ? {
                  ...prev,
                  participants: data.participants || prev.participants,
                  adminIds: data.adminIds || prev.adminIds,
                }
                : null
            );
          }
        }
      });

      unsubscribeGroupAdminChanged = socketService.onGroupAdminChanged((data) => {
        if (data.conversationId === conversationId) {
          setConversation((prev) =>
            prev ? { ...prev, adminIds: data.adminIds || prev.adminIds } : null
          );
        }
      });

      unsubscribeGroupMemberLeft = socketService.onGroupMemberLeft((data) => {
        if (data.conversationId === conversationId) {
          setConversation((prev) =>
            prev
              ? {
                ...prev,
                participants: prev.participants.filter((p) => p._id !== data.userId),
              }
              : null
          );
        }
      });

      // Request fresh online users list
      socketService.requestOnlineUsers();
    };

    fetchInitialData();
    setupSocket();

    return () => {
      isMounted = false;
      socketService.sendStopTyping(conversationId);
      socketService.leaveConversation(conversationId);
      if (unsubscribeNewMessage) unsubscribeNewMessage();
      if (unsubscribeTyping) unsubscribeTyping();
      if (unsubscribeStopTyping) unsubscribeStopTyping();
      if (unsubscribeRead) unsubscribeRead();
      if (unsubscribeReaction) unsubscribeReaction();
      if (unsubscribeClear) unsubscribeClear();
      if (unsubscribeDelete) unsubscribeDelete();
      if (unsubscribeError) unsubscribeError();
      if (unsubscribeOnlineList) unsubscribeOnlineList();
      if (unsubscribeStatus) unsubscribeStatus();
      if (unsubscribeConvDeleted) unsubscribeConvDeleted();
      if (unsubscribeConvAccepted) unsubscribeConvAccepted();
      if (unsubscribeConfirmed) unsubscribeConfirmed();
      if (unsubscribePersistFailed) unsubscribePersistFailed();
      if (unsubscribeGroupUpdated) unsubscribeGroupUpdated();
      if (unsubscribeGroupMemberAdded) unsubscribeGroupMemberAdded();
      if (unsubscribeGroupMemberRemoved) unsubscribeGroupMemberRemoved();
      if (unsubscribeGroupAdminChanged) unsubscribeGroupAdminChanged();
      if (unsubscribeGroupMemberLeft) unsubscribeGroupMemberLeft();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [conversationId, formatStoredMessage, deduplicateMessages, router, scrollToBottom]);

  // Reload conversation details and messages when returning from conversation settings screen
  const isInitialFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isInitialFocusRef.current) {
        isInitialFocusRef.current = false;
        return;
      }
      let isMounted = true;
      (async () => {
        try {
          const [convResult, localMsgsResult] = await Promise.allSettled([
            api.getConversation(conversationId),
            loadConversationMessages(conversationId),
          ]);
          const convRes = convResult.status === 'fulfilled' ? convResult.value : null;
          const localMsgs = localMsgsResult.status === 'fulfilled' ? localMsgsResult.value : [];

          if (isMounted) {
            const fallbackId = await getActiveUserId();
            const resolvedId =
              (convRes as any)?.currentUserId ||
              sessionRef.current?.user?.id ||
              fallbackId ||
              null;
            const resolvedEmail =
              (convRes as any)?.currentUserEmail ||
              sessionRef.current?.user?.email ||
              null;

            if (resolvedId) setResolvedUserId(resolvedId);
            if (resolvedEmail) setResolvedUserEmail(resolvedEmail);

            if (convRes?.conversation) {
              setConversation(convRes.conversation);
              appStorage.setItem(`chatuk_conv_${conversationId}`, JSON.stringify(convRes.conversation));
            }
            if (localMsgs) {
              setMessages(deduplicateMessages(localMsgs.map(formatStoredMessage)));
              if (localMsgs.length > 0 && isAtBottomRef.current && !userHasScrolledRef.current && !isDraggingRef.current) {
                requestAnimationFrame(() => {
                  if (isAtBottomRef.current && !userHasScrolledRef.current && !isDraggingRef.current) {
                    scrollToBottom(false);
                  }
                });
              }
            }
            socketService.markRead(conversationId);
          }
        } catch { }
      })();
      return () => {
        isMounted = false;
      };
    }, [conversationId, formatStoredMessage, deduplicateMessages, scrollToBottom])
  );

  // ─── Emoji Reaction Handlers ───
  const triggerHeartPop = useCallback((msgId: string) => {
    setAnimatingHeartMsgId(msgId);
    heartScaleAnim.setValue(0.2);
    heartOpacityAnim.setValue(1);

    Animated.sequence([
      Animated.spring(heartScaleAnim, {
        toValue: 1.35,
        friction: 4,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.timing(heartScaleAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.delay(450),
      Animated.timing(heartOpacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setAnimatingHeartMsgId(null);
    });
  }, [heartScaleAnim, heartOpacityAnim]);

  const handleToggleReaction = useCallback(
    async (
      msg: SocketMessage,
      emoji: string,
      action: 'add' | 'remove' | 'toggle' = 'toggle'
    ) => {
      const activeUserId = currentUserIdRef.current || 'me';
      const activeUserName = sessionRef.current?.user?.name || 'You';

      let updatedReactions: MessageReaction[] = [];

      // Optimistically update reactions on the message
      setMessages((prev) =>
        prev.map((m) => {
          if (m._id !== msg._id) return m;

          const currentReactions: MessageReaction[] = m.reactions ? [...m.reactions] : [];
          const myIndex = currentReactions.findIndex(
            (r) =>
              String(r.userId) === String(activeUserId) ||
              (activeUserName && r.userName === activeUserName)
          );

          if (action === 'remove') {
            if (myIndex !== -1) {
              currentReactions.splice(myIndex, 1);
            }
          } else if (action === 'add') {
            if (myIndex !== -1) {
              currentReactions[myIndex] = {
                ...currentReactions[myIndex],
                emoji,
              };
            } else {
              currentReactions.push({
                userId: activeUserId,
                userName: activeUserName,
                emoji,
                createdAt: new Date().toISOString(),
              });
            }
          } else {
            // toggle
            if (myIndex !== -1) {
              if (currentReactions[myIndex].emoji === emoji) {
                // Toggle off
                currentReactions.splice(myIndex, 1);
              } else {
                // Change emoji
                currentReactions[myIndex] = {
                  ...currentReactions[myIndex],
                  emoji,
                };
              }
            } else {
              // Add reaction
              currentReactions.push({
                userId: activeUserId,
                userName: activeUserName,
                emoji,
                createdAt: new Date().toISOString(),
              });
            }
          }

          updatedReactions = currentReactions;
          return { ...m, reactions: currentReactions };
        })
      );

      // Persist reaction locally immediately
      updateLocalMessageReactions(conversationId, msg._id, updatedReactions);
      if (msg.clientMessageId && msg.clientMessageId !== msg._id) {
        updateLocalMessageReactions(conversationId, msg.clientMessageId, updatedReactions);
      }

      // Emit reaction via socket if connected
      const targetId = msg._id || msg.clientMessageId || '';
      if (!targetId) return;
      const sentViaSocket = socketService.sendReaction(conversationId, targetId, emoji, action);

      // Always sync via REST API to ensure MongoDB consistency
      try {
        await api.toggleReaction(targetId, conversationId, emoji, action);
      } catch (err) {
        if (!sentViaSocket) {
          console.warn('API reaction sync warning:', err);
        }
      }
    },
    [conversationId]
  );

  // Retries sending a previously failed message to MongoDB / live backend
  const handleRetryMessage = useCallback(
    async (msg: SocketMessage) => {
      const targetId = msg.clientMessageId || msg._id;
      if (!targetId) return;

      // Immediately mark status back to pending in state and SQLite
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === targetId || m._id === targetId
            ? { ...m, deliveryStatus: 'pending' }
            : m
        )
      );
      await updateLocalMessageDeliveryStatus(targetId, 'pending', conversationId).catch(console.warn);

      try {
        let activeUserId = currentUserId || currentUserIdRef.current;
        if (!activeUserId || activeUserId === 'me') {
          const active = await getActiveUserId();
          if (active) activeUserId = active;
        }
        if (!activeUserId || activeUserId === 'me') {
          activeUserId = sessionRef.current?.user?.id || 'me';
        }

        const existingLocalMsg = await getLocalMessage(targetId, conversationId).catch(() => null);
        let replyTo: { clientMessageId: string } | undefined;
        if (existingLocalMsg?.replyToJson) {
          try {
            replyTo = JSON.parse(existingLocalMsg.replyToJson);
          } catch { }
        }

        let existingAttachment: any;
        if (existingLocalMsg?.attachmentJson) {
          try {
            existingAttachment = JSON.parse(existingLocalMsg.attachmentJson);
          } catch { }
        }

        if (msg.type === 'text') {
          await sendEncryptedMessage({
            conversationId,
            senderId: activeUserId,
            type: 'text',
            clientMessageId: targetId,
            payload: {
              kind: 'text',
              body: msg.content || existingLocalMsg?.body || '',
              replyTo,
              sentAt: Date.now(),
            },
          });
        } else if (msg.type === 'image' || msg.type === 'video') {
          let fileUrl = msg.fileUrl || existingAttachment?.url;
          const isVideo = msg.type === 'video';
          // If fileUrl is a local file URI (upload failed previously), upload to Cloudinary first
          if (
            fileUrl &&
            (fileUrl.startsWith('file://') ||
              fileUrl.startsWith('content://') ||
              fileUrl.startsWith('ph://'))
          ) {
            const uploadRes = await api.uploadMedia({
              uri: fileUrl,
              name: isVideo ? `video_${Date.now()}.mp4` : `image_${Date.now()}.jpg`,
              type: isVideo ? 'video/mp4' : 'image/jpeg',
            });
            fileUrl = uploadRes.url;
            setMessages((prev) =>
              prev.map((m) =>
                m.clientMessageId === targetId || m._id === targetId ? { ...m, fileUrl } : m
              )
            );
          }

          await sendEncryptedMessage({
            conversationId,
            senderId: activeUserId,
            type: msg.type,
            fileUrl: fileUrl || undefined,
            clientMessageId: targetId,
            payload: {
              kind: msg.type,
              attachment: fileUrl
                ? {
                  url: fileUrl,
                  key: existingAttachment?.key || '',
                  size: existingAttachment?.size || 0,
                  mime: isVideo ? 'video/mp4' : 'image/jpeg',
                  width: existingAttachment?.width,
                  height: existingAttachment?.height,
                  durationMs: existingAttachment?.durationMs,
                }
                : undefined,
              body: msg.content || existingLocalMsg?.body || '',
              replyTo,
              sentAt: Date.now(),
            },
          });
        } else if (msg.type === 'audio') {
          let fileUrl = msg.fileUrl || existingAttachment?.url;
          if (
            fileUrl &&
            (fileUrl.startsWith('file://') ||
              fileUrl.startsWith('content://') ||
              fileUrl.startsWith('ph://'))
          ) {
            const uploadRes = await api.uploadMedia({
              uri: fileUrl,
              name: `voice_${Date.now()}.m4a`,
              type: 'audio/m4a',
              folder: 'chatuk/VoiceMessages',
            });
            fileUrl = getPlayableAudioUrl(uploadRes.url);
            setMessages((prev) =>
              prev.map((m) =>
                m.clientMessageId === targetId || m._id === targetId ? { ...m, fileUrl } : m
              )
            );
          }

          await sendEncryptedMessage({
            conversationId,
            senderId: activeUserId,
            type: 'audio',
            fileUrl: fileUrl || undefined,
            clientMessageId: targetId,
            payload: {
              kind: 'audio',
              attachment: fileUrl
                ? {
                  url: fileUrl,
                  key: existingAttachment?.key || '',
                  size: existingAttachment?.size || 0,
                  mime: 'audio/m4a',
                  durationMs: existingAttachment?.durationMs,
                }
                : undefined,
              body: '',
              replyTo,
              sentAt: Date.now(),
            },
          });
        }

        // If socket is not connected, sendEncryptedMessage completed via HTTP POST
        if (!socketService.isSocketConnected()) {
          await updateLocalMessageDeliveryStatus(targetId, 'sent', conversationId).catch(console.warn);
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === targetId || m._id === targetId
                ? { ...m, deliveryStatus: 'sent' }
                : m
            )
          );
          showToast('Message sent successfully', { type: 'success' });
        }
      } catch (retryErr: any) {
        console.warn('[Retry] Send message retry failed:', retryErr);
        await updateLocalMessageDeliveryStatus(targetId, 'failed', conversationId).catch(console.warn);
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === targetId || m._id === targetId
              ? { ...m, deliveryStatus: 'failed' }
              : m
          )
        );
        showToast('Could not send the message, try again later.', { type: 'error' });
      }
    },
    [conversationId, currentUserId, showToast]
  );

  // Double-tap on message bubble drops a heart ❤️, or prompts retry if failed
  const handleBubblePress = useCallback(
    (msg: SocketMessage) => {
      if (msg.deliveryStatus === 'failed') {
        Alert.alert(
          'Retry Sending',
          'This message could not be saved to the database. Would you like to retry sending now?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: () => handleRetryMessage(msg) },
          ]
        );
        return;
      }
      const now = getCurrentTimestamp();
      const lastTime = lastTapTimeRef.current[msg._id] || 0;

      if (now - lastTime < 320) {
        lastTapTimeRef.current[msg._id] = 0;
        handleToggleReaction(msg, '❤️', 'add');
        triggerHeartPop(msg._id);
      } else {
        lastTapTimeRef.current[msg._id] = now;
      }
    },
    [handleToggleReaction, triggerHeartPop, handleRetryMessage]
  );

  // Tap & hold on message bubble opens native emoji bar
  const handleBubbleLongPress = useCallback((msg: SocketMessage) => {
    setActiveReactingMessage(msg);
    setShowEmojiPicker(false);
  }, []);

  // Check if a message was sent by the current user
  const isMessageFromMe = useCallback(
    (msg?: SocketMessage | null) => {
      if (!msg) return false;
      const myId = String(currentUserId || resolvedUserId || session?.user?.id || '').trim();
      const myEmail = (currentUserEmail || session?.user?.email || '').toLowerCase().trim();
      const itemSenderId = String(msg.senderId || '').trim();
      const itemSenderEmail = msg.senderEmail ? msg.senderEmail.toLowerCase().trim() : '';

      return Boolean(
        (myId && itemSenderId === myId) ||
        itemSenderId === 'me' ||
        (myEmail && itemSenderEmail === myEmail) ||
        (session?.user?.id && itemSenderId === session.user.id) ||
        (session?.user?.email && itemSenderEmail === session.user.email.toLowerCase().trim()) ||
        msg.isOutgoing
      );
    },
    [currentUserId, currentUserEmail, resolvedUserId, session]
  );

  // Permanently delete message for everyone (with Cloudinary cleanup on backend)
  const handleDeleteMessage = useCallback(
    async (msg: SocketMessage) => {
      const msgId = msg._id;
      const clientMsgId = msg.clientMessageId;

      // Optimistically remove from local message list
      setMessages((prev) =>
        prev.filter(
          (m) =>
            m._id !== msgId &&
            (!clientMsgId || m.clientMessageId !== clientMsgId) &&
            (!clientMsgId || m._id !== clientMsgId) &&
            (!msgId || m.clientMessageId !== msgId)
        )
      );

      try {
        // Delete locally from SQLite
        await deleteLocalMessage(conversationId, msgId, clientMsgId).catch(() => { });

        // Emit real-time delete via socket
        socketService.deleteMessage(msgId, conversationId, clientMsgId);

        // Call REST API to ensure permanent MongoDB and Cloudinary cleanup
        const targetServerId =
          msgId && msgId.length === 24 && /^[0-9a-fA-F]{24}$/.test(msgId)
            ? msgId
            : clientMsgId && clientMsgId.length === 24 && /^[0-9a-fA-F]{24}$/.test(clientMsgId)
              ? clientMsgId
              : (msgId || clientMsgId);

        if (targetServerId) {
          try {
            await api.deleteMessage(targetServerId);
          } catch (apiErr: any) {
            const isNotFound =
              apiErr?.message?.includes('not found') ||
              apiErr?.message?.includes('NOT_FOUND') ||
              apiErr?.status === 404;
            if (!isNotFound) {
              throw apiErr;
            }
          }
        }

        showToast('Message deleted', 'success');
      } catch (err: any) {
        console.warn('Failed to delete message:', err);
        showToast(err?.message || 'Failed to delete message', 'error');
      }
    },
    [conversationId, showToast]
  );

  const handleConfirmDeleteMessage = useCallback(
    (msg: SocketMessage) => {
      if (Platform.OS === 'web') {
        const confirmed =
          typeof window !== 'undefined'
            ? window.confirm('Are you sure you want to delete this message? It will be removed permanently.')
            : true;
        if (confirmed) {
          handleDeleteMessage(msg);
        }
        return;
      }

      Alert.alert(
        'Delete Message',
        'Are you sure you want to delete this message? It will be removed permanently.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => handleDeleteMessage(msg),
          },
        ]
      );
    },
    [handleDeleteMessage]
  );

  // Handle typing event in text input
  const handleInputChange = (text: string) => {
    setInputText(text);

    if (text.trim().length > 0) {
      socketService.sendTyping(conversationId);

      // Reset existing stop-typing timer
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Automatically emit stop_typing after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        socketService.sendStopTyping(conversationId);
      }, 2000);
    } else {
      socketService.sendStopTyping(conversationId);
    }
  };

  // Automatically align to latest message when entering chat
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !initialScrollDoneRef.current && !userHasScrolledRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom(false);
      const t1 = setTimeout(() => {
        if (!userHasScrolledRef.current && !isDraggingRef.current && !isMomentumScrollingRef.current && isAtBottomRef.current) {
          scrollToBottom(false);
        }
      }, 60);
      const t2 = setTimeout(() => {
        if (!userHasScrolledRef.current && !isDraggingRef.current && !isMomentumScrollingRef.current && isAtBottomRef.current) {
          scrollToBottom(false);
        }
      }, 200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [isLoading, messages.length, scrollToBottom]);

  // Handle message sending
  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setInputText('');
    socketService.sendStopTyping(conversationId);

    let activeUserId = currentUserId || currentUserIdRef.current;
    let activeEmail = currentUserEmail || currentUserEmailRef.current || '';

    if (!activeUserId || activeUserId === 'me') {
      const active = await getActiveUserId();
      if (active) activeUserId = active;
    }
    if (!activeUserId || activeUserId === 'me') {
      const profile = await api.getProfile().catch(() => null);
      if (profile?.user?.id) {
        activeUserId = profile.user.id;
        activeEmail = profile.user.email || activeEmail;
        setResolvedUserId(activeUserId);
        setResolvedUserEmail(activeEmail);
      }
    }
    if (!activeUserId) {
      activeUserId = sessionRef.current?.user?.id || 'me';
    }

    const tempId = `temp-${Date.now()}`;

    const nowMs = Date.now();
    const lastMsg = messages[messages.length - 1];
    const lastMsgTime = lastMsg?.createdAt ? new Date(lastMsg.createdAt).getTime() : 0;
    const safeTime = Math.max(nowMs, isNaN(lastMsgTime) ? nowMs : lastMsgTime + 1);
    const optimisticCreatedAt = new Date(safeTime).toISOString();

    // Optimistically add message for instant feedback
    const optimisticMsg: SocketMessage = {
      _id: tempId,
      clientMessageId: tempId,
      conversationId,
      senderId: activeUserId,
      senderEmail: activeEmail,
      type: 'text',
      content: trimmed,
      isOutgoing: true,
      deliveryStatus: 'pending',
      readBy: activeUserId && activeUserId !== 'me' ? [activeUserId] : [],
      createdAt: optimisticCreatedAt,
    } as SocketMessage;

    setMessages((prev) => {
      if (prev.some((m) => m._id === tempId || m.clientMessageId === tempId)) {
        return prev;
      }
      return sortMessagesChronologically([...prev, optimisticMsg]);
    });
    isAtBottomRef.current = true;
    setShowScrollBottom(false);
    setNewMessagesBelow(0);
    setTimeout(() => {
      try {
        flatListRef.current?.scrollToEnd({ animated: true });
      } catch { }
    }, 60);

    try {
      await sendEncryptedMessage({
        conversationId,
        senderId: activeUserId,
        type: 'text',
        clientMessageId: tempId,
        payload: {
          kind: 'text',
          body: trimmed,
          sentAt: Date.now(),
        },
      });
      if (!socketService.isSocketConnected()) {
        soundService.playSenderSoundForMessage(tempId);
      }
    } catch (err: any) {
      console.error('[E2EE] Send encrypted message error:', err);
      await updateLocalMessageDeliveryStatus(tempId, 'failed', conversationId).catch(console.warn);
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === tempId || m._id === tempId
            ? { ...m, deliveryStatus: 'failed' }
            : m
        )
      );
      showToast('Could not save message to live database. Tap to retry.', { type: 'error' });
    } finally {
      setIsSending(false);
    }
  };

  // Process and transmit media attachment (images and videos) stored in Cloudinary chatuk/MessageMedia folder
  const processAndSendMediaAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setIsSending(true);
    const tempId = `temp-${Date.now()}`;
    let activeUserId = currentUserId || currentUserIdRef.current || 'me';
    let activeEmail = currentUserEmail || currentUserEmailRef.current || '';
    const isVideo =
      asset.type === 'video' ||
      (asset.mimeType && asset.mimeType.startsWith('video/')) ||
      /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(asset.uri);
    const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';

    let uploadUri = asset.uri;
    let uploadWidth = asset.width;
    let uploadHeight = asset.height;

    try {
      if (!activeUserId || activeUserId === 'me') {
        const active = await getActiveUserId();
        if (active) activeUserId = active;
      }
      if (!activeUserId || activeUserId === 'me') {
        const profile = await api.getProfile().catch(() => null);
        if (profile?.user?.id) {
          activeUserId = profile.user.id;
          activeEmail = profile.user.email || activeEmail;
          setResolvedUserId(activeUserId);
          setResolvedUserEmail(activeEmail);
        }
      }
      if (!activeUserId) {
        activeUserId = sessionRef.current?.user?.id || 'me';
      }

      // Compress and optimize photo before upload to prevent slow networks from timing out
      if (!isVideo) {
        try {
          const manipActions: ImageManipulator.Action[] = [];
          const maxDim = 1600;
          if (asset.width > maxDim || asset.height > maxDim) {
            if (asset.width >= asset.height) {
              manipActions.push({ resize: { width: maxDim } });
            } else {
              manipActions.push({ resize: { height: maxDim } });
            }
          }
          const manipResult = await ImageManipulator.manipulateAsync(
            asset.uri,
            manipActions,
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
          );
          uploadUri = manipResult.uri;
          uploadWidth = manipResult.width;
          uploadHeight = manipResult.height;
        } catch (manipErr) {
          console.warn('[Media] Image optimization skipped, using original:', manipErr);
        }
      }

      const nowMs = Date.now();
      const lastMsg = messages[messages.length - 1];
      const lastMsgTime = lastMsg?.createdAt ? new Date(lastMsg.createdAt).getTime() : 0;
      const safeTime = Math.max(nowMs, isNaN(lastMsgTime) ? nowMs : lastMsgTime + 1);
      const optimisticCreatedAt = new Date(safeTime).toISOString();

      // Optimistically display local preview
      const optimisticMsg: SocketMessage = {
        _id: tempId,
        clientMessageId: tempId,
        conversationId,
        senderId: activeUserId,
        senderEmail: activeEmail,
        type: mediaType,
        content: '',
        fileUrl: uploadUri,
        isOutgoing: true,
        deliveryStatus: 'pending',
        readBy: activeUserId && activeUserId !== 'me' ? [activeUserId] : [],
        createdAt: optimisticCreatedAt,
      } as SocketMessage;

      setMessages((prev) => {
        if (prev.some((m) => m._id === tempId || m.clientMessageId === tempId)) {
          return prev;
        }
        return sortMessagesChronologically([...prev, optimisticMsg]);
      });
      isAtBottomRef.current = true;
      setShowScrollBottom(false);
      setNewMessagesBelow(0);
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToEnd({ animated: true });
        } catch { }
      }, 60);

      // Upload media to Cloudinary chatuk/MessageMedia folder
      const uploadRes = await api.uploadMedia({
        uri: uploadUri,
        name: asset.fileName || (isVideo ? `video_${Date.now()}.mp4` : `image_${Date.now()}.jpg`),
        type: isVideo ? (asset.mimeType || 'video/mp4') : 'image/jpeg',
      });

      const uploadedUrl = uploadRes.url;

      // Transmit message with secure Cloudinary URL in chatuk/MessageMedia folder
      await sendEncryptedMessage({
        conversationId,
        senderId: activeUserId,
        type: mediaType,
        fileUrl: uploadedUrl,
        clientMessageId: tempId,
        payload: {
          kind: mediaType,
          attachment: {
            url: uploadedUrl,
            key: '',
            size: uploadRes.bytes || asset.fileSize || 0,
            mime: isVideo ? (asset.mimeType || 'video/mp4') : 'image/jpeg',
            width: uploadRes.width || uploadWidth,
            height: uploadRes.height || uploadHeight,
            durationMs: uploadRes.duration
              ? Math.round(uploadRes.duration * 1000)
              : asset.duration
                ? Math.round(asset.duration * 1000)
                : undefined,
          },
          body: '',
          sentAt: Date.now(),
        },
      });
      if (!socketService.isSocketConnected()) {
        soundService.playSenderSoundForMessage(tempId);
      }

      // Immediately update local message state with the uploaded Cloudinary URL
      setMessages((prev) =>
        prev.map((m) =>
          m._id === tempId || m.clientMessageId === tempId
            ? { ...m, fileUrl: uploadedUrl }
            : m
        )
      );
    } catch (err: any) {
      console.warn('[Media] Attachment send failed:', err);
      await saveLocalMessage({
        clientMessageId: tempId,
        conversationId,
        senderId: activeUserId,
        senderDeviceId: 'me',
        type: mediaType,
        payload: {
          kind: mediaType,
          body: '',
          sentAt: Date.now(),
          attachment: {
            url: uploadUri,
            mime: isVideo ? 'video/mp4' : 'image/jpeg',
            size: asset.fileSize || 0,
            key: '',
          },
        },
        isOutgoing: true,
        deliveryStatus: 'failed',
      }).catch(() => { });
      await updateLocalMessageDeliveryStatus(tempId, 'failed', conversationId).catch(console.warn);
      setMessages((prev) =>
        prev.map((m) =>
          m._id === tempId || m.clientMessageId === tempId
            ? { ...m, deliveryStatus: 'failed' }
            : m
        )
      );
      showToast(err?.message || 'Could not send media message to database. Tap to retry.', { type: 'error' });
    } finally {
      setIsSending(false);
    }
  };

  // Transmit voice message recording to Cloudinary and send encrypted message
  const handleSendVoiceMessage = async (audioUri: string, durationSec: number) => {
    setIsSending(true);
    const tempId = `temp-${Date.now()}`;
    let activeUserId = currentUserId || currentUserIdRef.current || 'me';
    let activeEmail = currentUserEmail || currentUserEmailRef.current || '';

    try {
      if (!activeUserId || activeUserId === 'me') {
        const active = await getActiveUserId();
        if (active) activeUserId = active;
      }
      if (!activeUserId || activeUserId === 'me') {
        const profile = await api.getProfile().catch(() => null);
        if (profile?.user?.id) {
          activeUserId = profile.user.id;
          activeEmail = profile.user.email || activeEmail;
          setResolvedUserId(activeUserId);
          setResolvedUserEmail(activeEmail);
        }
      }
      if (!activeUserId) {
        activeUserId = sessionRef.current?.user?.id || 'me';
      }

      const nowMs = Date.now();
      const lastMsg = messages[messages.length - 1];
      const lastMsgTime = lastMsg?.createdAt ? new Date(lastMsg.createdAt).getTime() : 0;
      const safeTime = Math.max(nowMs, isNaN(lastMsgTime) ? nowMs : lastMsgTime + 1);
      const optimisticCreatedAt = new Date(safeTime).toISOString();

      // Optimistically display local audio bubble
      const optimisticMsg: SocketMessage = {
        _id: tempId,
        clientMessageId: tempId,
        conversationId,
        senderId: activeUserId,
        senderEmail: activeEmail,
        type: 'audio',
        content: '',
        fileUrl: audioUri,
        isOutgoing: true,
        deliveryStatus: 'pending',
        readBy: activeUserId && activeUserId !== 'me' ? [activeUserId] : [],
        createdAt: optimisticCreatedAt,
      } as SocketMessage;

      setMessages((prev) => {
        if (prev.some((m) => m._id === tempId || m.clientMessageId === tempId)) {
          return prev;
        }
        return sortMessagesChronologically([...prev, optimisticMsg]);
      });
      isAtBottomRef.current = true;
      setShowScrollBottom(false);
      setNewMessagesBelow(0);
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToEnd({ animated: true });
        } catch { }
      }, 60);

      // Upload audio to Cloudinary
      const uploadRes = await api.uploadMedia({
        uri: audioUri,
        name: `voice_${Date.now()}.m4a`,
        type: 'audio/m4a',
        folder: 'chatuk/VoiceMessages',
      });

      const uploadedUrl = getPlayableAudioUrl(uploadRes.url);

      // Transmit message with secure Cloudinary URL
      await sendEncryptedMessage({
        conversationId,
        senderId: activeUserId,
        type: 'audio',
        fileUrl: uploadedUrl,
        clientMessageId: tempId,
        payload: {
          kind: 'audio',
          attachment: {
            url: uploadedUrl,
            key: '',
            size: uploadRes.bytes || 0,
            mime: 'audio/m4a',
            durationMs: Math.round(durationSec * 1000),
          },
          body: '',
          sentAt: Date.now(),
        },
      });
      if (!socketService.isSocketConnected()) {
        soundService.playSenderSoundForMessage(tempId);
      }

      // Update local message state with uploaded Cloudinary URL
      setMessages((prev) =>
        prev.map((m) =>
          m._id === tempId || m.clientMessageId === tempId
            ? { ...m, fileUrl: uploadedUrl }
            : m
        )
      );
    } catch (err: any) {
      console.warn('[VoiceMessage] Send failed:', err);
      await saveLocalMessage({
        clientMessageId: tempId,
        conversationId,
        senderId: activeUserId,
        senderDeviceId: 'me',
        type: 'audio',
        payload: {
          kind: 'audio',
          body: '',
          sentAt: Date.now(),
          attachment: {
            url: audioUri,
            mime: 'audio/m4a',
            size: 0,
            key: '',
            durationMs: Math.round(durationSec * 1000),
          },
        },
        isOutgoing: true,
        deliveryStatus: 'failed',
      }).catch(() => { });
      await updateLocalMessageDeliveryStatus(tempId, 'failed', conversationId).catch(console.warn);
      setMessages((prev) =>
        prev.map((m) =>
          m._id === tempId || m.clientMessageId === tempId
            ? { ...m, deliveryStatus: 'failed' }
            : m
        )
      );
      showToast(err?.message || 'Could not send voice message to database. Tap to retry.', { type: 'error' });
    } finally {
      setIsSending(false);
    }
  };

  const recipientName = recipient?.name;

  // Opens fullscreen swipable gallery for all images in the conversation starting at the clicked image
  const handleOpenImageGallery = useCallback(
    (targetUrl: string) => {
      const mediaList: GalleryMediaItem[] = [];
      let foundIndex = 0;

      for (const msg of messages) {
        if (msg.fileUrl && isValidImageUri(msg.fileUrl)) {
          const isVideo = msg.type === 'video' || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(msg.fileUrl);
          if (!isVideo) {
            if (msg.fileUrl === targetUrl) {
              foundIndex = mediaList.length;
            }
            mediaList.push({
              id: msg._id || msg.clientMessageId || `media-${mediaList.length}`,
              url: msg.fileUrl,
              senderName: msg.isOutgoing ? 'You' : (recipientName || 'Contact'),
              createdAt: msg.createdAt,
            });
          }
        }
      }

      // Fallback if target wasn't found in current messages array
      if (mediaList.length === 0) {
        mediaList.push({
          id: 'fallback-0',
          url: targetUrl,
          senderName: 'You',
          createdAt: new Date().toISOString(),
        });
        foundIndex = 0;
      }

      setGalleryViewerState({
        visible: true,
        initialIndex: foundIndex,
        images: mediaList,
      });
    },
    [messages, recipientName]
  );

  // Handle client-side media selection (images and videos) & sending
  const handlePickAndSendMedia = async () => {
    if (isSending) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      await processAndSendMediaAsset(result.assets[0]);
    } catch (err: any) {
      console.error('[Media] Pick media error:', err);
      Alert.alert('Selection Error', err?.message || 'Could not select media file.');
    }
  };

  // Action sheet for attaching media (Gallery / Camera Photo / Camera Video)
  const handleMediaButtonPress = () => {
    Alert.alert('Attach Media', 'Choose an attachment to send in chat', [
      {
        text: 'Photo & Video Gallery',
        onPress: handlePickAndSendMedia,
      },
      {
        text: 'Take Photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission needed', 'Camera access is required to take photos.');
            return;
          }
          const res = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.8,
          });
          if (!res.canceled && res.assets && res.assets.length > 0) {
            await processAndSendMediaAsset(res.assets[0]);
          }
        },
      },
      {
        text: 'Record Video',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission needed', 'Camera access is required to record videos.');
            return;
          }
          const res = await ImagePicker.launchCameraAsync({
            mediaTypes: ['videos'],
            quality: 0.8,
          });
          if (!res.canceled && res.assets && res.assets.length > 0) {
            await processAndSendMediaAsset(res.assets[0]);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Open Safety Number Verification Modal
  const handleOpenSecurityModal = useCallback(() => {
    setShowSecurityModal(true);
  }, []);



  // Check if two timestamps belong to different calendar days
  const isDifferentDay = (dateStr1?: string, dateStr2?: string): boolean => {
    if (!dateStr1 || !dateStr2) return true;
    try {
      const d1 = new Date(dateStr1);
      const d2 = new Date(dateStr2);
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
      return (
        d1.getFullYear() !== d2.getFullYear() ||
        d1.getMonth() !== d2.getMonth() ||
        d1.getDate() !== d2.getDate()
      );
    } catch {
      return false;
    }
  };

  // Safe WhatsApp-style conversation & message date formatting without Hermes Intl locale crashes
  const formatConversationDate = useCallback((dateString?: string): string => {
    if (!dateString) return 'Today';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 'Today';
      const now = new Date();

      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();
      if (isToday) return 'Today';

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();
      if (isYesterday) return 'Yesterday';

      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 7 && diffDays >= 0) {
        return WEEKDAYS[d.getDay()] || 'Today';
      }

      if (d.getFullYear() === now.getFullYear()) {
        return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
      }

      return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
      return 'Today';
    }
  }, []);

  const firstConversationDate =
    messages.length > 0 && messages[0]?.createdAt
      ? formatConversationDate(messages[0].createdAt)
      : conversation?.createdAt
        ? formatConversationDate(conversation.createdAt)
        : 'Today';


  const renderMessageItem = useCallback(
    ({ item, index }: { item: SocketMessage; index: number }) => {
      const itemSenderId = String(item.senderId || '').trim();
      const itemSenderEmail = item.senderEmail ? item.senderEmail.toLowerCase().trim() : '';
      const myId = String(currentUserId || currentUserIdRef.current || '').trim();
      const myEmail = currentUserEmail
        ? currentUserEmail.toLowerCase().trim()
        : currentUserEmailRef.current
          ? currentUserEmailRef.current.toLowerCase().trim()
          : '';

      const recipientId = String(recipient?._id || '').trim();
      const recipientEmail = recipient?.email ? recipient.email.toLowerCase().trim() : '';

      let isMe = false;

      // 1. Explicit 'me' keyword (optimistic message created on this device)
      if (itemSenderId === 'me') {
        isMe = true;
      }
      // 2. Direct match with current user ID -> DEFINITIVELY ME (RIGHT / Sender) or NOT ME (LEFT / Receiver)
      else if (myId !== '' && itemSenderId !== '') {
        isMe = itemSenderId === myId;
      }
      // 3. Fallback email match with current user email
      else if (myEmail !== '' && itemSenderEmail !== '') {
        isMe = itemSenderEmail === myEmail;
      }
      // 4. Direct match with recipient in this 1-on-1 chat -> DEFINITIVELY NOT ME (LEFT / Receiver)
      else if (recipientId !== '' && itemSenderId !== '' && itemSenderId === recipientId) {
        isMe = false;
      }
      // 5. Recipient email match -> DEFINITIVELY NOT ME (LEFT / Receiver)
      else if (recipientEmail !== '' && itemSenderEmail !== '' && itemSenderEmail === recipientEmail) {
        isMe = false;
      }
      // 6. Explicit isOutgoing flag (from SQLite StoredMessage, server response, or optimistic send)
      else if (item.isOutgoing !== undefined) {
        isMe = item.isOutgoing === true || (item as any).isOutgoing === 1;
      }
      // 7. Fallback for optimistic temp message created on this device
      else if (item._id && typeof item._id === 'string' && item._id.startsWith('temp-')) {
        isMe = item.isOutgoing === true;
      } else {
        isMe = false;
      }

      // Show date divider if calendar day changes between sequential messages
      const showDateSeparator =
        index > 0 && isDifferentDay(messages[index - 1]?.createdAt, item.createdAt);
      const dateText = showDateSeparator ? formatConversationDate(item.createdAt) : null;

      const sender = conversation?.participants?.find((p) => p._id === item.senderId);
      const senderDisplayName = sender?.name || item.senderName || sender?.email?.split('@')[0] || 'Member';

      return (
        <MessageBubble
          key={item.clientMessageId || item._id || `msg-${index}`}
          item={item}
          isMe={isMe}
          showDateSeparator={showDateSeparator}
          dateText={dateText}
          recipientName={recipient?.name || recipient?.email}
          isGroupChat={isGroup}
          senderName={senderDisplayName}
          theme={theme}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          sessionUserName={session?.user?.name}
          onBubblePress={handleBubblePress}
          onBubbleLongPress={handleBubbleLongPress}
          onOpenImageGallery={handleOpenImageGallery}
          onActiveVideo={setActiveVideoUrl}
          onOpenSecurityModal={handleOpenSecurityModal}
          onToggleReaction={handleToggleReaction}
          onOpenReactionPicker={setActiveReactingMessage}
          isAnimatingHeart={animatingHeartMsgId === item._id}
          heartOpacityAnim={heartOpacityAnim}
          heartScaleAnim={heartScaleAnim}
          isAutoDownloadEnabled={isAutoDownloadEnabled}
          isMediaDownloaded={Boolean(
            (item._id && downloadedMediaIds.has(item._id)) ||
            (item.clientMessageId && downloadedMediaIds.has(item.clientMessageId))
          )}
          onDownloadMedia={async (msgId) => {
            setDownloadedMediaIds((prev) => new Set(prev).add(msgId));
          }}
          onRetryMessage={handleRetryMessage}
        />
      );
    },
    [
      messages,
      currentUserId,
      currentUserEmail,
      recipient,
      theme,
      session,
      handleBubblePress,
      handleBubbleLongPress,
      handleRetryMessage,
      handleOpenImageGallery,
      setActiveVideoUrl,
      handleOpenSecurityModal,
      handleToggleReaction,
      setActiveReactingMessage,
      animatingHeartMsgId,
      heartOpacityAnim,
      heartScaleAnim,
      formatConversationDate,
      conversation?.participants,
      isGroup,
      isAutoDownloadEnabled,
      downloadedMediaIds,
    ]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]} edges={['top', 'left', 'right']}>
      {/* ─── Top Navigation & Contact Header ─── */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.card,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={24} color={theme.onSurface} />
        </Pressable>

        {/* Contact Info Pill - Opens Conversation Settings Screen */}
        <Pressable
          onPress={() => router.push({ pathname: '/conversation/settings', params: { id: conversationId } })}
          style={({ pressed }) => [styles.headerProfile, pressed && styles.headerProfilePressed]}
          accessibilityLabel="Conversation settings"
          accessibilityRole="button"
        >
          <View style={styles.avatarWrapper}>
            {isGroup && !conversation?.groupAvatarUrl ? (
              <View
                style={[
                  styles.avatar,
                  styles.groupAvatarFallback,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                ]}
              >
                <Feather name="users" size={18} color={theme.primary} />
              </View>
            ) : (
              <Image
                source={getSafeImageSource(isGroup ? conversation?.groupAvatarUrl : recipient?.image)}
                style={[styles.avatar, { borderColor: theme.cardBorder }]}
                contentFit="cover"
              />
            )}
            {!isGroup && isRecipientOnline && (
              <View
                style={[
                  styles.onlineIndicator,
                  { backgroundColor: theme.online, borderColor: theme.card },
                ]}
              />
            )}
          </View>

          <View style={styles.contactDetails}>
            <View style={styles.nameRow}>
              <Text style={[styles.recipientName, { color: theme.onSurface }]} numberOfLines={1}>
                {isGroup ? (conversation?.name || 'Group') : (recipient?.name || recipient?.email || 'Conversation')}
              </Text>
            </View>
            <View style={styles.statusRow}>
              {isGroup ? (
                <Text style={[styles.statusText, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                  {groupSubtitle}
                </Text>
              ) : isSyncing ? (
                <>
                  <ActivityIndicator size="small" color={theme.primary} style={{ transform: [{ scale: 0.6 }], marginRight: 2 }} />
                  <Text style={[styles.statusText, { color: theme.primary }]}>Syncing...</Text>
                </>
              ) : isRecipientOnline ? (
                <>
                  <View
                    style={[
                      styles.pulsingDot,
                      { backgroundColor: theme.online },
                    ]}
                  />
                  <Text style={[styles.statusText, { color: theme.online }]}>Online</Text>
                </>
              ) : (
                <Text style={[styles.statusText, { color: theme.outline }]}>Offline</Text>
              )}
            </View>
          </View>

          <Feather name="chevron-right" size={16} color={theme.outline} style={{ marginLeft: 4, opacity: 0.6 }} />
        </Pressable>

        {/* Action Buttons */}
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleOpenSecurityModal}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
              pressed && styles.buttonPressed,
            ]}
            accessibilityLabel="Verify Security Code"
          >
            <Ionicons name="shield-checkmark-outline" size={18} color="#6366F1" />
          </Pressable>
          {!isGroup && (
            <Pressable
              onPress={() => {
                if (conversation?.status !== 'accepted') {
                  showToast('Calls are only available in accepted conversations', { type: 'error' });
                  return;
                }
                if (conversation?.isBlocked || conversation?.isBlockedBy) {
                  showToast('Cannot call this contact', { type: 'error' });
                  return;
                }
                if (!recipient?._id) return;
                initiateCall(recipient._id, conversationId, recipient.name, recipient.image);
              }}
              style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                pressed && styles.buttonPressed,
              ]}
              accessibilityLabel="Voice Call"
            >
              <Feather name="phone" size={18} color={theme.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ─── Message List Stream ─── */}
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Themed Wallpaper Background */}
        {wallpaperSource ? (
          <>
            <Image
              source={wallpaperSource}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: theme.isDark ? 'rgba(11, 19, 38, 0.35)' : 'rgba(255, 255, 255, 0.18)',
                },
              ]}
              pointerEvents="none"
            />
          </>
        ) : null}

        <View style={styles.messageListArea}>
          {isLoading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.loadingText, { color: theme.onSurfaceVariant }]}>
                Connecting to secure channel...
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
            data={messages}
            extraData={`${currentUserId || ''}_${recipient?._id || ''}_${messages.length}`}
            keyExtractor={(item) => item.clientMessageId || item._id || 'msg'}
            renderItem={renderMessageItem}
            maxToRenderPerBatch={10}
            windowSize={11}
            initialNumToRender={15}
            removeClippedSubviews={Platform.OS !== 'web'}
            contentContainerStyle={styles.messageListContent}
            onScrollBeginDrag={() => {
              isDraggingRef.current = true;
              userHasScrolledRef.current = true;
              isProgrammaticScrollRef.current = false;
            }}
            onScrollEndDrag={() => {
              isDraggingRef.current = false;
            }}
            onMomentumScrollBegin={() => {
              isMomentumScrollingRef.current = true;
              userHasScrolledRef.current = true;
              isProgrammaticScrollRef.current = false;
            }}
            onMomentumScrollEnd={() => {
              isMomentumScrollingRef.current = false;
            }}
            onContentSizeChange={(_w, _h) => {
              if (messages.length === 0) return;
              try {
                // Initial mount: automatically scroll to latest message once content size is measured
                if (!initialScrollDoneRef.current && !userHasScrolledRef.current) {
                  initialScrollDoneRef.current = true;
                  scrollToBottom(false);
                }
              } catch { }
            }}
            onLayout={() => {
              try {
                if (messages.length > 0 && !initialScrollDoneRef.current && !userHasScrolledRef.current) {
                  initialScrollDoneRef.current = true;
                  scrollToBottom(false);
                }
              } catch { }
            }}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.topSectionWrapper}>
                {/* Stitch Technical Glass End-to-End Encryption Notice */}
                <View
                  style={[
                    styles.encryptionBanner,
                    {
                      backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.08)' : 'rgba(99, 102, 241, 0.06)',
                      borderColor: theme.isDark ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.2)',
                    },
                  ]}
                >
                  <View style={styles.encryptionHeaderRow}>
                    <Feather
                      name="lock"
                      size={12}
                      color="#818CF8"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.encryptionTitle, { color: '#818CF8' }]}>
                      End-to-End Encrypted
                    </Text>
                  </View>
                  <Text style={[styles.encryptionSubtitle, { color: theme.isDark ? '#94A3B8' : '#64748B' }]}>
                    Messages and calls are end-to-end encrypted. No one outside of this chat can read them.
                  </Text>
                </View>

                {/* Conversation Date Section Chip */}
                <View style={styles.dateDividerContainer}>
                  <View
                    style={[
                      styles.dateDividerChip,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.dateDividerText, { color: theme.onSurfaceVariant }]}>
                      {firstConversationDate}
                    </Text>
                  </View>
                </View>
              </View>
            }
            ListFooterComponent={
              recipientTyping ? (
                <View style={styles.typingIndicatorRow}>
                  <View style={styles.miniAvatarContainer}>
                    <Image
                      source={getSafeImageSource(recipient?.image)}
                      style={styles.miniAvatar}
                      contentFit="cover"
                    />
                  </View>
                  <View
                    style={[
                      styles.typingBubble,
                      { backgroundColor: theme.card, borderColor: theme.cardBorder },
                    ]}
                  >
                    <Animated.View
                      style={[
                        styles.typingDot,
                        { backgroundColor: theme.primary, transform: [{ translateY: dot1Anim }] },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.typingDot,
                        { backgroundColor: theme.primary, transform: [{ translateY: dot2Anim }] },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.typingDot,
                        { backgroundColor: theme.primary, transform: [{ translateY: dot3Anim }] },
                      ]}
                    />
                  </View>
                  <Text style={[styles.typingText, { color: theme.outline }]}>
                    {recipientTyping} is typing...
                  </Text>
                </View>
              ) : undefined
            }
          />
        )}

        {/* ─── Floating Auto Scroll Down Button ─── */}
        <Animated.View
          style={[
            styles.scrollBottomContainer,
            {
              opacity: scrollButtonAnim,
              transform: [
                {
                  translateY: scrollButtonAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
                {
                  scale: scrollButtonAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.75, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents={showScrollBottom ? 'auto' : 'none'}
        >
          <Pressable
            onPress={() => scrollToBottom(true)}
            style={({ pressed }) => [
              styles.scrollBottomButton,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
                shadowColor: theme.isDark ? '#000000' : theme.primary,
              },
              pressed && styles.scrollButtonPressed,
            ]}
            hitSlop={8}
            accessibilityLabel="Scroll to bottom"
            accessibilityRole="button"
          >
            <View style={[styles.scrollIconWrap, { backgroundColor: theme.cardItem }]}>
              <Feather name="chevron-down" size={20} color={theme.primary} />
            </View>

            {newMessagesBelow > 0 && (
              <LinearGradient
                colors={theme.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.scrollBadge, { borderColor: theme.card }]}
              >
                <Text style={styles.scrollBadgeText}>
                  {newMessagesBelow > 99 ? '99+' : newMessagesBelow}
                </Text>
              </LinearGradient>
            )}
          </Pressable>
        </Animated.View>
      </View>

        {/* ─── Bottom Input Bar (or Blocked Notice) ─── */}
        {conversation?.isBlocked ? (
          <Pressable
            onPress={() => router.push({ pathname: '/conversation/settings', params: { id: conversationId } })}
            style={[
              styles.blockedNoticeBar,
              {
                backgroundColor: theme.card,
                borderTopColor: theme.cardBorder,
                paddingBottom: bottomGap,
              },
            ]}
          >
            <Feather name="slash" size={16} color="#EF4444" style={{ marginRight: 8 }} />
            <Text style={[styles.blockedNoticeText, { color: theme.onSurfaceVariant }]}>
              You have blocked this contact. Tap to manage in settings.
            </Text>
          </Pressable>
        ) : isPendingInvitation ? (
          <View
            style={[
              styles.invitationDecisionBar,
              {
                backgroundColor: theme.card,
                borderTopColor: theme.cardBorder,
                paddingBottom: bottomGap,
              },
            ]}
          >
            <View style={styles.invitationDecisionHeader}>
              <View style={[styles.invitationBadgeCircle, { backgroundColor: `${theme.primary}1A` }]}>
                <Feather name="mail" size={18} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.invitationDecisionTitle, { color: theme.onSurface }]}>
                  Chat Invitation
                </Text>
                <Text style={[styles.invitationDecisionSub, { color: theme.onSurfaceVariant }]}>
                  {recipient?.name || recipient?.email || 'This contact'} wants to message you. Accept to start chatting.
                </Text>
              </View>
            </View>

            <View style={styles.invitationDecisionActions}>
              <Pressable
                onPress={handleDeclineInvitation}
                disabled={isRespondingInvitation}
                style={({ pressed }) => [
                  styles.decisionDeclineBtn,
                  { borderColor: theme.cardBorder, backgroundColor: theme.cardItem },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Feather name="x" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                <Text style={styles.decisionDeclineText}>Decline & Delete</Text>
              </Pressable>

              <Pressable
                onPress={handleAcceptInvitation}
                disabled={isRespondingInvitation}
                style={({ pressed }) => [
                  styles.decisionAcceptBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <LinearGradient
                  colors={theme.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.decisionAcceptGradient}
                >
                  {isRespondingInvitation ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={17} color="#ffffff" style={{ marginRight: 6 }} />
                      <Text style={styles.decisionAcceptText}>Accept</Text>
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.bottomBar,
              {
                backgroundColor: theme.card,
                borderTopColor: theme.cardBorder,
                paddingBottom: bottomGap,
              },
            ]}
          >
            {/* Attachment Button */}
            <Pressable
              onPress={handleMediaButtonPress}
              style={({ pressed }) => [
                styles.attachButton,
                { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                pressed && styles.buttonPressed,
              ]}
              accessibilityLabel="Attach media"
            >
              <Feather name="plus" size={20} color={theme.primary} />
            </Pressable>

            {/* Text Input Container */}
            <View
              style={[
                styles.inputWrapper,
                {
                  backgroundColor: theme.cardItem,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  if (showInputEmojiPicker) {
                    setShowInputEmojiPicker(false);
                    textInputRef.current?.focus();
                  } else {
                    Keyboard.dismiss();
                    setShowInputEmojiPicker(true);
                  }
                }}
                style={({ pressed }) => [
                  styles.innerIconButton,
                  showInputEmojiPicker && { backgroundColor: theme.primary + '22', borderRadius: 16 },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityLabel="Insert Emoji"
              >
                <MaterialIcons
                  name={showInputEmojiPicker ? 'keyboard' : 'insert-emoticon'}
                  size={20}
                  color={showInputEmojiPicker ? theme.primary : theme.outline}
                />
              </Pressable>

              <TextInput
                ref={textInputRef}
                style={[styles.textInput, { color: theme.onSurface }]}
                placeholder="Type a message..."
                placeholderTextColor={theme.outline}
                value={inputText}
                onChangeText={handleInputChange}
                onFocus={() => setShowInputEmojiPicker(false)}
                multiline
                maxLength={1000}
              />
            </View>

            {/* Send / Voice Record Button */}
            {inputText.trim() ? (
              <Pressable
                onPress={handleSend}
                disabled={!inputText.trim() || isSending}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!inputText.trim() || isSending) && { opacity: 0.5 },
                  pressed && styles.buttonPressed,
                ]}
              >
                <LinearGradient
                  colors={theme.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sendGradient}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="send" size={17} color="#ffffff" style={{ marginLeft: 2 }} />
                  )}
                </LinearGradient>
              </Pressable>
            ) : (
              <VoiceRecordButton
                onRecordingComplete={(audioUri, durationSec) =>
                  handleSendVoiceMessage(audioUri, durationSec)
                }
                disabled={isPendingInvitation || conversation?.isBlocked || conversation?.isBlockedBy || isSending}
              />
            )}
          </View>
        )}

        {/* ─── Bottom Emoji Keyboard Panel ─── */}
        {showInputEmojiPicker && (
          <View style={[styles.bottomEmojiPickerContainer, { backgroundColor: theme.card }]}>
            <EmojiPicker
              onSelectEmoji={(emoji) => {
                setInputText((prev) => prev + emoji);
              }}
              onClose={() => setShowInputEmojiPicker(false)}
              columns={8}
              showSearch={true}
              showCategoryTabs={true}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ─── Video Player Modal ─── */}
      <VideoPlayerModal
        videoUrl={activeVideoUrl}
        onClose={() => setActiveVideoUrl(null)}
      />

      {/* ─── Image Viewer Modal (Multi-Image Swipable Gallery) ─── */}
      <ImageViewerModal
        visible={galleryViewerState.visible}
        initialIndex={galleryViewerState.initialIndex}
        images={galleryViewerState.images}
        onClose={() => setGalleryViewerState((prev) => ({ ...prev, visible: false }))}
      />

      {/* ─── Tap & Hold Reaction Bar Floating Modal ─── */}
      <Modal
        visible={!!activeReactingMessage}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setActiveReactingMessage(null);
          setShowEmojiPicker(false);
        }}
      >
        <Pressable
          style={styles.reactionModalBackdrop}
          onPress={() => {
            setActiveReactingMessage(null);
            setShowEmojiPicker(false);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.reactionModalContent}
          >
            <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', alignItems: 'center' }}>
              {/* Quick Reaction Bar */}
              <View
                style={[
                  styles.reactionBar,
                  {
                    backgroundColor: theme.isDark ? '#1E293B' : '#FFFFFF',
                    borderColor: theme.cardBorder,
                    shadowColor: theme.isDark ? '#000000' : theme.primary,
                  },
                ]}
              >
                {QUICK_EMOJIS.map((emoji) => {
                  const isSelected = activeReactingMessage?.reactions?.some(
                    (r) =>
                      r.emoji === emoji &&
                      (String(r.userId) === String(currentUserId || 'me') ||
                        (session?.user?.name && r.userName === session.user.name))
                  );
                  return (
                    <Pressable
                      key={emoji}
                      onPress={() => {
                        if (activeReactingMessage) {
                          handleToggleReaction(
                            activeReactingMessage,
                            emoji,
                            isSelected ? 'remove' : 'add'
                          );
                          setActiveReactingMessage(null);
                          setShowEmojiPicker(false);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.emojiButton,
                        isSelected && styles.emojiButtonSelected,
                        pressed && styles.buttonPressed,
                      ]}
                      hitSlop={4}
                    >
                      <Text style={styles.emojiText}>{emoji}</Text>
                    </Pressable>
                  );
                })}

                {/* Plus Button to open full Unicode EmojiPicker */}
                <Pressable
                  onPress={() => setShowEmojiPicker((prev) => !prev)}
                  style={({ pressed }) => [
                    styles.plusEmojiButton,
                    {
                      backgroundColor: showEmojiPicker ? theme.primary : theme.cardItem,
                      borderColor: theme.cardBorder,
                    },
                    pressed && styles.buttonPressed,
                  ]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Open emoji picker"
                >
                  <Feather
                    name={showEmojiPicker ? 'chevron-up' : 'plus'}
                    size={18}
                    color={showEmojiPicker ? '#FFFFFF' : theme.primary}
                  />
                </Pressable>

                {/* Info Button (WhatsApp-style Message Information) */}
                <Pressable
                  onPress={() => {
                    if (activeReactingMessage) {
                      const targetMsg = activeReactingMessage;
                      setActiveReactingMessage(null);
                      setShowEmojiPicker(false);
                      setMessageInfoTarget(targetMsg);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.infoMessageButton,
                    {
                      backgroundColor: theme.isDark ? 'rgba(56, 189, 248, 0.18)' : '#E0F2FE',
                      borderColor: theme.isDark ? 'rgba(56, 189, 248, 0.35)' : '#BAE6FD',
                    },
                    pressed && styles.buttonPressed,
                  ]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Message info"
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={theme.isDark ? '#38BDF8' : '#0284C7'}
                  />
                </Pressable>

                {/* Retry Button (if the message failed to send to database) */}
                {activeReactingMessage?.deliveryStatus === 'failed' && (
                  <Pressable
                    onPress={() => {
                      if (activeReactingMessage) {
                        const targetMsg = activeReactingMessage;
                        setActiveReactingMessage(null);
                        setShowEmojiPicker(false);
                        handleRetryMessage(targetMsg);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.deleteMessageButton,
                      {
                        backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.18)' : '#EEF2FF',
                        borderColor: theme.isDark ? 'rgba(99, 102, 241, 0.35)' : '#C7D2FE',
                        marginRight: 8,
                      },
                      pressed && styles.buttonPressed,
                    ]}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel="Retry sending message"
                  >
                    <Ionicons name="refresh" size={17} color="#6366F1" />
                  </Pressable>
                )}

                {/* Delete Button (if the message was sent by the current user) */}
                {isMessageFromMe(activeReactingMessage) && (
                  <Pressable
                    onPress={() => {
                      if (activeReactingMessage) {
                        const targetMsg = activeReactingMessage;
                        setActiveReactingMessage(null);
                        setShowEmojiPicker(false);
                        handleConfirmDeleteMessage(targetMsg);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.deleteMessageButton,
                      {
                        backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.18)' : '#FEE2E2',
                        borderColor: theme.isDark ? 'rgba(239, 68, 68, 0.35)' : '#FECACA',
                      },
                      pressed && styles.buttonPressed,
                    ]}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel="Delete message"
                  >
                    <Ionicons name="trash-outline" size={17} color="#EF4444" />
                  </Pressable>
                )}
              </View>

              {/* Full Unicode Emoji Picker with gemoji dataset */}
              {showEmojiPicker && (
                <View style={styles.emojiPickerWrapper}>
                  <EmojiPicker
                    onSelectEmoji={(emoji) => {
                      if (activeReactingMessage) {
                        handleToggleReaction(activeReactingMessage, emoji, 'add');
                        setShowEmojiPicker(false);
                        setActiveReactingMessage(null);
                      }
                    }}
                    onClose={() => setShowEmojiPicker(false)}
                    columns={8}
                    showSearch={true}
                    showCategoryTabs={true}
                  />
                </View>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* ─── Safety Number Verification Modal ─── */}
      <SecurityCodeModal
        visible={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
        contactUserId={recipient?._id}
        contactName={recipient?.name || 'Contact'}
      />

      {/* ─── WhatsApp-style Message Info Modal ─── */}
      <MessageInfoModal
        visible={!!messageInfoTarget}
        onClose={() => setMessageInfoTarget(null)}
        message={messageInfoTarget}
        conversation={conversation}
        recipient={recipient}
        currentUserId={currentUserId}
        currentUserEmail={currentUserEmail}
        sessionUserName={session?.user?.name}
        theme={theme}
        isGroupChat={isGroup}
      />
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  buttonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  headerProfile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
  },
  groupAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  contactDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recipientName: {
    fontSize: 16,
    fontWeight: '700',
    maxWidth: '85%',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardContainer: {
    flex: 1,
  },
  messageListArea: {
    flex: 1,
    position: 'relative',
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  messageListContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingBottom: 20,
  },
  topSectionWrapper: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 8,
  },
  encryptionBanner: {
    maxWidth: '92%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 8,
  },
  encryptionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  encryptionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  encryptionSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
    fontWeight: '400',
  },
  dateDividerContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  dateDividerChip: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  dateDividerText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  messageRow: {
    marginVertical: 4,
    flexDirection: 'row',
    width: '100%',
  },
  messageRowSent: {
    justifyContent: 'flex-end',
  },
  messageRowReceived: {
    justifyContent: 'flex-start',
  },
  sentContainer: {
    maxWidth: '82%',
    alignItems: 'flex-end',
  },
  sentBubble: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 3,
  },
  sentText: {
    color: '#F8FAFC',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  sentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginRight: 4,
  },
  receivedContainer: {
    maxWidth: '82%',
    alignItems: 'flex-start',
  },
  receivedSenderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    marginLeft: 4,
    gap: 5,
  },
  receivedSenderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0EA5E9',
  },
  receivedSenderName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0EA5E9',
    letterSpacing: 0.2,
  },
  receivedBubble: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  receivedText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  receivedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginLeft: 4,
  },
  timeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  typingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  miniAvatarContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  miniAvatar: {
    width: 24,
    height: 24,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    gap: 4,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  typingText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 10,
    minHeight: 46,
  },
  innerIconButton: {
    padding: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    paddingHorizontal: 6,
    maxHeight: 120,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
  },
  sendGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollBottomContainer: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    zIndex: 20,
    elevation: 6,
  },
  scrollBottomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 6,
  },
  scrollButtonPressed: {
    transform: [{ scale: 0.9 }],
    opacity: 0.85,
  },
  scrollIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 19,
    height: 19,
    borderRadius: 9.5,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  scrollBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 12,
  },
  headerProfilePressed: {
    opacity: 0.7,
  },
  sentPressable: {
    alignItems: 'flex-end',
  },
  receivedPressable: {
    alignItems: 'flex-start',
  },
  bubblePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  heartBurstOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: -8,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  reactionPillSent: {
    alignSelf: 'flex-end',
    marginRight: 8,
  },
  reactionPillReceived: {
    alignSelf: 'flex-start',
    marginLeft: 8,
  },
  reactionEmojisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  reactionEmojiText: {
    fontSize: 13,
  },
  reactionCountText: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 2,
  },
  blockedNoticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 14,
    paddingHorizontal: 20,
    borderTopWidth: 1,
  },
  blockedNoticeText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  reactionModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  reactionModalContent: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 390,
  },
  reactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 32,
    borderWidth: 1,
    gap: 4,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  emojiButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiButtonSelected: {
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    transform: [{ scale: 1.15 }],
  },
  emojiText: {
    fontSize: 20,
  },
  plusEmojiButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 2,
  },
  infoMessageButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 2,
  },
  deleteMessageButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  emojiPickerWrapper: {
    marginTop: 12,
    width: '100%',
  },
  systemNoticeRow: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  systemNoticeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: '90%',
  },
  systemNoticeText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  bubbleMediaWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  bubbleMediaImage: {
    width: 220,
    height: 180,
    borderRadius: 12,
  },
  bubbleVideoContainer: {
    position: 'relative',
    width: 220,
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 6,
  },
  videoBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Bold',
    letterSpacing: 0.5,
  },
  bottomEmojiPickerContainer: {
    height: 280,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150, 150, 150, 0.2)',
  },
  fullScreenMediaBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenHeaderBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  galleryMetaInfo: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 12,
  },
  gallerySenderText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  galleryCounterText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  galleryNavArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(30, 30, 30, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  galleryDotsContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 10,
  },
  galleryDot: {
    height: 6,
    borderRadius: 3,
  },
  galleryDotActive: {
    width: 20,
    backgroundColor: '#6366F1',
  },
  galleryDotInactive: {
    width: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  fullScreenCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(40, 40, 40, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenVideoView: {
    width: '100%',
    height: '100%',
  },
  expoGoVideoBanner: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 16,
    maxWidth: 300,
  },
  expoGoVideoTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  expoGoVideoSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  fullScreenImageView: {
    width: '100%',
    height: '100%',
  },
  securityModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  securityModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  securityModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  securityShieldBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  securityModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  securityModalSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  safetyNumberContainer: {
    width: '100%',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    alignItems: 'center',
  },
  safetyNumberText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
    lineHeight: 24,
    textAlign: 'center',
  },
  securityModalActions: {
    width: '100%',
    gap: 10,
  },
  securityVerifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: 12,
  },
  securityVerifyButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  securityCloseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  securityCloseButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  invitationDecisionBar: {
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  invitationDecisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  invitationBadgeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitationDecisionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  invitationDecisionSub: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  invitationDecisionActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  decisionDeclineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  decisionDeclineText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  decisionAcceptBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    overflow: 'hidden',
  },
  decisionAcceptGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  decisionAcceptText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

