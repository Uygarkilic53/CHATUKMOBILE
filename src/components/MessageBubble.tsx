import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { SocketMessage } from '../services/socket';
import { getSafeImageSource, isValidImageUri } from '../utils/image';
import { VoiceMessageBubble } from './VoiceMessageBubble';

export interface MessageBubbleProps {
  item: SocketMessage;
  isMe: boolean;
  showDateSeparator: boolean;
  dateText: string | null;
  recipientName?: string;
  isGroupChat?: boolean;
  senderName?: string;
  theme: any;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  sessionUserName?: string | null;
  onBubblePress: (item: SocketMessage) => void;
  onBubbleLongPress: (item: SocketMessage) => void;
  onOpenImageGallery: (url: string) => void;
  onActiveVideo: (url: string) => void;
  onOpenSecurityModal: () => void;
  onToggleReaction?: (msg: SocketMessage, emoji: string, action: 'add' | 'remove') => void;
  onOpenReactionPicker?: (msg: SocketMessage) => void;
  isAnimatingHeart?: boolean;
  heartOpacityAnim?: Animated.Value;
  heartScaleAnim?: Animated.Value;
  isAutoDownloadEnabled?: boolean;
  isMediaDownloaded?: boolean;
  onDownloadMedia?: (messageId: string) => Promise<void>;
  onRetryMessage?: (item: SocketMessage) => void;
}

export const formatMessageTime = (dateString?: string): string => {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '';
  }
};

const WHATSAPP_SENDER_COLORS = [
  '#00A884', // WhatsApp Teal
  '#25D366', // WhatsApp Green
  '#128C7E', // Dark Teal
  '#34B7F1', // Light Blue
  '#E542A3', // Magenta Pink
  '#9C27B0', // Purple
  '#FF7043', // Deep Orange
  '#FFB300', // Amber
  '#00ACC1', // Cyan
  '#5C6BC0', // Indigo
  '#8E24AA', // Violet
  '#039BE5', // Sky Blue
  '#43A047', // Green
  '#D81B60', // Rose
];

export function getSenderColor(senderId?: string | null): string {
  if (!senderId) return '#6366F1';
  let hash = 0;
  for (let i = 0; i < senderId.length; i++) {
    hash = (hash << 5) - hash + senderId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % WHATSAPP_SENDER_COLORS.length;
  return WHATSAPP_SENDER_COLORS[index];
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
  item,
  isMe,
  showDateSeparator,
  dateText,
  recipientName,
  isGroupChat,
  senderName,
  theme,
  currentUserId,
  currentUserEmail,
  sessionUserName,
  onBubblePress,
  onBubbleLongPress,
  onOpenImageGallery,
  onActiveVideo,
  onOpenSecurityModal,
  onToggleReaction,
  onOpenReactionPicker,
  isAnimatingHeart,
  heartOpacityAnim,
  heartScaleAnim,
  isAutoDownloadEnabled = true,
  isMediaDownloaded = false,
  onDownloadMedia,
  onRetryMessage,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  // Render system notice message
  if (item.type === 'system') {
    const isSecurityNotice =
      (item.content || '').includes('security code') ||
      (item.content || '').includes('changed');
    return (
      <View key={item._id} style={styles.systemNoticeRow}>
        <Pressable
          onPress={() => {
            if (isSecurityNotice) {
              onOpenSecurityModal();
            }
          }}
          style={[
            styles.systemNoticeChip,
            {
              backgroundColor: theme.isDark ? '#1E293B' : '#F1F5F9',
              borderColor: theme.cardBorder,
            },
          ]}
        >
          <Ionicons
            name={isSecurityNotice ? 'shield-checkmark' : 'information-circle'}
            size={14}
            color="#6366F1"
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.systemNoticeText, { color: theme.onSurfaceVariant }]}>
            {item.content}
          </Text>
          {isSecurityNotice && (
            <Feather name="chevron-right" size={13} color="#6366F1" style={{ marginLeft: 4 }} />
          )}
        </Pressable>
      </View>
    );
  }

  // Render reaction pill
  const renderReactionPill = () => {
    if (!item.reactions || item.reactions.length === 0) return null;

    const counts: { [emoji: string]: number } = {};
    let userReactedEmoji: string | null = null;
    const myId = currentUserId ? String(currentUserId) : '';

    for (const r of item.reactions) {
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      if (
        (myId && String(r.userId) === myId) ||
        r.userId === 'me' ||
        (currentUserEmail && r.userName === currentUserEmail) ||
        (sessionUserName && r.userName === sessionUserName)
      ) {
        userReactedEmoji = r.emoji;
      }
    }

    const entries = Object.entries(counts);
    if (entries.length === 0) return null;

    return (
      <Pressable
        onPress={() => {
          if (userReactedEmoji) {
            onToggleReaction?.(item, userReactedEmoji, 'remove');
          } else {
            onOpenReactionPicker?.(item);
          }
        }}
        onLongPress={() => onBubbleLongPress(item)}
        style={({ pressed }) => [
          styles.reactionPill,
          isMe ? styles.reactionPillSent : styles.reactionPillReceived,
          {
            backgroundColor: theme.card,
          },
          pressed && styles.bubblePressed,
        ]}
        hitSlop={6}
      >
        <View style={styles.reactionEmojisRow}>
          {entries.map(([emoji]) => (
            <Text key={emoji} style={styles.reactionEmojiText}>
              {emoji}
            </Text>
          ))}
          {item.reactions.length > 1 && (
            <Text style={[styles.reactionCountText, { color: theme.onSurfaceVariant }]}>
              {item.reactions.length}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const audioExtensions = /\.(m4a|mp3|wav|aac|ogg|opus|webm)(\?.*)?$/i;
  const isAudioMedia =
    item.type === 'audio' ||
    (typeof item.fileUrl === 'string' && (audioExtensions.test(item.fileUrl) || item.fileUrl.includes('chatuk/VoiceMessages'))) ||
    (typeof (item.fileUrl as any)?.uri === 'string' && (audioExtensions.test((item.fileUrl as any).uri) || (item.fileUrl as any).uri.includes('chatuk/VoiceMessages')));

  const isVideoMedia =
    item.type === 'video' ||
    (typeof item.fileUrl === 'string' && /\.(mp4|mov|webm|m4v|3gp|mkv)(\?.*)?$/i.test(item.fileUrl) && !isAudioMedia);

  return (
    <View style={{ position: 'relative' }}>
      {showDateSeparator && dateText && (
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
              {dateText}
            </Text>
          </View>
        </View>
      )}

      <View
        style={[
          styles.messageRow,
          isMe ? styles.messageRowSent : styles.messageRowReceived,
        ]}
      >
        {isMe ? (
          // Sent Message Bubble: Stitch design vibrant indigo-to-purple gradient on the RIGHT
          <View style={styles.sentContainer}>
            <Pressable
              onPress={() => onBubblePress(item)}
              onLongPress={() => onBubbleLongPress(item)}
              delayLongPress={280}
              {...(Platform.OS === 'web'
                ? {
                    onContextMenu: (e: any) => {
                      e?.preventDefault?.();
                      onBubbleLongPress(item);
                    },
                  }
                : {})}
              style={({ pressed }) => [styles.sentPressable, pressed && styles.bubblePressed]}
            >
              <LinearGradient
                colors={['#6366F1', '#A855F7']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sentBubble}
              >
                {isValidImageUri(item.fileUrl) ? (
                  isAudioMedia ? (
                    <VoiceMessageBubble
                      audioUrl={typeof item.fileUrl === 'string' ? item.fileUrl : (item.fileUrl as any).uri}
                      isOutgoing={true}
                    />
                  ) : isVideoMedia ? (
                    <Pressable
                      onPress={() => item.fileUrl && onActiveVideo(item.fileUrl)}
                      onLongPress={() => onBubbleLongPress(item)}
                      delayLongPress={280}
                      style={styles.bubbleMediaWrapper}
                    >
                      <View style={styles.bubbleVideoContainer}>
                        <Image
                          source={getSafeImageSource(item.fileUrl)}
                          style={styles.bubbleMediaImage}
                          contentFit="cover"
                        />
                        <View style={styles.videoPlayOverlay}>
                          <View style={styles.videoPlayCircle}>
                            <Ionicons name="play" size={24} color="#FFFFFF" style={{ marginLeft: 3 }} />
                          </View>
                          <View style={styles.videoBadge}>
                            <Ionicons name="videocam" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
                            <Text style={styles.videoBadgeText}>VIDEO</Text>
                          </View>
                        </View>
                      </View>
                      {item.content ? (
                        <Text style={[styles.sentText, { marginTop: 6 }]}>{item.content}</Text>
                      ) : null}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => item.fileUrl && onOpenImageGallery(item.fileUrl)}
                      onLongPress={() => onBubbleLongPress(item)}
                      delayLongPress={280}
                      style={styles.bubbleMediaWrapper}
                    >
                      <Image
                        source={getSafeImageSource(item.fileUrl)}
                        style={styles.bubbleMediaImage}
                        contentFit="cover"
                        transition={200}
                      />
                      {item.content ? (
                        <Text style={[styles.sentText, { marginTop: 6 }]}>{item.content}</Text>
                      ) : null}
                    </Pressable>
                  )
                ) : (
                  <Text style={styles.sentText}>{item.content}</Text>
                )}

                {/* Heart burst animation on double tap */}
                {isAnimatingHeart && heartOpacityAnim && heartScaleAnim && (
                  <Animated.View
                    style={[
                      styles.heartBurstOverlay,
                      {
                        opacity: heartOpacityAnim,
                        transform: [{ scale: heartScaleAnim }],
                      },
                    ]}
                    pointerEvents="none"
                  >
                    <Ionicons name="heart" size={44} color="#EF4444" />
                  </Animated.View>
                )}
              </LinearGradient>
            </Pressable>

            {/* Emoji Reactions Pill */}
            {renderReactionPill()}

            {item.deliveryStatus === 'failed' ? (
              <Pressable
                onPress={() => onRetryMessage?.(item)}
                style={styles.failedStatusContainer}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Failed to send. Tap to retry"
              >
                <Ionicons name="alert-circle" size={13} color="#EF4444" style={{ marginRight: 3 }} />
                <Text style={styles.failedStatusText}>Failed to send</Text>
                <Ionicons name="refresh" size={12} color="#EF4444" style={{ marginLeft: 3 }} />
              </Pressable>
            ) : item.deliveryStatus === 'pending' ? (
              <View style={styles.sentMeta}>
                <Text style={[styles.timeText, { color: theme.outline }]}>
                  {formatMessageTime(item.createdAt)}
                </Text>
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={theme.outline}
                  style={{ marginLeft: 3 }}
                />
              </View>
            ) : (
              <View style={styles.sentMeta}>
                <Text style={[styles.timeText, { color: theme.outline }]}>
                  {formatMessageTime(item.createdAt)}
                </Text>
                <Ionicons
                  name="checkmark-done"
                  size={15}
                  color={item.readBy && item.readBy.length > 1 ? '#818CF8' : theme.outline}
                  style={{ marginLeft: 3 }}
                />
              </View>
            )}
          </View>
        ) : (
          // Received Message Bubble: Frosted glass container on the LEFT
          <View style={styles.receivedContainer}>
            <View style={styles.receivedSenderHeader}>
              <View
                style={[
                  styles.receivedSenderDot,
                  { backgroundColor: isGroupChat ? getSenderColor(item.senderId) : '#0EA5E9' },
                ]}
              />
              <Text
                style={[
                  styles.receivedSenderName,
                  { color: isGroupChat ? getSenderColor(item.senderId) : theme.onSurface },
                ]}
              >
                {(isGroupChat ? senderName : recipientName) || recipientName || 'Member'}
              </Text>
            </View>
            <Pressable
              onPress={() => onBubblePress(item)}
              onLongPress={() => onBubbleLongPress(item)}
              delayLongPress={280}
              {...(Platform.OS === 'web'
                ? {
                    onContextMenu: (e: any) => {
                      e?.preventDefault?.();
                      onBubbleLongPress(item);
                    },
                  }
                : {})}
              style={({ pressed }) => [styles.receivedPressable, pressed && styles.bubblePressed]}
            >
              <View
                style={[
                  styles.receivedBubble,
                  {
                    backgroundColor: theme.isDark ? '#1E293B' : theme.card,
                    borderColor: theme.cardBorder,
                    borderLeftWidth: 3.5,
                    borderLeftColor: isGroupChat ? getSenderColor(item.senderId) : '#0EA5E9',
                  },
                ]}
              >
                {isValidImageUri(item.fileUrl) ? (
                  isAudioMedia ? (
                    <VoiceMessageBubble
                      audioUrl={typeof item.fileUrl === 'string' ? item.fileUrl : (item.fileUrl as any).uri}
                      isOutgoing={false}
                    />
                  ) : !isAutoDownloadEnabled && !isMediaDownloaded ? (
                    <Pressable
                      onPress={async () => {
                        if (isDownloading) return;
                        setIsDownloading(true);
                        try {
                          const msgId = item._id || item.clientMessageId || '';
                          if (onDownloadMedia) {
                            await onDownloadMedia(msgId);
                          }
                        } finally {
                          setIsDownloading(false);
                        }
                      }}
                      onLongPress={() => onBubbleLongPress(item)}
                      delayLongPress={280}
                      style={[
                        styles.bubbleMediaWrapper,
                        styles.whatsappPlaceholderContainer,
                        {
                          backgroundColor: theme.isDark ? '#0B0F17' : '#1E293B',
                          borderColor: theme.cardBorder,
                        },
                      ]}
                    >
                      <View style={styles.whatsappPlaceholderContent}>
                        <View style={styles.whatsappDownloadCircle}>
                          {isDownloading ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Feather name="arrow-down" size={22} color="#FFFFFF" />
                          )}
                        </View>
                        <View style={styles.whatsappSizeBadge}>
                          <Text style={styles.whatsappSizeBadgeText}>
                            {isVideoMedia ? '🎥 4.2 MB' : '📷 1.8 MB'}
                          </Text>
                        </View>
                        <Text style={styles.whatsappTapToDownloadText}>
                          {isDownloading ? 'Downloading...' : 'Tap to download'}
                        </Text>
                      </View>
                      {item.content ? (
                        <Text style={[styles.receivedText, { marginTop: 6, color: theme.onSurface }]}>
                          {item.content}
                        </Text>
                      ) : null}
                    </Pressable>
                  ) : isVideoMedia ? (
                    <Pressable
                      onPress={() => item.fileUrl && onActiveVideo(item.fileUrl)}
                      onLongPress={() => onBubbleLongPress(item)}
                      delayLongPress={280}
                      style={styles.bubbleMediaWrapper}
                    >
                      <View style={styles.bubbleVideoContainer}>
                        <Image
                          source={getSafeImageSource(item.fileUrl)}
                          style={styles.bubbleMediaImage}
                          contentFit="cover"
                        />
                        <View style={styles.videoPlayOverlay}>
                          <View style={styles.videoPlayCircle}>
                            <Ionicons name="play" size={24} color="#FFFFFF" style={{ marginLeft: 3 }} />
                          </View>
                          <View style={styles.videoBadge}>
                            <Ionicons name="videocam" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
                            <Text style={styles.videoBadgeText}>VIDEO</Text>
                          </View>
                        </View>
                      </View>
                      {item.content ? (
                        <Text style={[styles.receivedText, { marginTop: 6, color: theme.onSurface }]}>
                          {item.content}
                        </Text>
                      ) : null}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => item.fileUrl && onOpenImageGallery(item.fileUrl)}
                      onLongPress={() => onBubbleLongPress(item)}
                      delayLongPress={280}
                      style={styles.bubbleMediaWrapper}
                    >
                      <Image
                        source={getSafeImageSource(item.fileUrl)}
                        style={styles.bubbleMediaImage}
                        contentFit="cover"
                        transition={200}
                      />
                      {item.content ? (
                        <Text style={[styles.receivedText, { marginTop: 6, color: theme.onSurface }]}>
                          {item.content}
                        </Text>
                      ) : null}
                    </Pressable>
                  )
                ) : (
                  <Text style={[styles.receivedText, { color: theme.onSurface }]}>
                    {item.content}
                  </Text>
                )}

                {/* Heart burst animation on double tap */}
                {isAnimatingHeart && heartOpacityAnim && heartScaleAnim && (
                  <Animated.View
                    style={[
                      styles.heartBurstOverlay,
                      {
                        opacity: heartOpacityAnim,
                        transform: [{ scale: heartScaleAnim }],
                      },
                    ]}
                    pointerEvents="none"
                  >
                    <Ionicons name="heart" size={44} color="#EF4444" />
                  </Animated.View>
                )}
              </View>
            </Pressable>

            {/* Emoji Reactions Pill */}
            {renderReactionPill()}

            <View style={styles.receivedMeta}>
              <Text style={[styles.timeText, { color: theme.outline }]}>
                {formatMessageTime(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
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
  sentPressable: {
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
  failedStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    marginTop: 4,
    marginRight: 4,
  },
  failedStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#EF4444',
  },
  receivedContainer: {
    maxWidth: '82%',
    alignItems: 'flex-start',
  },
  receivedPressable: {
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
  bubblePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
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
    fontWeight: '700',
    letterSpacing: 0.5,
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
  whatsappPlaceholderContainer: {
    width: 220,
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  whatsappPlaceholderContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  whatsappDownloadCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  whatsappSizeBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  whatsappSizeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  whatsappTapToDownloadText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
  },
});

function areMessageBubblesEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (prev.item._id !== next.item._id) return false;
  if (prev.item.clientMessageId !== next.item.clientMessageId) return false;
  if (prev.item.content !== next.item.content) return false;
  if (prev.item.fileUrl !== next.item.fileUrl) return false;
  if (prev.item.type !== next.item.type) return false;
  if (prev.isMe !== next.isMe) return false;
  if (prev.showDateSeparator !== next.showDateSeparator) return false;
  if (prev.dateText !== next.dateText) return false;
  if (prev.recipientName !== next.recipientName) return false;
  if (prev.theme?.isDark !== next.theme?.isDark) return false;
  if (prev.isAnimatingHeart !== next.isAnimatingHeart) return false;
  if ((prev.item.readBy?.length || 0) !== (next.item.readBy?.length || 0)) return false;
  if ((prev.item.reactions?.length || 0) !== (next.item.reactions?.length || 0)) return false;
  if (prev.currentUserId !== next.currentUserId) return false;
  if (prev.isAutoDownloadEnabled !== next.isAutoDownloadEnabled) return false;
  if (prev.isMediaDownloaded !== next.isMediaDownloaded) return false;
  if (prev.item.deliveryStatus !== next.item.deliveryStatus) return false;
  if (prev.onRetryMessage !== next.onRetryMessage) return false;
  return true;
}

export const MessageBubble = React.memo(MessageBubbleComponent, areMessageBubblesEqual);
export default MessageBubble;
