import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSession } from '../lib/auth-client';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { api, getSessionAuth, clearSessionAuth, getActiveUserId, isLoggingOutState } from '../lib/api';
import { appStorage } from '../lib/storage';
import { socketService } from '../services/socket';
import {
  getConversationSnippets,
  deleteLocalConversation,
  deleteLocalMessage,
  purgeNonPendingLocalMessages,
  getLatestLocalMessages,
  getCachedConversations,
  upsertCachedConversation,
  upsertCachedConversationsBatch,
  updateCachedConversationMetadata,
  deleteCachedConversation,
} from '../e2ee/localDb';
import { processIncomingMessage, registerCurrentDevice } from '../e2ee/messageService';
import { soundService } from '../services/soundService';
import { getSafeImageSource } from '../utils/image';
import { useToast } from '../components/Toast';
import CreateGroupModal, { ContactItem } from '../components/CreateGroupModal';

interface Participant {
  _id: string;
  name: string;
  email: string;
  image: string | null;
  isOnline?: boolean;
  lastActiveAt?: string | null;
}

interface LastMessage {
  _id: string;
  senderId: string;
  type: string;
  content: string;
  createdAt: string;
}

interface ConversationItem {
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
  lastMessage: LastMessage | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

const ACTION_WIDTH = 84;

interface SwipeableChatCardProps {
  conv: ConversationItem;
  name: string;
  avatarUri?: string | null;
  lastMsg: string;
  timeStr: string;
  isContactOnline: boolean;
  unread: number;
  theme: any;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPress: () => void;
  onDeletePress: (conv: ConversationItem) => void;
}

function SwipeableChatCard({
  conv,
  name,
  avatarUri,
  lastMsg,
  timeStr,
  isContactOnline,
  unread,
  theme,
  isOpen,
  onOpen,
  onClose,
  onPress,
  onDeletePress,
}: SwipeableChatCardProps) {
  const [translateX] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: isOpen ? -ACTION_WIDTH : 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 16,
    }).start();
  }, [isOpen, translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          const { dx, dy } = gestureState;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          if (isOpen) {
            return (dx > 8 || absDx > 8) && absDx > absDy * 0.55;
          }

          // Accommodate diagonal-left swipes (up to ~61° from horizontal)
          // while preserving smooth vertical list scrolling
          return dx < -8 && absDx > absDy * 0.55;
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const { dx, dy } = gestureState;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          if (isOpen) {
            return (dx > 8 || absDx > 8) && absDx > absDy * 0.55;
          }

          return dx < -8 && absDx > absDy * 0.55;
        },
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderMove: (_, gestureState) => {
          const startX = isOpen ? -ACTION_WIDTH : 0;
          let nextX = startX + gestureState.dx;
          if (nextX > 0) {
            nextX = nextX * 0.15; // smooth rubber band when dragged right past zero
          } else if (nextX < -ACTION_WIDTH - 20) {
            nextX = -ACTION_WIDTH - 20 + (nextX + ACTION_WIDTH + 20) * 0.2;
          }
          translateX.setValue(nextX);
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dx, vx, vy } = gestureState;
          const speed = Math.sqrt(vx * vx + vy * vy);

          if (isOpen) {
            // Drag or flick right to close card
            const shouldClose =
              dx > 24 ||
              vx > 0.3 ||
              (dx > 14 && (vx > 0.2 || speed > 0.32));

            if (shouldClose) {
              onClose();
              Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: true,
                bounciness: 4,
                speed: 16,
              }).start();
            } else {
              Animated.spring(translateX, {
                toValue: -ACTION_WIDTH,
                useNativeDriver: true,
                bounciness: 4,
                speed: 16,
              }).start();
            }
          } else {
            // Drag or flick left to open delete button:
            // Tolerates diagonal moves and gentle flicks
            const shouldOpen =
              dx < -26 ||
              vx < -0.3 ||
              (dx < -15 && (vx < -0.2 || speed > 0.32));

            if (shouldOpen) {
              onOpen();
              Animated.spring(translateX, {
                toValue: -ACTION_WIDTH,
                useNativeDriver: true,
                bounciness: 4,
                speed: 16,
              }).start();
            } else {
              Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: true,
                bounciness: 4,
                speed: 16,
              }).start();
            }
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: isOpen ? -ACTION_WIDTH : 0,
            useNativeDriver: true,
            bounciness: 4,
            speed: 16,
          }).start();
        },
      }),
    [translateX, isOpen, onOpen, onClose]
  );

  const handleCardPress = () => {
    if (isOpen) {
      onClose();
    } else {
      onPress();
    }
  };

  return (
    <View style={[styles.swipeContainer, isOpen && { zIndex: 20 }]}>
      {/* Background action row: revealed when dragged left */}
      <View style={styles.swipeActionBehind}>
        <Pressable
          onPress={() => {
            onClose();
            onDeletePress(conv);
          }}
          style={({ pressed }) => [
            styles.swipeDeleteButton,
            pressed && { opacity: 0.8 },
          ]}
          hitSlop={8}
        >
          <View style={styles.swipeDeleteIconWrap}>
            <Feather name="trash-2" size={20} color="#ffffff" />
          </View>
          <Text style={styles.swipeDeleteText}>Delete</Text>
        </Pressable>
      </View>

      {/* Front sliding card */}
      <Animated.View
        style={[
          styles.swipeFrontCard,
          {
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={handleCardPress}
          style={({ pressed }) => [
            styles.chatCard,
            {
              backgroundColor: pressed ? theme.cardItem : theme.card,
              borderColor: theme.cardBorder,
              marginBottom: 0,
            },
          ]}
        >
          <View style={styles.avatarContainer}>
            {conv.type === 'group' && !avatarUri ? (
              <View
                style={[
                  styles.chatAvatar,
                  styles.groupAvatarFallback,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                ]}
              >
                <Feather name="users" size={22} color={theme.primary} />
              </View>
            ) : (
              <Image
                source={getSafeImageSource(avatarUri)}
                style={[styles.chatAvatar, { backgroundColor: theme.cardItem }]}
                contentFit="cover"
              />
            )}
            {conv.type !== 'group' && isContactOnline && (
              <View
                style={[
                  styles.chatOnlineIndicator,
                  { backgroundColor: theme.online, borderColor: theme.card },
                ]}
              />
            )}
          </View>

          <View style={styles.chatDetails}>
            <View style={styles.chatRowTop}>
              <View style={styles.nameRow}>
                <Text style={[styles.chatName, { color: theme.onSurface }]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <Text style={[styles.chatTime, { color: theme.outline }]}>{timeStr}</Text>
            </View>

            <View style={styles.chatRowBottom}>
              <Text
                style={[
                  styles.chatMessage,
                  { color: unread > 0 ? theme.onSurface : theme.onSurfaceVariant },
                  unread > 0 && styles.chatMessageUnread,
                ]}
                numberOfLines={1}
              >
                {lastMsg}
              </Text>
              {unread > 0 && (
                <View
                  style={[
                    styles.unreadBadge,
                    { backgroundColor: theme.primary },
                  ]}
                >
                  <Text style={styles.unreadText}>{unread}</Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { theme } = useTheme();

  const [conversations, setConversations] = useState<ConversationItem[]>(() => {
    try {
      const cached = appStorage.getItem('chatuk_cached_conversations');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {}
    return [];
  });
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [resolvedUserEmail, setResolvedUserEmail] = useState<string | null>(null);
  const currentUserId = resolvedUserId || session?.user?.id || null;
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = appStorage.getItem('chatuk_cached_conversations');
      return !cached || JSON.parse(cached).length === 0;
    } catch {}
    return true;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  // New Chat Modal state
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isCreateGroupModalVisible, setIsCreateGroupModalVisible] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Memoized contacts from existing conversations for Create Group modal
  const availableGroupContacts: ContactItem[] = useMemo(() => {
    const idMap = new Map<string, ContactItem>();
    const emailSet = new Set<string>();
    const myId = currentUserId;
    const myEmail = (resolvedUserEmail || session?.user?.email || '').toLowerCase();

    for (const conv of conversations) {
      for (const p of conv.participants || []) {
        if (!p || !p._id) continue;
        const pEmail = (p.email || '').toLowerCase();
        const isMe =
          Boolean(myId && (p._id === myId || String(p._id) === String(myId))) ||
          Boolean(myEmail && pEmail && pEmail === myEmail);

        if (isMe) continue;
        if (idMap.has(p._id)) continue;
        if (pEmail && emailSet.has(pEmail)) continue;

        idMap.set(p._id, {
          _id: p._id,
          name: p.name || (pEmail ? pEmail.split('@')[0] : 'Contact'),
          email: p.email || '',
          image: p.image || null,
        });
        if (pEmail) emailSet.add(pEmail);
      }
    }
    return Array.from(idMap.values());
  }, [conversations, currentUserId, resolvedUserEmail, session?.user?.email]);

  // Chat Invitations state
  const [respondingConvId, setRespondingConvId] = useState<string | null>(null);
  const [showInvitations, setShowInvitations] = useState(true);

  // Delete Conversation Confirmation state
  const [deleteTargetConv, setDeleteTargetConv] = useState<ConversationItem | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const { showToast } = useToast();


  // Redirect if unauthenticated -> navigate directly to home / welcome page
  useEffect(() => {
    let isMounted = true;
    const checkAuth = async () => {
      // If an intentional logout is already underway, do NOT fire duplicate redirects
      if (isLoggingOutState()) return;

      if (!isPending && !session) {
        // Double-check if stored session credentials exist before redirecting
        const { token, cookie } = await getSessionAuth();
        const rememberMe = await appStorage.getItemAsync('chatuk_remember_me');
        if (!token && !cookie && rememberMe !== 'true' && isMounted && !isLoggingOutState()) {
          await clearSessionAuth().catch(() => {});
          router.replace('/');
        }
      }
    };
    checkAuth();
    return () => {
      isMounted = false;
    };
  }, [session, isPending, router]);

  // Fast offline cold-start: hydrate from SQLite cache immediately on mount
  useEffect(() => {
    let isMounted = true;

    async function hydrateFromSqlite() {
      const activeUid =
        resolvedUserId ||
        session?.user?.id ||
        (await getActiveUserId().catch(() => null));
      if (!activeUid) return;

      try {
        const cached = await getCachedConversations(activeUid);
        if (isMounted && cached && cached.length > 0) {
          setConversations(cached);
          setIsLoading(false); // Immediate display: removes spinner
        }
      } catch (err) {
        console.warn('[ChatsScreen] Error hydrating from SQLite cache:', err);
      }
    }

    hydrateFromSqlite();

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, resolvedUserId]);

  // Load conversations from backend (guarded against duplicate instant fetches on startup)
  const isFetchingRef = useRef(false);
  const lastFetchedRef = useRef(0);

  const loadConversations = useCallback(async (force = false) => {
    if (isLoggingOutState()) return;
    const now = Date.now();
    if (!force && isFetchingRef.current) return;
    if (!force && now - lastFetchedRef.current < 2500) return;
    isFetchingRef.current = true;
    lastFetchedRef.current = now;

    try {
      const res = await api.getConversations();
      if (res?.currentUserId) {
        setResolvedUserId(res.currentUserId);
      }
      if (res?.currentUserEmail) {
        setResolvedUserEmail(res.currentUserEmail);
      }
      if (res?.conversations) {
        // Fetch latest messages from SQLite to ensure decrypted snippets are instantly shown
        const [localSnippets, latestLocalMsgs] = await Promise.all([
          getConversationSnippets().catch(() => new Map()),
          getLatestLocalMessages().catch(() => new Map()),
        ]);

        const enriched = res.conversations.map((c: ConversationItem) => {
          if (!c.lastMessage) {
            // Server explicitly indicates no messages remain in this conversation
            purgeNonPendingLocalMessages(c._id).catch(() => {});
            return {
              ...c,
              lastMessage: null,
            };
          }

          const localMsg = latestLocalMsgs.get(c._id);
          const snip = localSnippets.get(c._id);

          let bestSnippet = c.lastMessage?.content || '';
          let bestTime = c.lastMessage?.createdAt || c.updatedAt;
          let bestType = c.lastMessage?.type || 'text';
          let bestSenderId = c.lastMessage?.senderId || '';

          if (localMsg) {
            bestSnippet = localMsg.snippet || bestSnippet;
            if (localMsg.createdAt) {
              bestTime = new Date(localMsg.createdAt).toISOString();
            }
            bestType = localMsg.type || bestType;
          } else if (snip) {
            bestSnippet = snip.lastMessageSnippet || bestSnippet;
            if (snip.lastMessageTimestamp) {
              const d = new Date(snip.lastMessageTimestamp);
              if (!isNaN(d.getTime())) {
                bestTime = d.toISOString();
              }
            }
          }

          if (!bestSnippet) {
            if (bestType === 'image') bestSnippet = '📷 Photo';
            else if (bestType === 'video') bestSnippet = '🎥 Video';
            else if (bestType === 'audio') bestSnippet = '🎤 Voice message';
          }

          return {
            ...c,
            lastMessage: {
              _id: c.lastMessage?._id || localMsg?.clientMessageId || snip?.lastMessageId || '',
              senderId: bestSenderId,
              type: bestType,
              content: bestSnippet,
              createdAt: bestTime,
            },
          };
        });

        setConversations(enriched);
        appStorage.setItem('chatuk_cached_conversations', JSON.stringify(enriched));

        // Persist fresh conversations batch to SQLite
        const activeUid =
          res?.currentUserId ||
          resolvedUserId ||
          session?.user?.id ||
          (await getActiveUserId().catch(() => null));
        if (activeUid) {
          await upsertCachedConversationsBatch(enriched, activeUid).catch((err) =>
            console.warn('[Chats] Failed to batch save conversations to SQLite:', err)
          );
        }

        // Synchronously cache conversations & recipient previews for instant zero-latency loading
        for (const c of enriched) {
          if (res?.currentUserId) {
            appStorage.setItem(`chatuk_${res.currentUserId}_conv_${c._id}`, JSON.stringify(c));
          }
          appStorage.setItem(`chatuk_conv_${c._id}`, JSON.stringify(c));
          const other = c.participants?.find((p: any) => p._id !== res.currentUserId);
          if (other) {
            if (res?.currentUserId) {
              appStorage.setItem(`chatuk_${res.currentUserId}_recipient_${c._id}`, JSON.stringify(other));
            }
            appStorage.setItem(`chatuk_recipient_${c._id}`, JSON.stringify(other));
          }
        }

        // Pre-populate online users from backend status
        const initialOnline = new Set<string>();
        for (const c of res.conversations) {
          for (const p of c.participants || []) {
            if (p?.isOnline) {
              initialOnline.add(p._id);
            }
          }
        }
        setOnlineUserIds(initialOnline);
      }
    } catch (err: any) {
      console.error('Failed to fetch conversations:', err);
      if (err?.message?.includes('Authentication required') || err?.message?.includes('401')) {
        if (isLoggingOutState()) return;
        await clearSessionAuth().catch(() => {});
        router.replace('/');
        return;
      }

      // Network failure / Offline fallback: hydrate from SQLite cache
      const activeUid =
        resolvedUserId ||
        session?.user?.id ||
        (await getActiveUserId().catch(() => null));
      if (activeUid) {
        const localCached = await getCachedConversations(activeUid).catch(() => []);
        if (localCached.length > 0) {
          setConversations(localCached);
        }
      }
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [router, resolvedUserId, session]);

  // Reload conversations & request latest online user list whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (isLoggingOutState() || !session) return;
      loadConversations(true);
      socketService.requestOnlineUsers();
    }, [loadConversations, session])
  );

  // Connect socket and register real-time listeners on mount
  useEffect(() => {
    if (!session) return;

    let unsubscribeUpdate: (() => void) | undefined;
    let unsubscribeNewMessage: (() => void) | undefined;
    let unsubscribeOnlineList: (() => void) | undefined;
    let unsubscribeStatus: (() => void) | undefined;
    let unsubscribeRead: (() => void) | undefined;
    let unsubscribeAccepted: (() => void) | undefined;
    let unsubscribeDeleted: (() => void) | undefined;
    let unsubscribeMsgDeleted: (() => void) | undefined;
    let unsubscribeGroupCreated: (() => void) | undefined;
    let unsubscribeGroupUpdated: (() => void) | undefined;
    let unsubscribeGroupMemberRemoved: (() => void) | undefined;
    let unsubscribeGroupMemberLeft: (() => void) | undefined;

    const initSocketConnection = async () => {
      // Proactively ensure device keys are registered on the backend
      registerCurrentDevice().catch((e) => console.warn('[E2EE] Device registration notice in chats:', e));

      await socketService.connect();

      // Listen for initial or refreshed list of active online users
      unsubscribeOnlineList = socketService.onOnlineUsersList((ids) => {
        setOnlineUserIds(new Set(ids));
      });

      // Listen for real-time user online/offline status changes
      unsubscribeStatus = socketService.onUserStatusChanged(({ userId, isOnline }) => {
        setOnlineUserIds((prev) => {
          const updated = new Set(prev);
          if (isOnline) {
            updated.add(userId);
          } else {
            updated.delete(userId);
          }
          return updated;
        });
      });

      // Listen for messages read events (clear unread badge instantly)
      unsubscribeRead = socketService.onMessagesRead(async ({ conversationId }) => {
        setConversations((prev) =>
          prev.map((c) => (c._id === conversationId ? { ...c, unreadCount: 0 } : c))
        );
        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid) {
          await updateCachedConversationMetadata(conversationId, activeUid, { unreadCount: 0 }).catch(() => {});
        }
      });

      // Listen for conversation accepted events
      unsubscribeAccepted = socketService.onConversationAccepted(async ({ conversationId }) => {
        setConversations((prev) =>
          prev.map((c) => (c._id === conversationId ? { ...c, status: 'accepted' } : c))
        );
        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid) {
          await updateCachedConversationMetadata(conversationId, activeUid, { status: 'accepted' }).catch(() => {});
        }
      });

      // Listen for conversation deleted / denied events
      unsubscribeDeleted = socketService.onConversationDeleted(async ({ conversationId }) => {
        setConversations((prev) => prev.filter((c) => c._id !== conversationId));
        await deleteLocalConversation(conversationId);
        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid) {
          await deleteCachedConversation(conversationId, activeUid).catch(() => {});
        }
      });

      // Listen for conversation updates (new messages in any room)
      unsubscribeUpdate = socketService.onConversationUpdated(async ({ conversationId, lastMessage, action }) => {
        const effectiveId = resolvedUserId || session?.user?.id;
        const isFromMe = Boolean(
          (effectiveId && lastMessage?.senderId === effectiveId) ||
          (session?.user?.id && lastMessage?.senderId === session.user.id)
        );

        let updatedItem: ConversationItem | null = null;

        setConversations((prev) => {
          const index = prev.findIndex((c) => c._id === conversationId);
          if (index !== -1) {
            const updated = [...prev];
            const item = { ...updated[index] };
            const isNewIncomingMessage =
              action !== 'message_deleted' &&
              !isFromMe &&
              Boolean(lastMessage?._id && item.lastMessage?._id !== lastMessage._id);

            let displaySnippet = lastMessage ? (lastMessage.content || item.lastMessage?.content || '') : '';
            if (action === 'message_deleted' && !lastMessage) {
              item.lastMessage = null;
            } else if (lastMessage) {
              if (!displaySnippet && lastMessage.type === 'image') {
                displaySnippet = '📷 Photo';
              } else if (!displaySnippet && lastMessage.type === 'video') {
                displaySnippet = '🎥 Video';
              } else if (!displaySnippet && lastMessage.type === 'audio') {
                displaySnippet = '🎤 Voice message';
              }
              item.lastMessage = {
                _id: lastMessage._id,
                senderId: lastMessage.senderId,
                type: lastMessage.type,
                content: displaySnippet,
                createdAt: lastMessage.createdAt,
              };
              item.updatedAt = lastMessage.createdAt;
            }

            if (isNewIncomingMessage) {
              item.unreadCount = (item.unreadCount || 0) + 1;
            } else if (isFromMe) {
              item.unreadCount = 0;
            }

            updatedItem = item;
            // Bump to top
            updated.splice(index, 1);
            const nextList = [item, ...updated];
            appStorage.setItem('chatuk_cached_conversations', JSON.stringify(nextList));
            return nextList;
          } else {
            // New conversation created by another user, refresh list
            loadConversations(true);
            return prev;
          }
        });

        const activeUid = effectiveId || (await getActiveUserId().catch(() => null));
        if (activeUid && updatedItem) {
          await upsertCachedConversation(updatedItem, activeUid).catch(() => {});
        }
      });

      // Also refresh on direct new messages if user is in chat list (decrypt encrypted preview)
      unsubscribeNewMessage = socketService.onNewMessage(async (newMsg) => {
        let snippetText = newMsg.content || '';
        if (newMsg.encrypted && newMsg.envelope) {
          try {
            const decrypted = await processIncomingMessage({
              message: newMsg,
              envelope: newMsg.envelope,
            });
            if (decrypted) {
              if (decrypted.kind === 'text') {
                snippetText = decrypted.body || '';
              } else if (decrypted.kind === 'image') {
                snippetText = '📷 Photo';
              } else if (decrypted.kind === 'video') {
                snippetText = '🎥 Video';
              }
            }
          } catch (decryptErr) {
            console.warn('[E2EE] Could not decrypt incoming snippet in chats:', decryptErr);
          }
        }

        if (!snippetText) {
          if (newMsg.type === 'image') snippetText = '📷 Photo';
          else if (newMsg.type === 'video') snippetText = '🎥 Video';
        }

        let updatedItem: ConversationItem | null = null;

        setConversations((prev) => {
          const index = prev.findIndex((c) => c._id === newMsg.conversationId);
          if (index !== -1) {
            const updated = [...prev];
            const item = { ...updated[index] };
            item.lastMessage = {
              _id: newMsg._id,
              senderId: newMsg.senderId,
              type: newMsg.type,
              content: snippetText || item.lastMessage?.content || '',
              createdAt: newMsg.createdAt,
            };
            item.updatedAt = newMsg.createdAt;
            updatedItem = item;
            // unreadCount is handled solely and accurately by onConversationUpdated
            updated.splice(index, 1);
            const nextList = [item, ...updated];
            appStorage.setItem('chatuk_cached_conversations', JSON.stringify(nextList));
            return nextList;
          } else {
            loadConversations(true);
            return prev;
          }
        });

        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid && newMsg.senderId !== activeUid) {
          soundService.playReceiverSoundForMessage(newMsg._id || newMsg.clientMessageId);
        }
        if (activeUid && updatedItem) {
          await upsertCachedConversation(updatedItem, activeUid).catch(() => {});
        }
      });

      // Listen for message deleted events in real-time
      unsubscribeMsgDeleted = socketService.onMessageDeleted(async ({ conversationId, messageId, clientMessageId }) => {
        await deleteLocalMessage(conversationId, messageId, clientMessageId).catch(() => {});
        const latestMsgs = await getLatestLocalMessages().catch(() => new Map());
        const localMsg = latestMsgs.get(conversationId);

        let targetConv: ConversationItem | null = null;

        setConversations((prev) => {
          const next = prev.map((c) => {
            if (c._id === conversationId) {
              if (
                c.lastMessage?._id === messageId ||
                c.lastMessage?._id === clientMessageId ||
                !c.lastMessage?.content
              ) {
                if (localMsg) {
                  const updated = {
                    ...c,
                    lastMessage: {
                      _id: localMsg.clientMessageId,
                      senderId: c.lastMessage?.senderId || '',
                      type: localMsg.type,
                      content: localMsg.snippet,
                      createdAt: new Date(localMsg.createdAt).toISOString(),
                    },
                  };
                  targetConv = updated;
                  return updated;
                } else {
                  const updated = {
                    ...c,
                    lastMessage: null,
                  };
                  targetConv = updated;
                  return updated;
                }
              }
            }
            return c;
          });
          appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
          return next;
        });

        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid && targetConv) {
          await upsertCachedConversation(targetConv, activeUid).catch(() => {});
        }
      });

      // Listen for group events in real-time
      unsubscribeGroupCreated = socketService.onGroupCreated(async ({ conversation }) => {
        setConversations((prev) => {
          if (prev.some((c) => c._id === conversation._id)) return prev;
          const next = [conversation, ...prev];
          appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
          return next;
        });
        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid && conversation) {
          await upsertCachedConversation(conversation, activeUid).catch(() => {});
        }
      });

      unsubscribeGroupUpdated = socketService.onGroupUpdated(async ({ conversationId, name, description, groupAvatarUrl }) => {
        setConversations((prev) => {
          const next = prev.map((c) => {
            if (c._id === conversationId) {
              return {
                ...c,
                name: name !== undefined ? name : c.name,
                description: description !== undefined ? description : c.description,
                groupAvatarUrl: groupAvatarUrl !== undefined ? groupAvatarUrl : c.groupAvatarUrl,
              };
            }
            return c;
          });
          appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
          return next;
        });
        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid) {
          await updateCachedConversationMetadata(conversationId, activeUid, {
            name,
            description,
            groupAvatarUrl,
          }).catch(() => {});
        }
      });

      unsubscribeGroupMemberRemoved = socketService.onGroupMemberRemoved(async ({ conversationId, userId, participants, adminIds }) => {
        const myId = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (myId && String(userId) === String(myId)) {
          setConversations((prev) => {
            const next = prev.filter((c) => c._id !== conversationId);
            appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
            return next;
          });
          if (myId) {
            await deleteCachedConversation(conversationId, myId).catch(() => {});
          }
        } else {
          setConversations((prev) => {
            const next = prev.map((c) => {
              if (c._id === conversationId) {
                return {
                  ...c,
                  participants: participants || c.participants,
                  adminIds: adminIds || c.adminIds,
                };
              }
              return c;
            });
            appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
            return next;
          });
          if (myId) {
            await updateCachedConversationMetadata(conversationId, myId, {
              participants,
              adminIds,
            }).catch(() => {});
          }
        }
      });

      unsubscribeGroupMemberLeft = socketService.onGroupMemberLeft(async ({ conversationId, userId }) => {
        const myId = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (myId && String(userId) === String(myId)) {
          setConversations((prev) => {
            const next = prev.filter((c) => c._id !== conversationId);
            appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
            return next;
          });
          if (myId) {
            await deleteCachedConversation(conversationId, myId).catch(() => {});
          }
        }
      });
    };

    initSocketConnection();

    return () => {
      if (unsubscribeUpdate) unsubscribeUpdate();
      if (unsubscribeNewMessage) unsubscribeNewMessage();
      if (unsubscribeOnlineList) unsubscribeOnlineList();
      if (unsubscribeStatus) unsubscribeStatus();
      if (unsubscribeRead) unsubscribeRead();
      if (unsubscribeAccepted) unsubscribeAccepted();
      if (unsubscribeDeleted) unsubscribeDeleted();
      if (unsubscribeMsgDeleted) unsubscribeMsgDeleted();
      if (unsubscribeGroupCreated) unsubscribeGroupCreated();
      if (unsubscribeGroupUpdated) unsubscribeGroupUpdated();
      if (unsubscribeGroupMemberRemoved) unsubscribeGroupMemberRemoved();
      if (unsubscribeGroupMemberLeft) unsubscribeGroupMemberLeft();
    };
  }, [session, loadConversations, resolvedUserId]);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadConversations(true);
  };

  // Accept chat invitation
  const handleAcceptInvitation = async (convId: string) => {
    setRespondingConvId(convId);
    try {
      await api.acceptConversation(convId);
      setConversations((prev) =>
        prev.map((c) => (c._id === convId ? { ...c, status: 'accepted' } : c))
      );
      const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
      if (activeUid) {
        await updateCachedConversationMetadata(convId, activeUid, { status: 'accepted' }).catch(() => {});
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to accept invitation');
    } finally {
      setRespondingConvId(null);
    }
  };

  // Decline chat invitation (permanently deletes conversation and messages)
  const handleDenyInvitation = (convId: string) => {
    Alert.alert(
      'Decline Chat Invitation',
      'Are you sure you want to decline this chat invitation? The conversation and all messages will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline & Delete',
          style: 'destructive',
          onPress: async () => {
            setRespondingConvId(convId);
            try {
              await api.denyConversation(convId);
              setConversations((prev) => prev.filter((c) => c._id !== convId));
              await deleteLocalConversation(convId);
              const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
              if (activeUid) {
                await deleteCachedConversation(convId, activeUid).catch(() => {});
              }
              showToast('Chat invitation declined', { type: 'info' });
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to decline invitation');
            } finally {
              setRespondingConvId(null);
            }
          },
        },
      ]
    );
  };

  // Permanently delete conversation (removes chat and contact for both users)
  const handleConfirmDelete = async () => {
    if (!deleteTargetConv) return;
    const convId = deleteTargetConv._id;
    setIsDeletingChat(true);
    try {
      setConversations((prev) => prev.filter((c) => c._id !== convId));
      setDeleteTargetConv(null);
      await api.deleteConversation(convId);
      await deleteLocalConversation(convId);
      const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
      if (activeUid) {
        await deleteCachedConversation(convId, activeUid).catch(() => {});
      }
      showToast('Chat deleted successfully', { type: 'success' });
    } catch (err: any) {
      console.error('Failed to delete conversation:', err);
      Alert.alert('Error', err.message || 'Failed to delete conversation');
      loadConversations(true);
    } finally {
      setIsDeletingChat(false);
    }
  };

  // Start new conversation by email
  const handleStartChat = async () => {
    const trimmed = recipientEmail.trim();
    if (!trimmed) {
      setModalError('Please enter an email address');
      return;
    }

    if (trimmed.toLowerCase() === session?.user?.email?.toLowerCase()) {
      setModalError('You cannot start a chat with yourself');
      return;
    }

    setIsStartingChat(true);
    setModalError(null);

    try {
      const res = await api.createOrFindConversation(trimmed);
      if (res?.conversation?._id) {
        setIsModalVisible(false);
        setRecipientEmail('');
        const conv = res.conversation;
        setConversations((prev) => {
          if (prev.some((c) => c._id === conv._id)) return prev;
          const next = [conv, ...prev];
          appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
          return next;
        });
        const activeUid = resolvedUserId || session?.user?.id || (await getActiveUserId().catch(() => null));
        if (activeUid) {
          await upsertCachedConversation(conv, activeUid).catch(() => {});
        }
        appStorage.setItem(`chatuk_conv_${conv._id}`, JSON.stringify(conv));
        const other = conv.participants?.find((p: any) => p.email?.toLowerCase() === trimmed.toLowerCase()) || conv.participants?.[0];
        if (other) {
          if (activeUid) {
            appStorage.setItem(`chatuk_${activeUid}_recipient_${conv._id}`, JSON.stringify(other));
          }
          appStorage.setItem(`chatuk_recipient_${conv._id}`, JSON.stringify(other));
        }
        if (activeUid) {
          appStorage.setItem(`chatuk_${activeUid}_conv_${conv._id}`, JSON.stringify(conv));
        }
        // Navigate immediately to the conversation screen with recipient params
        router.push({
          pathname: `/conversation/${conv._id}`,
          params: {
            recipientId: other?._id || '',
            recipientName: other?.name || 'Contact',
            recipientEmail: other?.email || trimmed,
            recipientImage: other?.image || '',
          },
        });
      } else {
        setModalError('Could not start conversation');
      }
    } catch (err: any) {
      setModalError(err.message || 'Failed to start conversation. Please check the email.');
    } finally {
      setIsStartingChat(false);
    }
  };

  const formatTime = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return '';
      const now = new Date();

      if (
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      ) {
        const hours = d.getHours().toString().padStart(2, '0');
        const minutes = d.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
      }

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      if (
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear()
      ) {
        return 'Yesterday';
      }

      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 7 && diffDays >= 0) {
        const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return shortDays[d.getDay()] || '';
      }

      const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${d.getDate()} ${shortMonths[d.getMonth()]}`;
    } catch {
      return '';
    }
  };

  const effectiveUserId = resolvedUserId || session?.user?.id || null;
  const effectiveUserEmail = resolvedUserEmail || session?.user?.email || null;

  const isParticipantMe = useCallback(
    (p: Participant) => {
      if (effectiveUserId && (p._id === effectiveUserId || String(p._id) === String(effectiveUserId))) {
        return true;
      }
      if (effectiveUserEmail && p.email && p.email.toLowerCase() === effectiveUserEmail.toLowerCase()) {
        return true;
      }
      return false;
    },
    [effectiveUserId, effectiveUserEmail]
  );

  const getOtherParticipant = useCallback(
    (conv: ConversationItem): Participant => {
      const participants = conv.participants || [];
      const found = participants.find((p) => !isParticipantMe(p));
      if (found) return found;
      if (participants.length > 1 && effectiveUserId) {
        const notId = participants.find((p) => p._id !== effectiveUserId);
        if (notId) return notId;
      }
      return participants[0] || {
        _id: 'unknown',
        name: 'Contact',
        email: '',
        image: null,
      };
    },
    [isParticipantMe, effectiveUserId]
  );

  // Distinguish incoming chat invitations vs accepted conversations
  const isInvitation = useCallback(
    (conv: ConversationItem) => {
      if (conv.type === 'group' || conv.status !== 'pending') return false;
      // If the current user initiated it, it's not an incoming invitation for them
      if (conv.initiatorId && effectiveUserId && String(conv.initiatorId) === String(effectiveUserId)) {
        return false;
      }
      return true;
    },
    [effectiveUserId]
  );

  const invitationConversations = conversations.filter(isInvitation);
  const acceptedConversations = conversations.filter((c) => !isInvitation(c));

  // Filter accepted conversations by search term
  const filteredConversations = acceptedConversations.filter((conv) => {
    const isGroup = conv.type === 'group';
    const otherParticipant = isGroup ? null : getOtherParticipant(conv);

    const name = isGroup ? (conv.name || 'Group') : (otherParticipant?.name || otherParticipant?.email || '');
    const email = isGroup ? '' : (otherParticipant?.email || '');
    const lastMsg = conv.lastMessage?.content || '';

    const query = searchQuery.toLowerCase();
    return (
      name.toLowerCase().includes(query) ||
      email.toLowerCase().includes(query) ||
      lastMsg.toLowerCase().includes(query)
    );
  });

  // Filter invitations by search term
  const filteredInvitations = invitationConversations.filter((conv) => {
    const otherParticipant = getOtherParticipant(conv);

    const name = otherParticipant?.name || otherParticipant?.email || '';
    const email = otherParticipant?.email || '';
    const lastMsg = conv.lastMessage?.content || '';

    const query = searchQuery.toLowerCase();
    return (
      name.toLowerCase().includes(query) ||
      email.toLowerCase().includes(query) ||
      lastMsg.toLowerCase().includes(query)
    );
  });

  if (isPending) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.onSurfaceVariant, marginTop: 12 }]}>
            Initializing secure session...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]}>
      {/* ─── Header ─── */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.card,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.avatarPressable, pressed && styles.avatarPressed]}
          >
            <Image
              source={getSafeImageSource(session.user?.image)}
              style={[
                styles.headerAvatar,
                { borderColor: theme.cardBorder },
              ]}
              contentFit="cover"
            />
            <View
              style={[
                styles.onlineBadge,
                { backgroundColor: theme.online, borderColor: theme.card },
              ]}
            />
          </Pressable>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Chats</Text>
            </View>
            <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
              {session.user?.name || session.user?.email}
            </Text>
          </View>
        </View>

        <View style={styles.headerRightActions}>
          <Pressable
            onPress={() => setIsCreateGroupModalVisible(true)}
            style={({ pressed }) => [
              styles.headerNewButton,
              { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
              pressed && styles.avatarPressed,
            ]}
            hitSlop={8}
            accessibilityLabel="Create group"
          >
            <Feather name="users" size={18} color={theme.primary} />
          </Pressable>
          <Pressable
            onPress={() => setIsModalVisible(true)}
            style={({ pressed }) => [
              styles.headerNewButton,
              { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
              pressed && styles.avatarPressed,
            ]}
            hitSlop={8}
            accessibilityLabel="New direct chat"
          >
            <Feather name="edit" size={18} color={theme.primary} />
          </Pressable>
        </View>
      </View>

      {/* ─── Search Bar ─── */}
      <View
        style={[
          styles.searchSection,
          {
            backgroundColor: theme.card,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.cardItem,
              borderColor: theme.cardBorder,
            },
          ]}
        >
          <Feather name="search" size={18} color={theme.outline} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: theme.onSurface }]}
            placeholder="Search messages or contacts..."
            placeholderTextColor={theme.outline}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Feather name="x" size={16} color={theme.outline} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ─── Tap-outside backdrop to dismiss any open swipe card ─── */}
      {openChatId !== null && (
        <Pressable
          style={styles.swipeBackdropOverlay}
          onPress={() => setOpenChatId(null)}
        />
      )}

      {/* ─── Conversations List ─── */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => setOpenChatId(null)}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        {isLoading && !isRefreshing ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.emptySubtitle, { color: theme.onSurfaceVariant, marginTop: 8 }]}>
              Loading conversations...
            </Text>
          </View>
        ) : (
          <>
            {/* ─── Chat Invitations Section ─── */}
            {filteredInvitations.length > 0 && (
              <View style={styles.invitationsSection}>
                <Pressable
                  onPress={() => setShowInvitations((prev) => !prev)}
                  style={[
                    styles.invitationsHeader,
                    { backgroundColor: theme.card, borderColor: theme.cardBorder },
                  ]}
                >
                  <View style={styles.invitationsHeaderLeft}>
                    <View style={[styles.invitationIconCircle, { backgroundColor: `${theme.primary}1A` }]}>
                      <Feather name="mail" size={16} color={theme.primary} />
                    </View>
                    <Text style={[styles.invitationsTitle, { color: theme.onSurface }]}>
                      Chat Invitations
                    </Text>
                    <View style={[styles.invitationsBadge, { backgroundColor: theme.primary }]}>
                      <Text style={styles.invitationsBadgeText}>{filteredInvitations.length}</Text>
                    </View>
                  </View>
                  <Feather
                    name={showInvitations ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.outline}
                  />
                </Pressable>

                {showInvitations && (
                  <View style={styles.invitationsList}>
                    {filteredInvitations.map((conv) => {
                      const otherParticipant = getOtherParticipant(conv);
                      const name = otherParticipant?.name || otherParticipant?.email || 'Unknown Contact';
                      const avatarUri = otherParticipant?.image;
                      const isProcessing = respondingConvId === conv._id;

                      return (
                        <View
                          key={conv._id}
                          style={[
                            styles.invitationCard,
                            { backgroundColor: theme.card, borderColor: theme.cardBorder },
                          ]}
                        >
                          <Pressable
                            onPress={() => {
                              const other = otherParticipant;
                              const uid = currentUserId;
                              if (other) {
                                if (uid) appStorage.setItem(`chatuk_${uid}_recipient_${conv._id}`, JSON.stringify(other));
                                appStorage.setItem(`chatuk_recipient_${conv._id}`, JSON.stringify(other));
                              }
                              if (uid) appStorage.setItem(`chatuk_${uid}_conv_${conv._id}`, JSON.stringify(conv));
                              appStorage.setItem(`chatuk_conv_${conv._id}`, JSON.stringify(conv));
                              router.push({
                                pathname: `/conversation/${conv._id}`,
                                params: {
                                  recipientId: other?._id || '',
                                  recipientName: name || '',
                                  recipientEmail: other?.email || '',
                                  recipientImage: avatarUri || '',
                                },
                              });
                            }}
                            style={styles.invitationCardTop}
                          >
                            <Image
                              source={getSafeImageSource(avatarUri)}
                              style={[styles.invitationAvatar, { borderColor: theme.cardBorder }]}
                              contentFit="cover"
                            />
                            <View style={styles.invitationDetails}>
                              <Text style={[styles.invitationName, { color: theme.onSurface }]} numberOfLines={1}>
                                {name}
                              </Text>
                              <Text style={[styles.invitationEmail, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                                {otherParticipant?.email || 'New Chat Request'}
                              </Text>
                              {conv.lastMessage?.content ? (
                                <Text style={[styles.invitationSnippet, { color: theme.outline }]} numberOfLines={1}>
                                  {`"${conv.lastMessage.content}"`}
                                </Text>
                              ) : null}
                            </View>
                          </Pressable>

                          <View style={[styles.invitationActions, { borderTopColor: theme.cardBorder }]}>
                            <Pressable
                              onPress={() => handleDenyInvitation(conv._id)}
                              disabled={isProcessing}
                              style={({ pressed }) => [
                                styles.invitationDeclineBtn,
                                { borderColor: theme.cardBorder, backgroundColor: theme.cardItem },
                                pressed && { opacity: 0.7 },
                              ]}
                            >
                              <Feather name="x" size={15} color="#EF4444" style={{ marginRight: 4 }} />
                              <Text style={styles.invitationDeclineText}>Decline</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => handleAcceptInvitation(conv._id)}
                              disabled={isProcessing}
                              style={({ pressed }) => [
                                styles.invitationAcceptBtn,
                                pressed && { opacity: 0.85 },
                              ]}
                            >
                              <LinearGradient
                                colors={theme.gradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.invitationAcceptGradient}
                              >
                                {isProcessing ? (
                                  <ActivityIndicator size="small" color="#ffffff" />
                                ) : (
                                  <>
                                    <Feather name="check" size={15} color="#ffffff" style={{ marginRight: 4 }} />
                                    <Text style={styles.invitationAcceptText}>Accept</Text>
                                  </>
                                )}
                              </LinearGradient>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* ─── Accepted Conversations List or Empty State ─── */}
            {filteredConversations.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View
                  style={[
                    styles.emptyIconCircle,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  ]}
                >
                  <Feather name="message-square" size={36} color={theme.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.onSurface }]}>
                  {searchQuery ? 'No matching conversations' : 'No messages yet'}
                </Text>
                <Text style={[styles.emptySubtitle, { color: theme.onSurfaceVariant }]}>
                  {searchQuery
                    ? 'Try searching with a different name or email'
                    : 'Tap the pen icon below to start chatting with anyone using their email!'}
                </Text>
                {!searchQuery && (
                  <Pressable
                    onPress={() => setIsModalVisible(true)}
                    style={({ pressed }) => [styles.emptyStartButton, pressed && { opacity: 0.85 }]}
                  >
                    <LinearGradient
                      colors={theme.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.emptyStartGradient}
                    >
                      <Feather name="plus" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                      <Text style={styles.emptyStartText}>Start a Chat</Text>
                    </LinearGradient>
                  </Pressable>
                )}
              </View>
            ) : (
              filteredConversations.map((conv) => {
            const isGroup = conv.type === 'group';
            const otherParticipant = isGroup ? null : getOtherParticipant(conv);

            const name = isGroup
              ? (conv.name || 'Group')
              : (otherParticipant?.name || otherParticipant?.email || 'Unknown Contact');
            const avatarUri = isGroup ? (conv.groupAvatarUrl || null) : otherParticipant?.image;

            let lastMsg = 'Started a new conversation';
            if (conv.lastMessage) {
              const lm = conv.lastMessage;
              const snippetText =
                lm.content ||
                (lm.type === 'image'
                  ? '📷 Photo'
                  : lm.type === 'video'
                  ? '🎥 Video'
                  : lm.type === 'audio'
                  ? '🎤 Voice message'
                  : '🔒 Encrypted message');

              if (lm.type === 'system') {
                lastMsg = lm.content || 'System update';
              } else if (isGroup) {
                const myId = resolvedUserId || session?.user?.id;
                const isMe = myId && (lm.senderId === myId || String(lm.senderId) === String(myId));
                if (isMe) {
                  lastMsg = `You: ${snippetText}`;
                } else {
                  const sender = conv.participants?.find((p) => p._id === lm.senderId);
                  const senderName = sender?.name || sender?.email?.split('@')[0] || 'Member';
                  lastMsg = `${senderName}: ${snippetText}`;
                }
              } else {
                lastMsg = snippetText;
              }
            }

            const timeStr = formatTime(conv.lastMessage?.createdAt || conv.updatedAt);

            // Check if contact is online (active within 1 minute or currently connected on socket)
            const isContactOnline = !isGroup && Boolean(
              otherParticipant?._id && onlineUserIds.has(otherParticipant._id)
            );

            // Show unread count if messages exist that the user has not read yet
            const unread = Math.max(0, conv.unreadCount || 0);

            return (
              <SwipeableChatCard
                key={conv._id}
                conv={conv}
                name={name}
                avatarUri={avatarUri}
                lastMsg={lastMsg}
                timeStr={timeStr}
                isContactOnline={isContactOnline}
                unread={unread}
                theme={theme}
                isOpen={openChatId === conv._id}
                onOpen={() => setOpenChatId(conv._id)}
                onClose={() => setOpenChatId(null)}
                onPress={() => {
                  if (openChatId !== null) {
                    setOpenChatId(null);
                    return;
                  }
                  // Clear unread badge immediately in UI for instant responsiveness
                  setConversations((prev) =>
                    prev.map((c) => (c._id === conv._id ? { ...c, unreadCount: 0 } : c))
                  );
                  const other = otherParticipant;
                  const uid = currentUserId;
                  if (uid) {
                    updateCachedConversationMetadata(conv._id, uid, { unreadCount: 0 }).catch(() => {});
                  }
                  if (other) {
                    if (uid) appStorage.setItem(`chatuk_${uid}_recipient_${conv._id}`, JSON.stringify(other));
                    appStorage.setItem(`chatuk_recipient_${conv._id}`, JSON.stringify(other));
                  }
                  if (uid) appStorage.setItem(`chatuk_${uid}_conv_${conv._id}`, JSON.stringify(conv));
                  appStorage.setItem(`chatuk_conv_${conv._id}`, JSON.stringify(conv));
                  router.push({
                    pathname: `/conversation/${conv._id}`,
                    params: {
                      recipientId: other?._id || '',
                      recipientName: name || '',
                      recipientEmail: other?.email || '',
                      recipientImage: avatarUri || '',
                    },
                  });
                }}
                onDeletePress={(target) => {
                  setOpenChatId(null);
                  setDeleteTargetConv(target);
                }}
              />
            );
          })
        )}
          </>
        )}
      </ScrollView>

      {/* ─── Floating Action Button (Pen Icon) ─── */}
      <Pressable
        style={[
          styles.fab,
          { shadowColor: theme.primary },
        ]}
        onPress={() => {
          setModalError(null);
          setIsModalVisible(true);
        }}
      >
        <LinearGradient
          colors={theme.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabGradient}
        >
          <Feather name="edit-2" size={22} color="#ffffff" />
        </LinearGradient>
      </Pressable>

      {/* ─── New Chat Modal ─── */}
      <Modal
        visible={isModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsModalVisible(false)}
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={[
                    styles.modalIconWrap,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  ]}
                >
                  <Feather name="user-plus" size={20} color={theme.primary} />
                </View>
                <View>
                  <Text style={[styles.modalTitle, { color: theme.onSurface }]}>New Chat</Text>
                  <Text style={[styles.modalSubtitle, { color: theme.onSurfaceVariant }]}>
                    Start messaging someone by email
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setIsModalVisible(false)}
                style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.7 }]}
                hitSlop={10}
              >
                <Feather name="x" size={20} color={theme.outline} />
              </Pressable>
            </View>

            {/* Modal Form */}
            <View style={styles.modalBody}>
              <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                Recipient Email
              </Text>
              <View
                style={[
                  styles.modalInputWrap,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: modalError ? theme.error : theme.cardBorder,
                  },
                ]}
              >
                <Feather name="mail" size={18} color={theme.outline} style={{ marginRight: 10 }} />
                <TextInput
                  style={[styles.modalInput, { color: theme.onSurface }]}
                  placeholder="e.g. friend@example.com"
                  placeholderTextColor={theme.outline}
                  value={recipientEmail}
                  onChangeText={(text) => {
                    setRecipientEmail(text);
                    if (modalError) setModalError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="go"
                  onSubmitEditing={handleStartChat}
                />
              </View>

              {modalError && (
                <View style={styles.errorRow}>
                  <Feather name="alert-circle" size={14} color={theme.error} style={{ marginRight: 6 }} />
                  <Text style={[styles.errorText, { color: theme.error }]}>{modalError}</Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setIsModalVisible(false)}
                  style={({ pressed }) => [
                    styles.modalCancelBtn,
                    { borderColor: theme.cardBorder },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.modalCancelText, { color: theme.onSurfaceVariant }]}>
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleStartChat}
                  disabled={isStartingChat || !recipientEmail.trim()}
                  style={({ pressed }) => [
                    styles.modalStartBtn,
                    (!recipientEmail.trim() || isStartingChat) && { opacity: 0.5 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <LinearGradient
                    colors={theme.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.modalStartGradient}
                  >
                    {isStartingChat ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Text style={styles.modalStartText}>Start Chat</Text>
                        <Feather name="arrow-right" size={16} color="#ffffff" style={{ marginLeft: 6 }} />
                      </>
                    )}
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Delete Chat Confirmation Modal ─── */}
      <Modal
        visible={!!deleteTargetConv}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeletingChat) setDeleteTargetConv(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => !isDeletingChat && setDeleteTargetConv(null)}
          />
          <View
            style={[
              styles.deleteModalCard,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <View style={styles.deleteModalIconWrap}>
              <Feather name="trash-2" size={24} color="#EF4444" />
            </View>

            <Text style={[styles.deleteModalTitle, { color: theme.onSurface }]}>
              Delete Chat?
            </Text>

            <Text style={[styles.deleteModalDescription, { color: theme.onSurfaceVariant }]}>
              {deleteTargetConv
                ? `Are you sure you want to delete this chat with ${
                    getOtherParticipant(deleteTargetConv)?.name ||
                    getOtherParticipant(deleteTargetConv)?.email ||
                    'this contact'
                  }? All messages and this conversation will be permanently removed for both participants.`
                : 'Are you sure you want to delete this chat?'}
            </Text>

            <View style={styles.deleteModalActions}>
              <Pressable
                onPress={() => setDeleteTargetConv(null)}
                disabled={isDeletingChat}
                style={({ pressed }) => [
                  styles.deleteModalCancelBtn,
                  { borderColor: theme.cardBorder, backgroundColor: theme.cardItem },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.deleteModalCancelText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleConfirmDelete}
                disabled={isDeletingChat}
                style={({ pressed }) => [
                  styles.deleteModalConfirmBtn,
                  pressed && { opacity: 0.85 },
                  isDeletingChat && { opacity: 0.6 },
                ]}
              >
                {isDeletingChat ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Feather name="trash-2" size={15} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.deleteModalConfirmText}>Delete Chat</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* ─── Create Group Modal ─── */}
      <CreateGroupModal
        visible={isCreateGroupModalVisible}
        onClose={() => setIsCreateGroupModalVisible(false)}
        availableContacts={availableGroupContacts}
        currentUserId={currentUserId}
        currentUserEmail={resolvedUserEmail || session?.user?.email || null}
        onGroupCreated={(newGroup) => {
          setIsCreateGroupModalVisible(false);
          setConversations((prev) => {
            if (prev.some((c) => c._id === newGroup._id)) return prev;
            const next = [newGroup, ...prev];
            appStorage.setItem('chatuk_cached_conversations', JSON.stringify(next));
            return next;
          });
          const uid = currentUserId;
          if (uid) {
            upsertCachedConversation(newGroup, uid).catch(() => {});
          }
          router.push({
            pathname: '/conversation/[id]',
            params: { id: newGroup._id },
          });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarPressable: {
    position: 'relative',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerNewButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupAvatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  avatarPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  centerLoading: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyStartButton: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  emptyStartGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyStartText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  chatCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  chatAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  chatOnlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  chatDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  chatRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    marginRight: 8,
  },
  chatName: {
    fontSize: 15,
    fontWeight: '700',
  },
  chatTime: {
    fontSize: 12,
    fontWeight: '500',
  },
  chatRowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatMessage: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  chatMessageUnread: {
    fontWeight: '700',
  },
  unreadBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  unreadText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  fabGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
  },
  modalIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
  },
  modalInput: {
    flex: 1,
    fontSize: 15,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  modalCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalStartBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalStartGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalStartText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  invitationsSection: {
    marginBottom: 16,
  },
  invitationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  invitationsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  invitationIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitationsTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  invitationsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitationsBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  invitationsList: {
    marginTop: 8,
    gap: 8,
  },
  invitationCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  invitationCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invitationAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
  },
  invitationDetails: {
    flex: 1,
    marginLeft: 12,
  },
  invitationName: {
    fontSize: 15,
    fontWeight: '600',
  },
  invitationEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  invitationSnippet: {
    fontSize: 12,
    marginTop: 2,
    fontStyle: 'italic',
  },
  invitationActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  invitationDeclineBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitationDeclineText: {
    fontSize: 13,
    fontWeight: '600',
  },
  invitationAcceptBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    overflow: 'hidden',
  },
  invitationAcceptGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitationAcceptText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },

  swipeBackdropOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  swipeContainer: {
    position: 'relative',
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  swipeActionBehind: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 84,
    backgroundColor: '#EF4444',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  swipeDeleteButton: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  swipeDeleteIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  swipeDeleteText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  swipeFrontCard: {
    zIndex: 2,
    width: '100%',
  },

  // Delete Modal styles
  deleteModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  deleteModalIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalDescription: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  deleteModalCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  deleteModalConfirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  deleteModalConfirmText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const router = useRouter();

  return (
    <View style={errorStyles.errorContainer}>
      <View style={errorStyles.errorIconCircle}>
        <Feather name="alert-triangle" size={32} color="#EF4444" />
      </View>
      <Text style={errorStyles.errorTitle}>Unable to load chats</Text>
      <Text style={errorStyles.errorMessage}>{error.message || 'An unexpected error occurred.'}</Text>
      <View style={errorStyles.errorActions}>
        <Pressable
          onPress={() => router.replace('/')}
          style={[errorStyles.errorButton, errorStyles.secondaryButton]}
        >
          <Text style={errorStyles.secondaryButtonText}>Return Home</Text>
        </Pressable>
        <Pressable onPress={retry} style={[errorStyles.errorButton, errorStyles.primaryButton]}>
          <Text style={errorStyles.primaryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
  },
  errorButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 14,
  },
});

