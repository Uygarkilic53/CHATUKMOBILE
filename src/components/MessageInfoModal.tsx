import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SocketMessage, MessageReaction } from '../services/socket';
import { api } from '../lib/api';
import { getLocalMessage } from '../e2ee/localDb';
import { processIncomingMessage } from '../e2ee/messageService';
import { useToast } from './Toast';
import { getSafeImageSource, isValidImageUri } from '../utils/image';
import {
  formatInfoDate,
  formatExactTime,
  formatFullDateTime,
  formatMessageTime,
} from '../utils/messageInfo';

interface ParticipantInfo {
  _id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface ExtendedMessage extends SocketMessage {
  updatedAt?: string;
}

interface MessageInfoModalProps {
  visible: boolean;
  onClose: () => void;
  message: SocketMessage | null;
  conversation?: {
    _id: string;
    type: string;
    name?: string | null;
    participants: ParticipantInfo[];
    createdAt?: string;
  } | null;
  recipient?: {
    _id?: string;
    name?: string;
    email?: string;
    image?: string | null;
  } | null;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  sessionUserName?: string | null;
  theme: any;
  isGroupChat?: boolean;
}

export const MessageInfoModal: React.FC<MessageInfoModalProps> = ({
  visible,
  onClose,
  message,
  conversation,
  recipient,
  currentUserId,
  currentUserEmail,
  sessionUserName,
  theme,
  isGroupChat = false,
}) => {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [enrichedState, setEnrichedState] = useState<{
    targetId: string | null;
    data: any;
  }>({ targetId: null, data: null });

  const [localDbContent, setLocalDbContent] = useState<string | null>(null);
  const [localDbFileUrl, setLocalDbFileUrl] = useState<string | null>(null);

  const currentTargetId = visible && message ? (message._id || message.clientMessageId || null) : null;
  const isLoadingDetails = Boolean(currentTargetId && enrichedState.targetId !== currentTargetId);
  const enrichedMessage = enrichedState.targetId === currentTargetId ? enrichedState.data : null;

  // Check if message was sent by the current user
  const isMessageFromMe = useMemo(() => {
    if (!message) return false;
    const myId = String(currentUserId || '').trim();
    const myEmail = (currentUserEmail || '').toLowerCase().trim();
    const senderId = String(message.senderId || '').trim();
    const senderEmail = (message.senderEmail || '').toLowerCase().trim();

    return Boolean(
      (myId && senderId === myId) ||
      senderId === 'me' ||
      (myEmail && senderEmail === myEmail) ||
      message.isOutgoing
    );
  }, [message, currentUserId, currentUserEmail]);

  // Fetch plaintext body from local SQLite or decrypt if encrypted
  useEffect(() => {
    if (!visible || !message) {
      return;
    }

    let isMounted = true;
    const targetId = message.clientMessageId || message._id;
    const convId = message.conversationId || conversation?._id;

    // Query SQLite localDb for decrypted body / attachment
    if (targetId) {
      (async () => {
        try {
          let stored = await getLocalMessage(targetId, convId);
          if (!stored && message._id && message._id !== targetId) {
            stored = await getLocalMessage(message._id, convId);
          }
          if (!stored && message.clientMessageId && message.clientMessageId !== targetId) {
            stored = await getLocalMessage(message.clientMessageId, convId);
          }
          if (isMounted && stored) {
            if (stored.body && !stored.body.startsWith('🔒 Encrypted message')) {
              setLocalDbContent(stored.body);
            }
            if (stored.attachmentJson) {
              try {
                const parsed = JSON.parse(stored.attachmentJson);
                if (parsed?.url) {
                  setLocalDbFileUrl(parsed.url);
                }
              } catch {}
            }
          }
        } catch (err) {
          console.warn('[MessageInfoModal] SQLite lookup failed:', err);
        }
      })();
    }

    // 3. If still encrypted and has envelope, decrypt via processIncomingMessage
    if (
      message.encrypted &&
      (!message.content || message.content.startsWith('🔒 Encrypted message'))
    ) {
      processIncomingMessage({ message, envelope: message.envelope || null })
        .then((payload) => {
          if (isMounted && payload) {
            if (payload.body) setLocalDbContent(payload.body);
            if (payload.attachment?.url) setLocalDbFileUrl(payload.attachment.url);
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
      setLocalDbContent(null);
      setLocalDbFileUrl(null);
    };
  }, [visible, message, conversation]);

  // Fetch enriched details from backend when modal opens
  useEffect(() => {
    if (!currentTargetId) return;

    let isMounted = true;
    api
      .getMessageInfo(currentTargetId)
      .then((res) => {
        if (isMounted && res?.success && res.message) {
          setEnrichedState({ targetId: currentTargetId, data: res.message });
        } else if (isMounted) {
          setEnrichedState({ targetId: currentTargetId, data: null });
        }
      })
      .catch(() => {
        if (isMounted) {
          setEnrichedState({ targetId: currentTargetId, data: null });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentTargetId]);

  // Merge local and server message data without overwriting plaintext content
  const effectiveMessage = useMemo<ExtendedMessage | null>(() => {
    if (!message) return null;

    const base: ExtendedMessage = { ...message };

    if (enrichedMessage) {
      if (Array.isArray(enrichedMessage.readBy) && enrichedMessage.readBy.length > 0) {
        base.readBy = enrichedMessage.readBy;
      }
      if (Array.isArray(enrichedMessage.deliveredTo) && enrichedMessage.deliveredTo.length > 0) {
        base.deliveredTo = enrichedMessage.deliveredTo;
      }
      if (Array.isArray(enrichedMessage.reactions) && enrichedMessage.reactions.length > 0) {
        base.reactions = enrichedMessage.reactions;
      }
      if (
        enrichedMessage.senderName &&
        enrichedMessage.senderName !== 'Unknown' &&
        enrichedMessage.senderName !== 'Sender'
      ) {
        base.senderName = enrichedMessage.senderName;
      }
      if (enrichedMessage.senderEmail) {
        base.senderEmail = enrichedMessage.senderEmail;
      }
      if (enrichedMessage.senderImage) {
        base.senderImage = enrichedMessage.senderImage;
      }
      if (enrichedMessage.updatedAt) {
        base.updatedAt = enrichedMessage.updatedAt;
      }
    }

    // Priority: localDbContent -> message.content (if not placeholder) -> enrichedMessage.content -> message.content
    const resolvedContent =
      localDbContent ||
      (message.content && !message.content.startsWith('🔒 Encrypted message') ? message.content : null) ||
      (enrichedMessage?.content && !enrichedMessage.content.startsWith('🔒 Encrypted message') ? enrichedMessage.content : null) ||
      message.content ||
      '';

    base.content = resolvedContent;

    if (localDbFileUrl && !base.fileUrl) {
      base.fileUrl = localDbFileUrl;
    }

    return base;
  }, [message, enrichedMessage, localDbContent, localDbFileUrl]);

  // Resolve participants who read the message
  const readParticipants = useMemo<ParticipantInfo[]>(() => {
    if (!effectiveMessage) return [];

    const rawReadBy: any[] = Array.isArray(effectiveMessage.readBy) ? (effectiveMessage.readBy as any[]) : [];
    const myId = String(currentUserId || '').trim();

    if (rawReadBy.length > 0) {
      const results: ParticipantInfo[] = [];
      for (const item of rawReadBy) {
        if (typeof item === 'object' && item !== null && item._id) {
          const id = String(item._id);
          if (id !== 'me' && (!myId || id !== myId)) {
            results.push({
              _id: id,
              name: item.name || item.displayName || item.email?.split('@')[0] || 'User',
              email: item.email || '',
              image: item.image || item.avatarUrl || null,
            });
          }
        } else if (item) {
          const idStr = String(item);
          if (idStr !== 'me' && (!myId || idStr !== myId)) {
            const found = conversation?.participants?.find(
              (p) => String(p._id) === idStr
            );
            if (found) {
              results.push({
                _id: found._id,
                name: found.name || found.email?.split('@')[0] || 'User',
                email: found.email || '',
                image: found.image || null,
              });
            } else {
              results.push({
                _id: idStr,
                name: 'Participant',
                email: '',
                image: null,
              });
            }
          }
        }
      }
      return results;
    }

    return [];
  }, [effectiveMessage, conversation, currentUserId]);

  // Resolve participants who received the message but not read yet
  const deliveredParticipants = useMemo<ParticipantInfo[]>(() => {
    if (!effectiveMessage) return [];

    const rawDeliveredTo: any[] = Array.isArray(effectiveMessage.deliveredTo) ? (effectiveMessage.deliveredTo as any[]) : [];
    const readIds = new Set(readParticipants.map((p) => p._id));
    const myId = String(currentUserId || '').trim();

    if (rawDeliveredTo.length > 0) {
      const results: ParticipantInfo[] = [];
      for (const item of rawDeliveredTo) {
        if (typeof item === 'object' && item !== null && item._id) {
          const id = String(item._id);
          if (id !== 'me' && (!myId || id !== myId) && !readIds.has(id)) {
            results.push({
              _id: id,
              name: item.name || item.displayName || item.email?.split('@')[0] || 'User',
              email: item.email || '',
              image: item.image || item.avatarUrl || null,
            });
          }
        } else if (item) {
          const idStr = String(item);
          if (idStr !== 'me' && (!myId || idStr !== myId) && !readIds.has(idStr)) {
            const found = conversation?.participants?.find(
              (p) => String(p._id) === idStr
            );
            if (found) {
              results.push({
                _id: found._id,
                name: found.name || found.email?.split('@')[0] || 'User',
                email: found.email || '',
                image: found.image || null,
              });
            } else {
              results.push({
                _id: idStr,
                name: 'Participant',
                email: '',
                image: null,
              });
            }
          }
        }
      }
      return results;
    }

    // Fallback in 1-on-1: if delivered or read, show recipient
    return [];
  }, [effectiveMessage, readParticipants, conversation, currentUserId]);

  // 1-on-1 recipient
  const directRecipient = useMemo<ParticipantInfo | null>(() => {
    if (isGroupChat || !conversation?.participants) return null;
    const myId = String(currentUserId || '').trim();
    const found = conversation.participants.find((p) => String(p._id) !== myId);
    return found || null;
  }, [isGroupChat, conversation, currentUserId]);

  // Determine read status for 1-on-1
  const isDirectMessageRead = useMemo(() => {
    if (!effectiveMessage) return false;
    if (effectiveMessage.deliveryStatus === 'read') return true;
    if (readParticipants.length > 0) return true;
    if (directRecipient && Array.isArray(effectiveMessage.readBy)) {
      return effectiveMessage.readBy.some(
        (id: any) => String(id?._id || id) === String(directRecipient._id)
      );
    }
    // If outgoing and readBy has more than 1 entry (sender + recipient)
    if (isMessageFromMe && Array.isArray(effectiveMessage.readBy) && effectiveMessage.readBy.length > 1) {
      return true;
    }
    return false;
  }, [effectiveMessage, readParticipants, directRecipient, isMessageFromMe]);

  // Copy message text handler
  const handleCopyText = useCallback(() => {
    if (!effectiveMessage?.content) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(effectiveMessage.content);
      }
      showToast('Message text copied', 'success');
    } catch {
      showToast('Could not copy message text', 'error');
    }
  }, [effectiveMessage, showToast]);

  if (!visible || !effectiveMessage) return null;

  const sentDateStr = formatInfoDate(effectiveMessage.createdAt, true);
  const sentTimeStr = formatExactTime(effectiveMessage.createdAt, true);
  const readDateStr = isDirectMessageRead || readParticipants.length > 0
    ? formatInfoDate(effectiveMessage.updatedAt || effectiveMessage.createdAt, true)
    : '—';
  const readTimeStr = isDirectMessageRead || readParticipants.length > 0
    ? formatExactTime(effectiveMessage.updatedAt || effectiveMessage.createdAt, true)
    : '';

  const deliveredDateStr = effectiveMessage.deliveryStatus !== 'failed' && effectiveMessage.deliveryStatus !== 'pending'
    ? formatInfoDate(effectiveMessage.createdAt, true)
    : '—';
  const deliveredTimeStr = effectiveMessage.deliveryStatus !== 'failed' && effectiveMessage.deliveryStatus !== 'pending'
    ? formatExactTime(effectiveMessage.createdAt, true)
    : '';

  const totalRecipients = conversation?.participants
    ? conversation.participants.filter((p) => String(p._id) !== String(currentUserId || '')).length
    : 1;

  // Sender info for received message
  const senderIdStr = String(effectiveMessage.senderId || '').trim();
  const participantDoc = conversation?.participants?.find((p) => {
    const pid = String(p._id || '').trim();
    return pid !== '' && senderIdStr !== '' && pid === senderIdStr;
  });

  const rawSenderName = effectiveMessage.senderName;
  const isGenericSenderName =
    !rawSenderName ||
    rawSenderName.trim() === '' ||
    rawSenderName === 'Unknown' ||
    rawSenderName === 'Sender';

  // In direct 1:1 chats, the sender of an incoming message is the recipient contact
  const directChatContactName =
    !isGroupChat && recipient?.name && recipient.name !== 'Unknown' && recipient.name !== 'Sender'
      ? recipient.name
      : null;

  const senderDisplayName =
    (!isGenericSenderName ? rawSenderName : null) ||
    (participantDoc?.name && participantDoc.name !== 'Unknown' && participantDoc.name !== 'Sender'
      ? participantDoc.name
      : null) ||
    directChatContactName ||
    (participantDoc?.email ? participantDoc.email.split('@')[0] : null) ||
    (recipient?.email ? recipient.email.split('@')[0] : null) ||
    (effectiveMessage.senderEmail ? effectiveMessage.senderEmail.split('@')[0] : null) ||
    'Sender';

  const senderEmail =
    effectiveMessage.senderEmail ||
    participantDoc?.email ||
    (!isGroupChat ? recipient?.email : '') ||
    '';

  // Safe top padding to keep header comfortably below the camera notch on iPhone X / dynamic island / status bar
  const headerTopPadding = Math.max(
    insets.top,
    Platform.OS === 'ios' ? 48 : 24
  ) + (Platform.OS === 'ios' ? 12 : 8);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.isDark ? '#0B141B' : '#F0F2F5' },
        ]}
      >
        {/* ─── Header ─── */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.isDark ? '#1F2C34' : '#FFFFFF',
              borderBottomColor: theme.cardBorder,
              paddingTop: headerTopPadding,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.headerButton, pressed && styles.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Close message info"
          >
            <Ionicons
              name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
              size={24}
              color={theme.onSurface}
            />
          </Pressable>

          <View style={styles.headerTitleContainer}>
            <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Message info</Text>
            {isGroupChat && conversation?.name && (
              <Text style={[styles.headerSubtitle, { color: theme.outline }]} numberOfLines={1}>
                {conversation.name}
              </Text>
            )}
          </View>

          {effectiveMessage.content ? (
            <Pressable
              onPress={handleCopyText}
              hitSlop={12}
              style={({ pressed }) => [styles.headerButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Copy message content"
            >
              <Feather name="copy" size={20} color={theme.primary} />
            </Pressable>
          ) : (
            <View style={styles.headerButtonPlaceholder} />
          )}
        </View>

        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Message Preview Section ─── */}
          <View
            style={[
              styles.previewSection,
              {
                backgroundColor: theme.isDark ? '#111B21' : '#EFEAE2',
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <View
              style={[
                styles.bubbleWrapper,
                isMessageFromMe ? styles.bubbleWrapperRight : styles.bubbleWrapperLeft,
              ]}
            >
              {isMessageFromMe ? (
                // Outgoing preview bubble
                <LinearGradient
                  colors={['#4F46E5', '#6366F1']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.bubble, styles.outgoingBubble]}
                >
                  {renderMessageBody(effectiveMessage, '#FFFFFF')}
                  <View style={styles.bubbleFooter}>
                    <Text style={styles.outgoingTimeText}>
                      {formatMessageTime(effectiveMessage.createdAt)}
                    </Text>
                    <Ionicons
                      name={
                        effectiveMessage.deliveryStatus === 'failed'
                          ? 'alert-circle'
                          : effectiveMessage.deliveryStatus === 'pending'
                          ? 'time-outline'
                          : 'checkmark-done'
                      }
                      size={14}
                      color={
                        effectiveMessage.deliveryStatus === 'failed'
                          ? '#EF4444'
                          : isDirectMessageRead || readParticipants.length > 0
                          ? '#38BDF8'
                          : 'rgba(255, 255, 255, 0.7)'
                      }
                      style={{ marginLeft: 3 }}
                    />
                  </View>
                </LinearGradient>
              ) : (
                // Received preview bubble
                <View
                  style={[
                    styles.bubble,
                    styles.incomingBubble,
                    {
                      backgroundColor: theme.isDark ? '#1F2C34' : '#FFFFFF',
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  {isGroupChat && (
                    <Text style={[styles.senderNamePreview, { color: theme.primary }]}>
                      {senderDisplayName}
                    </Text>
                  )}
                  {renderMessageBody(effectiveMessage, theme.onSurface)}
                  <View style={styles.bubbleFooter}>
                    <Text style={[styles.incomingTimeText, { color: theme.outline }]}>
                      {formatMessageTime(effectiveMessage.createdAt)}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Loading indicator if server enrichment is in flight */}
          {isLoadingDetails && (
            <View style={styles.enrichingBanner}>
              <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 8 }} />
              <Text style={[styles.enrichingText, { color: theme.outline }]}>
                Updating latest receipts...
              </Text>
            </View>
          )}

          {/* ─── WhatsApp-style Status Cards ─── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.isDark ? '#1F2C34' : '#FFFFFF',
                borderColor: theme.cardBorder,
              },
            ]}
          >
            {isMessageFromMe ? (
              // ─── OUTGOING MESSAGE DETAILS ───
              <>
                {/* 1. READ SECTION */}
                <View style={styles.statusSection}>
                  <View style={styles.statusHeaderRow}>
                    <Ionicons name="checkmark-done" size={22} color="#38BDF8" />
                    <View style={styles.statusHeaderInfo}>
                      <Text style={[styles.statusTitle, { color: theme.onSurface }]}>
                        {isGroupChat ? 'Read by' : 'Read'}
                      </Text>
                      {isGroupChat && (
                        <Text style={[styles.statusBadgeText, { color: theme.outline }]}>
                          {readParticipants.length} of {totalRecipients}
                        </Text>
                      )}
                    </View>
                  </View>

                  {isGroupChat ? (
                    // Group chat: list of participants who read
                    readParticipants.length > 0 ? (
                      <View style={styles.participantList}>
                        {readParticipants.map((p) => (
                          <View key={p._id} style={styles.participantRow}>
                            <UserAvatar user={p} theme={theme} />
                            <View style={styles.participantInfo}>
                              <Text style={[styles.participantName, { color: theme.onSurface }]}>
                                {p.name}
                              </Text>
                              {p.email ? (
                                <Text style={[styles.participantEmail, { color: theme.outline }]}>
                                  {p.email}
                                </Text>
                              ) : null}
                            </View>
                            <View style={styles.receiptCheckContainer}>
                              <Ionicons name="checkmark-done" size={17} color="#38BDF8" />
                              <Text style={[styles.receiptTimeText, { color: theme.outline }]}>
                                Read
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.emptyStatusText, { color: theme.outline }]}>
                        No one has read this message yet
                      </Text>
                    )
                  ) : (
                    // 1-on-1 chat
                    <View style={styles.singleChatTimestampRow}>
                      {isDirectMessageRead ? (
                        <View>
                          <Text style={[styles.timestampMain, { color: theme.onSurface }]}>
                            {readDateStr}
                          </Text>
                          {readTimeStr ? (
                            <Text style={[styles.timestampSub, { color: theme.outline }]}>
                              {readTimeStr}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={[styles.emptyStatusText, { color: theme.outline }]}>
                          —
                        </Text>
                      )}
                    </View>
                  )}
                </View>

                <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />

                {/* 2. DELIVERED SECTION */}
                <View style={styles.statusSection}>
                  <View style={styles.statusHeaderRow}>
                    <Ionicons name="checkmark-done" size={22} color="#94A3B8" />
                    <View style={styles.statusHeaderInfo}>
                      <Text style={[styles.statusTitle, { color: theme.onSurface }]}>
                        {isGroupChat ? 'Delivered to' : 'Delivered'}
                      </Text>
                      {isGroupChat && (
                        <Text style={[styles.statusBadgeText, { color: theme.outline }]}>
                          {deliveredParticipants.length} remaining
                        </Text>
                      )}
                    </View>
                  </View>

                  {isGroupChat ? (
                    // Group chat: list of participants delivered to
                    deliveredParticipants.length > 0 ? (
                      <View style={styles.participantList}>
                        {deliveredParticipants.map((p) => (
                          <View key={p._id} style={styles.participantRow}>
                            <UserAvatar user={p} theme={theme} />
                            <View style={styles.participantInfo}>
                              <Text style={[styles.participantName, { color: theme.onSurface }]}>
                                {p.name}
                              </Text>
                              {p.email ? (
                                <Text style={[styles.participantEmail, { color: theme.outline }]}>
                                  {p.email}
                                </Text>
                              ) : null}
                            </View>
                            <View style={styles.receiptCheckContainer}>
                              <Ionicons name="checkmark-done" size={17} color="#94A3B8" />
                              <Text style={[styles.receiptTimeText, { color: theme.outline }]}>
                                Delivered
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.emptyStatusText, { color: theme.outline }]}>
                        {readParticipants.length > 0
                          ? 'Delivered to all participants'
                          : 'Delivered'}
                      </Text>
                    )
                  ) : (
                    // 1-on-1 chat
                    <View style={styles.singleChatTimestampRow}>
                      {effectiveMessage.deliveryStatus === 'failed' ? (
                        <Text style={styles.failedStatusText}>Failed to deliver</Text>
                      ) : effectiveMessage.deliveryStatus === 'pending' ? (
                        <Text style={[styles.emptyStatusText, { color: theme.outline }]}>
                          Sending...
                        </Text>
                      ) : (
                        <View>
                          <Text style={[styles.timestampMain, { color: theme.onSurface }]}>
                            {deliveredDateStr}
                          </Text>
                          {deliveredTimeStr ? (
                            <Text style={[styles.timestampSub, { color: theme.outline }]}>
                              {deliveredTimeStr}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />

                {/* 3. SENT SECTION */}
                <View style={styles.statusSection}>
                  <View style={styles.statusHeaderRow}>
                    <Ionicons
                      name={effectiveMessage.deliveryStatus === 'pending' ? 'time-outline' : 'checkmark'}
                      size={20}
                      color="#94A3B8"
                    />
                    <View style={styles.statusHeaderInfo}>
                      <Text style={[styles.statusTitle, { color: theme.onSurface }]}>Sent</Text>
                      <Text style={[styles.statusBadgeText, { color: theme.outline }]}>
                        From your device
                      </Text>
                    </View>
                  </View>
                  <View style={styles.singleChatTimestampRow}>
                    <Text style={[styles.timestampMain, { color: theme.onSurface }]}>
                      {sentDateStr}
                    </Text>
                    <Text style={[styles.timestampSub, { color: theme.outline }]}>
                      {sentTimeStr}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              // ─── INCOMING MESSAGE DETAILS ───
              <>
                {/* 1. SENDER ROW */}
                <View style={styles.statusSection}>
                  <View style={styles.statusHeaderRow}>
                    <Ionicons name="person-circle-outline" size={24} color={theme.primary} />
                    <View style={styles.statusHeaderInfo}>
                      <Text style={[styles.statusTitle, { color: theme.onSurface }]}>From</Text>
                      <Text style={[styles.participantName, { color: theme.onSurface, marginTop: 2 }]}>
                        {senderDisplayName}
                      </Text>
                      {senderEmail ? (
                        <Text style={[styles.participantEmail, { color: theme.outline }]}>
                          {senderEmail}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>

                <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />

                {/* 2. READ BY YOU */}
                <View style={styles.statusSection}>
                  <View style={styles.statusHeaderRow}>
                    <Ionicons name="checkmark-done" size={22} color="#38BDF8" />
                    <View style={styles.statusHeaderInfo}>
                      <Text style={[styles.statusTitle, { color: theme.onSurface }]}>Read</Text>
                      <Text style={[styles.statusBadgeText, { color: theme.outline }]}>
                        Read by you
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />

                {/* 3. SENT BY SENDER */}
                <View style={styles.statusSection}>
                  <View style={styles.statusHeaderRow}>
                    <Ionicons name="checkmark" size={20} color="#94A3B8" />
                    <View style={styles.statusHeaderInfo}>
                      <Text style={[styles.statusTitle, { color: theme.onSurface }]}>Sent</Text>
                      <Text style={[styles.statusBadgeText, { color: theme.outline }]}>
                        Sent by {senderDisplayName}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.singleChatTimestampRow}>
                    <Text style={[styles.timestampMain, { color: theme.onSurface }]}>
                      {sentDateStr}
                    </Text>
                    <Text style={[styles.timestampSub, { color: theme.outline }]}>
                      {sentTimeStr}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* ─── Reactions Section (if any) ─── */}
          {Array.isArray(effectiveMessage.reactions) && effectiveMessage.reactions.length > 0 && (
            <View
              style={[
                styles.card,
                styles.reactionsCard,
                {
                  backgroundColor: theme.isDark ? '#1F2C34' : '#FFFFFF',
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <View style={styles.reactionsHeader}>
                <Text style={[styles.statusTitle, { color: theme.onSurface }]}>Reactions</Text>
                <View style={[styles.countPill, { backgroundColor: theme.cardItem }]}>
                  <Text style={[styles.countPillText, { color: theme.primary }]}>
                    {effectiveMessage.reactions.length}
                  </Text>
                </View>
              </View>

              <View style={styles.reactionsList}>
                {effectiveMessage.reactions.map((r: MessageReaction, index: number) => {
                  const isMyReaction =
                    String(r.userId) === String(currentUserId || 'me') ||
                    (sessionUserName && r.userName === sessionUserName);
                  const reactorName = isMyReaction ? 'You' : r.userName || 'Participant';

                  return (
                    <View
                      key={`${r.emoji}-${r.userId}-${index}`}
                      style={[
                        styles.reactionRow,
                        index > 0 && styles.reactionRowBorder,
                        { borderColor: theme.cardBorder },
                      ]}
                    >
                      <Text style={styles.reactionEmojiLarge}>{r.emoji}</Text>
                      <View style={styles.reactionReactorInfo}>
                        <Text style={[styles.participantName, { color: theme.onSurface }]}>
                          {reactorName}
                        </Text>
                        {r.createdAt && (
                          <Text style={[styles.reactionTimeText, { color: theme.outline }]}>
                            {formatFullDateTime(r.createdAt, false)}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ─── End-to-End Encryption Notice ─── */}
          <View
            style={[
              styles.securityBanner,
              {
                backgroundColor: theme.isDark ? 'rgba(16, 185, 129, 0.10)' : '#ECFDF5',
                borderColor: theme.isDark ? 'rgba(16, 185, 129, 0.28)' : '#A7F3D0',
              },
            ]}
          >
            <Ionicons name="lock-closed" size={20} color="#10B981" style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.securityTitle}>End-to-end encrypted</Text>
              <Text style={[styles.securityDescription, { color: theme.isDark ? '#D1FAE5' : '#065F46' }]}>
                Messages and calls are end-to-end encrypted. Nobody outside of this chat, not even Chatuk, can read or listen to them.
              </Text>
            </View>
          </View>

          {/* ─── Message Metadata Footer ─── */}
          <View style={styles.metadataFooter}>
            <Text style={[styles.metadataText, { color: theme.outline }]}>
              Type: {effectiveMessage.type || 'text'} • Status: {effectiveMessage.deliveryStatus || 'delivered'}
            </Text>
            {effectiveMessage.clientMessageId && (
              <Text style={[styles.metadataIdText, { color: theme.outline }]} numberOfLines={1}>
                ID: {effectiveMessage.clientMessageId}
              </Text>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

/**
 * Render message content inside preview bubble
 */
function renderMessageBody(message: SocketMessage, textColor: string) {
  if (isValidImageUri(message.fileUrl) && message.type === 'image') {
    return (
      <View style={styles.previewImageContainer}>
        <Image
          source={getSafeImageSource(message.fileUrl)}
          style={styles.previewImage}
          contentFit="cover"
          transition={200}
        />
        {message.content ? (
          <Text style={[styles.previewCaption, { color: textColor }]}>
            {message.content}
          </Text>
        ) : null}
      </View>
    );
  }

  if (message.type === 'video') {
    return (
      <View style={styles.previewMediaPlaceholder}>
        <Ionicons name="videocam" size={26} color={textColor} />
        <Text style={[styles.previewMediaText, { color: textColor }]}>
          {message.content || 'Video message'}
        </Text>
      </View>
    );
  }

  if (message.type === 'audio') {
    return (
      <View style={styles.previewMediaPlaceholder}>
        <Ionicons name="mic" size={24} color={textColor} />
        <Text style={[styles.previewMediaText, { color: textColor }]}>
          Voice message
        </Text>
      </View>
    );
  }

  return (
    <Text style={[styles.previewText, { color: textColor }]}>
      {message.content || '🔒 Encrypted message'}
    </Text>
  );
}

/**
 * Participant Avatar circle
 */
const UserAvatar: React.FC<{ user: ParticipantInfo; theme: any }> = ({ user, theme }) => {
  const initial = (user.name || user.email || 'U').charAt(0).toUpperCase();

  if (isValidImageUri(user.image)) {
    return (
      <Image
        source={getSafeImageSource(user.image)}
        style={styles.avatarImage}
        contentFit="cover"
      />
    );
  }

  return (
    <View style={[styles.avatarFallback, { backgroundColor: theme.primary }]}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonPlaceholder: {
    width: 44,
  },
  buttonPressed: {
    opacity: 0.65,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
  },
  previewSection: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    elevation: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  bubbleWrapper: {
    width: '100%',
  },
  bubbleWrapperRight: {
    alignItems: 'flex-end',
  },
  bubbleWrapperLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  outgoingBubble: {
    borderBottomRightRadius: 4,
  },
  incomingBubble: {
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  senderNamePreview: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  previewText: {
    fontSize: 15,
    lineHeight: 21,
  },
  previewCaption: {
    fontSize: 14,
    lineHeight: 19,
    marginTop: 6,
  },
  previewImageContainer: {
    width: 220,
  },
  previewImage: {
    width: 220,
    height: 160,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  previewMediaPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  previewMediaText: {
    fontSize: 15,
    fontWeight: '500',
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  outgoingTimeText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  incomingTimeText: {
    fontSize: 11,
  },
  enrichingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
  },
  enrichingText: {
    fontSize: 12,
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  statusSection: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusHeaderInfo: {
    marginLeft: 12,
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  statusBadgeText: {
    fontSize: 12,
    marginTop: 2,
  },
  singleChatTimestampRow: {
    marginLeft: 34,
    marginTop: 6,
  },
  timestampMain: {
    fontSize: 14,
    fontWeight: '600',
  },
  timestampSub: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyStatusText: {
    fontSize: 14,
    marginLeft: 34,
    marginTop: 6,
  },
  failedStatusText: {
    fontSize: 14,
    color: '#EF4444',
    fontWeight: '600',
    marginTop: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 10,
    marginLeft: 50,
  },
  participantList: {
    marginTop: 10,
    marginLeft: 12,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  participantInfo: {
    flex: 1,
    marginLeft: 12,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '600',
  },
  participantEmail: {
    fontSize: 12,
    marginTop: 1,
  },
  receiptCheckContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  receiptTimeText: {
    fontSize: 11,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  reactionsCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  reactionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reactionsList: {
    marginTop: 4,
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  reactionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reactionEmojiLarge: {
    fontSize: 26,
    marginRight: 14,
  },
  reactionReactorInfo: {
    flex: 1,
  },
  reactionTimeText: {
    fontSize: 11,
    marginTop: 2,
  },
  securityBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  securityTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 2,
  },
  securityDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  metadataFooter: {
    marginTop: 20,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  metadataText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  metadataIdText: {
    fontSize: 11,
    marginTop: 4,
  },
});
