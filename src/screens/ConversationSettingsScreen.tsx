import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Share,
  Modal,
  ActivityIndicator,
  Alert,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { api, getActiveUserIdSync } from '../lib/api';
import { socketService } from '../services/socket';
import SecurityCodeModal from '../components/SecurityCodeModal';
import { useToast } from '../components/Toast';
import { getSafeImageSource } from '../utils/image';
import { deleteLocalConversation, deleteLocalMessage } from '../e2ee/localDb';

interface Participant {
  _id: string;
  name: string;
  email: string;
  image: string | null;
  isOnline?: boolean;
  lastActiveAt?: string | null;
  isAdmin?: boolean;
}

interface MediaItem {
  _id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  type: string;
  content: string;
  fileUrl?: string | null;
  createdAt: string;
}

interface ConversationSettingsScreenProps {
  conversationId: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 48) / 3;

export default function ConversationSettingsScreen({ conversationId }: ConversationSettingsScreenProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [conversationType, setConversationType] = useState<'direct' | 'group'>('direct');
  const [recipient, setRecipient] = useState<Participant | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Group metadata state
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupAvatarUrl, setGroupAvatarUrl] = useState<string | null>(null);
  const [groupAdminIds, setGroupAdminIds] = useState<string[]>([]);
  const [groupParticipants, setGroupParticipants] = useState<Participant[]>([]);
  const [creatorName, setCreatorName] = useState('Member');
  const [groupCreatedAt, setGroupCreatedAt] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => getActiveUserIdSync());
  const [isAdmin, setIsAdmin] = useState(false);

  // Media state
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);

  // Direct chat dialog modals state
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConvConfirm, setShowDeleteConvConfirm] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showDeleteMediaConfirm, setShowDeleteMediaConfirm] = useState<MediaItem | null>(null);
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  // Group management modals state
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [showEditDescModal, setShowEditDescModal] = useState(false);
  const [editDescInput, setEditDescInput] = useState('');
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [activeMemberModal, setActiveMemberModal] = useState<Participant | null>(null);
  const [showExitGroupConfirm, setShowExitGroupConfirm] = useState(false);

  // Load conversation details & media
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [convRes, mediaRes] = await Promise.all([
          api.getConversation(conversationId),
          api.getConversationMedia(conversationId),
        ]);

        if (!isMounted) return;

        if (convRes?.conversation) {
          const myId = convRes.currentUserId || currentUserId;
          const myEmail = convRes.currentUserEmail;
          if (myId) setCurrentUserId(myId);

          if (convRes.conversation.type === 'group') {
            setConversationType('group');
            try {
              const groupRes = await api.getGroupDetails(conversationId);
              if (groupRes?.group && isMounted) {
                setGroupName(groupRes.group.name || 'Group');
                setGroupDescription(groupRes.group.description || '');
                setGroupAvatarUrl(groupRes.group.groupAvatarUrl || null);
                const aIds = groupRes.group.adminIds || [];
                setGroupAdminIds(aIds);
                setGroupParticipants(groupRes.group.participants || []);
                setCreatorName(groupRes.group.creatorName || 'Member');
                setGroupCreatedAt(groupRes.group.createdAt || convRes.conversation.createdAt);
                if (myId) {
                  setIsAdmin(aIds.includes(myId));
                }
              }
            } catch (groupErr) {
              console.warn('Failed to load group details:', groupErr);
            }
          } else {
            setConversationType('direct');
            const otherUser = convRes.conversation.participants.find((p: Participant) => {
              if (myId && p._id === myId) return false;
              if (myEmail && p.email?.toLowerCase() === myEmail.toLowerCase()) return false;
              return true;
            }) || convRes.conversation.participants[0];

            setRecipient(otherUser);
            setIsBlocked(!!convRes.conversation.isBlocked);
          }
        }

        if (mediaRes?.media) {
          setMediaList(mediaRes.media);
        }
      } catch (err) {
        console.error('Failed to load conversation settings:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [conversationId, currentUserId]);

  // Real-time socket listeners
  useEffect(() => {
    const unsubClear = socketService.onConversationCleared((data) => {
      if (data.conversationId === conversationId) {
        setMediaList([]);
      }
    });

    const unsubDelete = socketService.onMessageDeleted((data) => {
      if (data.conversationId === conversationId) {
        setMediaList((prev) => prev.filter((m) => m._id !== data.messageId));
        if (selectedMedia?._id === data.messageId) {
          setSelectedMedia(null);
        }
      }
    });

    const unsubGroupUpdated = socketService.onGroupUpdated((data) => {
      if (data.conversationId === conversationId) {
        if (data.name !== undefined) setGroupName(data.name || 'Group');
        if (data.description !== undefined) setGroupDescription(data.description || '');
        if (data.groupAvatarUrl !== undefined) setGroupAvatarUrl(data.groupAvatarUrl || null);
      }
    });

    const unsubGroupMemberAdded = socketService.onGroupMemberAdded((data) => {
      if (data.conversationId === conversationId && data.participants) {
        setGroupParticipants(data.participants);
        if (data.adminIds) {
          setGroupAdminIds(data.adminIds);
          if (currentUserId) setIsAdmin(data.adminIds.includes(currentUserId));
        }
      }
    });

    const unsubGroupMemberRemoved = socketService.onGroupMemberRemoved((data) => {
      if (data.conversationId === conversationId) {
        if (currentUserId && data.userId === currentUserId) {
          showToast('You were removed from this group', { type: 'error' });
          router.replace('/chats');
        } else if (data.participants) {
          setGroupParticipants(data.participants);
          if (data.adminIds) {
            setGroupAdminIds(data.adminIds);
            if (currentUserId) setIsAdmin(data.adminIds.includes(currentUserId));
          }
        }
      }
    });

    const unsubGroupAdminChanged = socketService.onGroupAdminChanged((data) => {
      if (data.conversationId === conversationId && data.adminIds) {
        setGroupAdminIds(data.adminIds);
        if (currentUserId) setIsAdmin(data.adminIds.includes(currentUserId));
        setGroupParticipants((prev) =>
          prev.map((p) => ({
            ...p,
            isAdmin: data.adminIds.includes(p._id),
          }))
        );
      }
    });

    const unsubGroupMemberLeft = socketService.onGroupMemberLeft((data) => {
      if (data.conversationId === conversationId) {
        setGroupParticipants((prev) => prev.filter((p) => p._id !== data.userId));
      }
    });

    return () => {
      unsubClear();
      unsubDelete();
      unsubGroupUpdated();
      unsubGroupMemberAdded();
      unsubGroupMemberRemoved();
      unsubGroupAdminChanged();
      unsubGroupMemberLeft();
    };
  }, [conversationId, selectedMedia, currentUserId, showToast, router]);

  // Format creation date
  const formattedCreationDate = useMemo(() => {
    if (!groupCreatedAt) return '';
    try {
      const d = new Date(groupCreatedAt);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  }, [groupCreatedAt]);

  // ─── 1. Share User / Group ───
  const handleShare = async () => {
    try {
      if (conversationType === 'group') {
        const shareMessage = `Group: ${groupName || 'Chatuk Group'}\n${groupParticipants.length} participants\nChat with us on Chatuk!`;
        await Share.share({
          title: `Share ${groupName || 'Group'}`,
          message: shareMessage,
        });
      } else {
        if (!recipient) return;
        const shareMessage = `Contact: ${recipient.name || 'Chatuk User'}\nEmail: ${recipient.email}\nChat with them on Chatuk!`;
        await Share.share({
          title: `Share ${recipient.name || recipient.email}`,
          message: shareMessage,
        });
      }
    } catch (err: any) {
      console.warn('Share dismissed or failed:', err);
    }
  };

  // ─── 2. Clear Conversation ───
  const handleClearConversation = async () => {
    try {
      setIsActionLoading(true);
      await api.clearConversation(conversationId);
      await deleteLocalConversation(conversationId);
      setMediaList([]);
      setShowClearConfirm(false);
      showToast('Conversation cleared successfully');
    } catch (err: any) {
      console.error('Failed to clear conversation:', err);
      Alert.alert('Error', err.message || 'Failed to clear conversation');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 3. Delete Conversation & Leave (Direct chat only) ───
  const handleDeleteConversation = async () => {
    try {
      setIsActionLoading(true);
      await api.deleteConversation(conversationId);
      await deleteLocalConversation(conversationId);
      setShowDeleteConvConfirm(false);
      router.replace('/chats');
    } catch (err: any) {
      console.error('Failed to delete conversation:', err);
      Alert.alert('Error', err.message || 'Failed to delete conversation');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 4. Block / Unblock User ───
  const handleToggleBlock = async () => {
    if (!recipient?._id) return;
    try {
      setIsActionLoading(true);
      if (isBlocked) {
        await api.unblockUser(recipient._id);
        setIsBlocked(false);
        showToast(`${recipient.name || 'User'} has been unblocked`);
      } else {
        await api.blockUser(recipient._id);
        setIsBlocked(true);
        showToast(`${recipient.name || 'User'} has been blocked`);
      }
      setShowBlockConfirm(false);
    } catch (err: any) {
      console.error('Failed to block/unblock user:', err);
      Alert.alert('Error', err.message || 'Operation failed');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 5. Delete Specific Media Item ───
  const handleDeleteMedia = async (mediaItem: MediaItem) => {
    try {
      setIsActionLoading(true);
      const clientMsgId = (mediaItem as any).clientMessageId;
      await deleteLocalMessage(conversationId, mediaItem._id, clientMsgId).catch(() => {});
      socketService.deleteMessage(mediaItem._id, conversationId, clientMsgId);
      await api.deleteMessage(mediaItem._id);
      setMediaList((prev) => prev.filter((m) => m._id !== mediaItem._id));
      if (selectedMedia?._id === mediaItem._id) {
        setSelectedMedia(null);
      }
      setShowDeleteMediaConfirm(null);
      showToast('Media deleted successfully');
    } catch (err: any) {
      console.error('Failed to delete media item:', err);
      Alert.alert('Error', err.message || 'Failed to delete media item');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 6. Group Photo Update (Admins Only) ───
  const handlePickGroupAvatar = async () => {
    if (!isAdmin) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setIsActionLoading(true);
        const asset = result.assets[0];
        const uploadRes = await api.uploadMedia({
          uri: asset.uri,
          name: 'group_avatar.jpg',
          type: asset.mimeType || 'image/jpeg',
          folder: 'chatuk/avatars',
        } as any);

        if (uploadRes?.url) {
          await api.updateGroupDetails(conversationId, {
            groupAvatarUrl: uploadRes.url,
            groupAvatarPublicId: uploadRes.publicId,
          });
          setGroupAvatarUrl(uploadRes.url);
          showToast('Group picture updated');
        }
      }
    } catch (err: any) {
      console.error('Error updating group picture:', err);
      showToast(err.message || 'Failed to update group picture', { type: 'error' });
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 7. Save Group Name (Admins Only) ───
  const handleSaveGroupName = async () => {
    const trimmed = editNameInput.trim();
    if (!trimmed) {
      Alert.alert('Validation', 'Group subject cannot be empty');
      return;
    }
    try {
      setIsActionLoading(true);
      await api.updateGroupDetails(conversationId, { name: trimmed });
      setGroupName(trimmed);
      setShowEditNameModal(false);
      showToast('Group subject updated');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update group subject');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 8. Save Group Description (Admins Only) ───
  const handleSaveGroupDesc = async () => {
    try {
      setIsActionLoading(true);
      const trimmed = editDescInput.trim();
      await api.updateGroupDetails(conversationId, { description: trimmed });
      setGroupDescription(trimmed);
      setShowEditDescModal(false);
      showToast('Group description updated');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update description');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 9. Add Group Participant (Admins Only) ───
  const handleAddMember = async () => {
    const trimmed = addMemberEmail.trim();
    if (!trimmed) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    try {
      setIsActionLoading(true);
      const res = await api.addGroupParticipants(conversationId, { emails: [trimmed] });
      if (res?.participants) {
        setGroupParticipants(res.participants);
        if (res.adminIds) setGroupAdminIds(res.adminIds);
      }
      setAddMemberEmail('');
      setShowAddMembersModal(false);
      showToast('Participant added successfully');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to add participant');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 10. Toggle Admin Role (Admins Only) ───
  const handleToggleAdminRole = async (member: Participant) => {
    try {
      setIsActionLoading(true);
      const newAction = member.isAdmin ? 'demote' : 'promote';
      const res = await api.changeGroupAdminRole(conversationId, member._id, newAction);
      if (res?.adminIds) {
        setGroupAdminIds(res.adminIds);
        setGroupParticipants((prev) =>
          prev.map((p) => ({
            ...p,
            isAdmin: res.adminIds.includes(p._id),
          }))
        );
      }
      setActiveMemberModal(null);
      showToast(newAction === 'promote' ? `${member.name} is now an admin` : `${member.name} dismissed as admin`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update admin role');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 11. Remove Participant (Admins Only) ───
  const handleRemoveMember = async (member: Participant) => {
    try {
      setIsActionLoading(true);
      const res = await api.removeGroupParticipant(conversationId, member._id);
      if (res?.participants) {
        setGroupParticipants(res.participants);
        if (res.adminIds) setGroupAdminIds(res.adminIds);
      } else {
        setGroupParticipants((prev) => prev.filter((p) => p._id !== member._id));
      }
      setActiveMemberModal(null);
      showToast(`${member.name} removed from group`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to remove member');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 12. Message Member Privately ───
  const handleMessagePrivately = async (member: Participant) => {
    try {
      setIsActionLoading(true);
      setActiveMemberModal(null);
      const res = await api.createOrFindConversation(member.email);
      if (res?.conversation?._id) {
        router.push({
          pathname: '/conversation/[id]',
          params: { id: res.conversation._id },
        });
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to start direct conversation');
    } finally {
      setIsActionLoading(false);
    }
  };

  // ─── 13. Exit Group (Members) ───
  const handleExitGroup = async () => {
    try {
      setIsActionLoading(true);
      await api.leaveGroup(conversationId);
      await deleteLocalConversation(conversationId);
      setShowExitGroupConfirm(false);
      showToast('You left the group');
      router.replace('/chats');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to leave group');
    } finally {
      setIsActionLoading(false);
    }
  };

  const isGroup = conversationType === 'group';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]} edges={['top', 'left', 'right']}>
      {/* ─── Top Header ─── */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.cardBorder }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={24} color={theme.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {isGroup ? 'Group Info' : 'Contact Info'}
        </Text>
        <Pressable
          onPress={handleShare}
          style={({ pressed }) => [styles.headerActionButton, pressed && styles.buttonPressed]}
          hitSlop={10}
          accessibilityLabel="Share"
        >
          <Feather name="share-2" size={20} color={theme.primary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* ─── Hero Card: Group or Direct Contact ─── */}
          <View style={[styles.heroCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            {isGroup ? (
              // Group Avatar
              <View style={styles.avatarWrapper}>
                <Pressable
                  onPress={isAdmin ? handlePickGroupAvatar : undefined}
                  disabled={!isAdmin || isActionLoading}
                  style={({ pressed }) => [pressed && isAdmin && styles.buttonPressed]}
                >
                  {groupAvatarUrl ? (
                    <Image
                      source={getSafeImageSource(groupAvatarUrl)}
                      style={[styles.avatar, { borderColor: theme.cardBorder }]}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.avatar,
                        styles.groupAvatarPlaceholder,
                        { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                      ]}
                    >
                      <Feather name="users" size={38} color={theme.primary} />
                    </View>
                  )}

                  {isAdmin && (
                    <View style={[styles.avatarEditBadge, { backgroundColor: theme.primary }]}>
                      <Feather name="camera" size={13} color="#ffffff" />
                    </View>
                  )}
                </Pressable>
              </View>
            ) : (
              // Direct User Avatar
              <View style={styles.avatarWrapper}>
                <Image
                  source={getSafeImageSource(recipient?.image)}
                  style={[styles.avatar, { borderColor: theme.cardBorder }]}
                  contentFit="cover"
                />
                {recipient?.isOnline && (
                  <View style={[styles.onlineIndicator, { backgroundColor: theme.online, borderColor: theme.card }]} />
                )}
              </View>
            )}

            {/* Name / Subject Row */}
            {isGroup ? (
              <View style={styles.nameEditWrap}>
                <Text style={[styles.heroName, { color: theme.onSurface }]} numberOfLines={2}>
                  {groupName || 'Group'}
                </Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => {
                      setEditNameInput(groupName);
                      setShowEditNameModal(true);
                    }}
                    style={styles.inlineEditBtn}
                    hitSlop={8}
                    accessibilityLabel="Edit group name"
                  >
                    <Feather name="edit-2" size={16} color={theme.primary} />
                  </Pressable>
                )}
              </View>
            ) : (
              <Text style={[styles.heroName, { color: theme.onSurface }]}>
                {recipient?.name || recipient?.email || 'User'}
              </Text>
            )}

            {/* Subtitle / Email */}
            {isGroup ? (
              <Text style={[styles.heroEmail, { color: theme.onSurfaceVariant }]}>
                Group · {groupParticipants.length} participant{groupParticipants.length === 1 ? '' : 's'}
              </Text>
            ) : (
              <Text style={[styles.heroEmail, { color: theme.onSurfaceVariant }]}>
                {recipient?.email}
              </Text>
            )}

            {/* Direct Blocked Badge */}
            {!isGroup && isBlocked && (
              <View style={styles.blockedBadge}>
                <Feather name="slash" size={12} color="#EF4444" style={{ marginRight: 4 }} />
                <Text style={styles.blockedBadgeText}>Blocked</Text>
              </View>
            )}

            {/* Quick Actions Bar */}
            <View style={styles.quickActionsRow}>
              <Pressable
                onPress={handleShare}
                style={({ pressed }) => [
                  styles.quickActionButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)' }]}>
                  <Feather name="share-2" size={18} color={theme.primary} />
                </View>
                <Text style={[styles.quickActionLabel, { color: theme.onSurface }]}>Share</Text>
              </Pressable>

              <Pressable
                onPress={() => setShowClearConfirm(true)}
                style={({ pressed }) => [
                  styles.quickActionButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                  <Feather name="trash-2" size={18} color="#EF4444" />
                </View>
                <Text style={[styles.quickActionLabel, { color: '#EF4444' }]}>Clear</Text>
              </Pressable>

              {isGroup ? (
                <Pressable
                  onPress={() => setShowExitGroupConfirm(true)}
                  style={({ pressed }) => [
                    styles.quickActionButton,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                    <Feather name="log-out" size={18} color="#EF4444" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: '#EF4444' }]}>Exit</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setShowBlockConfirm(true)}
                  style={({ pressed }) => [
                    styles.quickActionButton,
                    { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: isBlocked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }]}>
                    <Feather name={isBlocked ? 'unlock' : 'slash'} size={18} color={isBlocked ? '#10B981' : '#EF4444'} />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: isBlocked ? '#10B981' : '#EF4444' }]}>
                    {isBlocked ? 'Unblock' : 'Block'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* ─── Group Description & Creation Meta Card ─── */}
          {isGroup && (
            <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionSubtitle, { color: theme.outline, marginBottom: 0 }]}>
                  GROUP DESCRIPTION
                </Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => {
                      setEditDescInput(groupDescription);
                      setShowEditDescModal(true);
                    }}
                    hitSlop={8}
                    style={styles.editDescBtn}
                  >
                    <Feather name="edit-2" size={14} color={theme.primary} />
                    <Text style={[styles.editDescBtnText, { color: theme.primary }]}>Edit</Text>
                  </Pressable>
                )}
              </View>

              <Text style={[styles.descriptionText, { color: groupDescription ? theme.onSurface : theme.outline }]}>
                {groupDescription || 'No description provided'}
              </Text>

              {formattedCreationDate ? (
                <View style={[styles.creationMetaRow, { borderTopColor: theme.cardBorder }]}>
                  <Feather name="info" size={14} color={theme.outline} style={{ marginRight: 6 }} />
                  <Text style={[styles.creationMetaText, { color: theme.outline }]}>
                    Created by {creatorName} on {formattedCreationDate}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {/* ─── Group Participants Section (WhatsApp Parity) ─── */}
          {isGroup && (
            <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleWrap}>
                  <Feather name="users" size={18} color={theme.primary} style={{ marginRight: 8 }} />
                  <Text style={[styles.sectionTitle, { color: theme.onSurface }]}>
                    {groupParticipants.length} Participants
                  </Text>
                </View>

                {isAdmin && (
                  <Pressable
                    onPress={() => {
                      setAddMemberEmail('');
                      setShowAddMembersModal(true);
                    }}
                    style={[styles.addMemberBtn, { backgroundColor: theme.cardItem, borderColor: theme.cardBorder }]}
                    hitSlop={6}
                  >
                    <Feather name="user-plus" size={14} color={theme.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.addMemberBtnText, { color: theme.primary }]}>Add</Text>
                  </Pressable>
                )}
              </View>

              {/* Members List */}
              <View style={styles.membersList}>
                {groupParticipants.map((member) => {
                  const isMe = currentUserId && (member._id === currentUserId || String(member._id) === String(currentUserId));
                  const memberIsAdmin = groupAdminIds.includes(member._id) || !!member.isAdmin;

                  return (
                    <Pressable
                      key={member._id}
                      onPress={() => {
                        if (!isMe) {
                          setActiveMemberModal({ ...member, isAdmin: memberIsAdmin });
                        }
                      }}
                      style={({ pressed }) => [
                        styles.memberRow,
                        { borderBottomColor: theme.cardBorder },
                        pressed && !isMe && styles.rowPressed,
                      ]}
                    >
                      <Image
                        source={getSafeImageSource(member.image)}
                        style={styles.memberAvatar}
                        contentFit="cover"
                      />
                      <View style={styles.memberInfo}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.memberName, { color: theme.onSurface }]} numberOfLines={1}>
                            {member.name || member.email?.split('@')[0]}
                          </Text>
                          {isMe && (
                            <Text style={[styles.youBadgeText, { color: theme.outline }]}>
                              (You)
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.memberEmail, { color: theme.outline }]} numberOfLines={1}>
                          {member.email}
                        </Text>
                      </View>

                      {memberIsAdmin && (
                        <View style={styles.adminPillBadge}>
                          <Text style={styles.adminPillText}>Group Admin</Text>
                        </View>
                      )}

                      {!isMe && (
                        <Feather name="chevron-right" size={16} color={theme.outline} style={{ marginLeft: 6 }} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* ─── End-to-End Encryption Security Card ─── */}
          <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Pressable
              onPress={() => setShowSecurityModal(true)}
              style={({ pressed }) => [styles.securityOptionRow, pressed && styles.buttonPressed]}
              accessibilityLabel="Verify Security Code"
            >
              <View style={[styles.securityOptionIconWrap, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
                <Ionicons name="shield-checkmark" size={20} color="#6366F1" />
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[styles.securityOptionTitle, { color: theme.onSurface }]}>Verify Security Code</Text>
                <Text style={[styles.securityOptionSubtitle, { color: theme.outline }]}>
                  {isGroup
                    ? 'Messages in this group are end-to-end encrypted with multi-recipient envelope cipher'
                    : `View safety number to verify encryption with ${recipient?.name || 'this contact'}`}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.outline} />
            </Pressable>
          </View>

          {/* ─── Media & Attachments Section ─── */}
          <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleWrap}>
                <Feather name="image" size={18} color={theme.primary} style={{ marginRight: 8 }} />
                <Text style={[styles.sectionTitle, { color: theme.onSurface }]}>Media & Files</Text>
              </View>
              <View style={[styles.counterPill, { backgroundColor: theme.cardItem, borderColor: theme.cardBorder }]}>
                <Text style={[styles.counterText, { color: theme.onSurfaceVariant }]}>
                  {mediaList.length}
                </Text>
              </View>
            </View>

            {mediaList.length === 0 ? (
              <View style={styles.emptyMediaWrap}>
                <Feather name="folder" size={32} color={theme.outline} style={{ marginBottom: 6 }} />
                <Text style={[styles.emptyMediaText, { color: theme.outline }]}>No media shared yet</Text>
              </View>
            ) : (
              <View style={styles.mediaGrid}>
                {mediaList.map((item) => (
                  <Pressable
                    key={item._id}
                    onPress={() => setSelectedMedia(item)}
                    style={({ pressed }) => [styles.gridItemWrap, pressed && styles.buttonPressed]}
                  >
                    <Image
                      source={getSafeImageSource(item.fileUrl || item.content)}
                      style={styles.gridImage}
                      contentFit="cover"
                      transition={200}
                    />
                    {item.type === 'audio' && (
                      <View style={styles.audioOverlay}>
                        <Feather name="mic" size={18} color="#FFFFFF" />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* ─── Actions & Danger Zone ─── */}
          <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.sectionSubtitle, { color: theme.outline }]}>ACTIONS & PRIVACY</Text>

            {/* Clear Conversation Row */}
            <Pressable
              onPress={() => setShowClearConfirm(true)}
              style={({ pressed }) => [
                styles.actionRow,
                { borderBottomColor: theme.cardBorder },
                pressed && styles.rowPressed,
              ]}
            >
              <View style={[styles.rowIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}>
                <Feather name="trash-2" size={18} color="#EF4444" />
              </View>
              <View style={styles.rowDetails}>
                <Text style={[styles.rowTitle, { color: '#EF4444' }]}>Clear Messages</Text>
                <Text style={[styles.rowSubtitle, { color: theme.onSurfaceVariant }]}>
                  Clear all text and media messages in this chat for you
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.outline} />
            </Pressable>

            {isGroup ? (
              // Exit Group Row
              <Pressable
                onPress={() => setShowExitGroupConfirm(true)}
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomWidth: 0 },
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={[styles.rowIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}>
                  <Feather name="log-out" size={18} color="#EF4444" />
                </View>
                <View style={styles.rowDetails}>
                  <Text style={[styles.rowTitle, { color: '#EF4444' }]}>Exit Group</Text>
                  <Text style={[styles.rowSubtitle, { color: theme.onSurfaceVariant }]}>
                    Leave this group conversation
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.outline} />
              </Pressable>
            ) : (
              // Delete Conversation Row (Direct chat only)
              <Pressable
                onPress={() => setShowDeleteConvConfirm(true)}
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderBottomWidth: 0 },
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={[styles.rowIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                  <Feather name="trash" size={18} color="#EF4444" />
                </View>
                <View style={styles.rowDetails}>
                  <Text style={[styles.rowTitle, { color: '#EF4444' }]}>Delete Conversation</Text>
                  <Text style={[styles.rowSubtitle, { color: theme.onSurfaceVariant }]}>
                    Permanently remove this chat and return to chats
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.outline} />
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}

      {/* ─── Lightbox Modal ─── */}
      <Modal
        visible={!!selectedMedia}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMedia(null)}
      >
        <View style={styles.lightboxContainer}>
          <SafeAreaView style={styles.lightboxHeader}>
            <Pressable
              onPress={() => setSelectedMedia(null)}
              style={({ pressed }) => [styles.lightboxCloseButton, pressed && styles.buttonPressed]}
              hitSlop={10}
            >
              <Feather name="x" size={24} color="#FFFFFF" />
            </Pressable>

            <View style={styles.lightboxHeaderActions}>
              <Pressable
                onPress={() => {
                  if (selectedMedia) {
                    Share.share({
                      url: selectedMedia.fileUrl || selectedMedia.content,
                      message: selectedMedia.fileUrl || selectedMedia.content,
                    });
                  }
                }}
                style={({ pressed }) => [styles.lightboxActionButton, pressed && styles.buttonPressed]}
                hitSlop={10}
              >
                <Feather name="share" size={20} color="#FFFFFF" />
              </Pressable>

              <Pressable
                onPress={() => {
                  if (selectedMedia) {
                    setShowDeleteMediaConfirm(selectedMedia);
                  }
                }}
                style={({ pressed }) => [
                  styles.lightboxActionButton,
                  { backgroundColor: 'rgba(239, 68, 68, 0.3)' },
                  pressed && styles.buttonPressed,
                ]}
                hitSlop={10}
              >
                <Feather name="trash-2" size={20} color="#EF4444" />
              </Pressable>
            </View>
          </SafeAreaView>

          <View style={styles.lightboxBody}>
            {selectedMedia && (
              <Image
                source={getSafeImageSource(selectedMedia.fileUrl || selectedMedia.content)}
                style={styles.lightboxImage}
                contentFit="contain"
              />
            )}
          </View>

          <SafeAreaView style={styles.lightboxFooter}>
            <Text style={styles.lightboxFooterDate}>
              {selectedMedia?.createdAt ? new Date(selectedMedia.createdAt).toLocaleString() : ''}
            </Text>
          </SafeAreaView>
        </View>
      </Modal>

      {/* ─── Clear Confirmation Modal ─── */}
      <Modal
        visible={showClearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={[styles.dialogIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Feather name="trash-2" size={28} color="#EF4444" />
            </View>

            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Clear Messages?</Text>
            <Text style={[styles.dialogMessage, { color: theme.onSurfaceVariant }]}>
              This will permanently clear all text messages, voice notes, and media files from this conversation for you.
            </Text>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowClearConfirm(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleClearConversation}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.dangerButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerButtonText}>Clear All</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Delete Conversation Modal (Direct only) ─── */}
      <Modal
        visible={showDeleteConvConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConvConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={[styles.dialogIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
              <Feather name="trash" size={28} color="#EF4444" />
            </View>

            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Delete Conversation?</Text>
            <Text style={[styles.dialogMessage, { color: theme.onSurfaceVariant }]}>
              Are you sure you want to permanently delete this conversation and all its history? You will be returned to your chats list.
            </Text>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowDeleteConvConfirm(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleDeleteConversation}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.dangerButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerButtonText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Block Confirmation Modal ─── */}
      <Modal
        visible={showBlockConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBlockConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View
              style={[
                styles.dialogIconWrap,
                { backgroundColor: isBlocked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' },
              ]}
            >
              <Feather name={isBlocked ? 'unlock' : 'slash'} size={28} color={isBlocked ? '#10B981' : '#EF4444'} />
            </View>

            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>
              {isBlocked ? `Unblock ${recipient?.name || 'Contact'}?` : `Block ${recipient?.name || 'Contact'}?`}
            </Text>
            <Text style={[styles.dialogMessage, { color: theme.onSurfaceVariant }]}>
              {isBlocked
                ? 'Unblocked contacts will be able to send you messages and see your active status.'
                : 'Blocked contacts will not be able to message you. You can unblock them at any time.'}
            </Text>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowBlockConfirm(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleToggleBlock}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  isBlocked ? styles.successButton : styles.dangerButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerButtonText}>{isBlocked ? 'Unblock' : 'Block'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Delete Media Confirmation Modal ─── */}
      <Modal
        visible={!!showDeleteMediaConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteMediaConfirm(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={[styles.dialogIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Feather name="trash-2" size={28} color="#EF4444" />
            </View>

            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Delete Media Item?</Text>
            <Text style={[styles.dialogMessage, { color: theme.onSurfaceVariant }]}>
              Are you sure you want to delete this media item? It will be removed from your conversation history.
            </Text>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowDeleteMediaConfirm(null)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  if (showDeleteMediaConfirm) {
                    handleDeleteMedia(showDeleteMediaConfirm);
                  }
                }}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.dangerButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerButtonText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Group Edit Subject Modal ─── */}
      <Modal
        visible={showEditNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditNameModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Enter Group Subject</Text>
            <View style={{ width: '100%', marginBottom: 16 }}>
              <TextInput
                style={[
                  styles.modalTextInput,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                    color: theme.onSurface,
                  },
                ]}
                value={editNameInput}
                onChangeText={setEditNameInput}
                maxLength={100}
                placeholder="Group subject"
                placeholderTextColor={theme.outline}
                autoFocus
              />
              <Text style={[styles.charCounterText, { color: theme.outline }]}>
                {editNameInput.length}/100
              </Text>
            </View>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowEditNameModal(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSaveGroupName}
                disabled={isActionLoading || !editNameInput.trim()}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.saveButton,
                  (!editNameInput.trim() || isActionLoading) && { opacity: 0.5 },
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Group Edit Description Modal ─── */}
      <Modal
        visible={showEditDescModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditDescModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Group Description</Text>
            <View style={{ width: '100%', marginBottom: 16 }}>
              <TextInput
                style={[
                  styles.modalTextInput,
                  styles.modalTextArea,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                    color: theme.onSurface,
                  },
                ]}
                value={editDescInput}
                onChangeText={setEditDescInput}
                maxLength={512}
                placeholder="Add a group description..."
                placeholderTextColor={theme.outline}
                multiline
                numberOfLines={3}
                autoFocus
              />
              <Text style={[styles.charCounterText, { color: theme.outline }]}>
                {editDescInput.length}/512
              </Text>
            </View>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowEditDescModal(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSaveGroupDesc}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.saveButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Add Participants Modal (Admins Only) ─── */}
      <Modal
        visible={showAddMembersModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddMembersModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={[styles.dialogIconWrap, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}>
              <Feather name="user-plus" size={28} color={theme.primary} />
            </View>
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Add Participant</Text>
            <Text style={[styles.dialogMessage, { color: theme.onSurfaceVariant, marginBottom: 12 }]}>
              Enter the email address of the person you want to add to this group.
            </Text>

            <View style={{ width: '100%', marginBottom: 16 }}>
              <TextInput
                style={[
                  styles.modalTextInput,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                    color: theme.onSurface,
                  },
                ]}
                value={addMemberEmail}
                onChangeText={setAddMemberEmail}
                placeholder="colleague@example.com"
                placeholderTextColor={theme.outline}
                autoCapitalize="none"
                keyboardType="email-address"
                autoFocus
              />
            </View>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowAddMembersModal(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleAddMember}
                disabled={isActionLoading || !addMemberEmail.trim()}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.saveButton,
                  (!addMemberEmail.trim() || isActionLoading) && { opacity: 0.5 },
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Add Member</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Member Action Sheet Modal ─── */}
      <Modal
        visible={!!activeMemberModal}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveMemberModal(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setActiveMemberModal(null)} />
          <View style={[styles.memberActionSheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.cardBorder }]}>
              <Image
                source={getSafeImageSource(activeMemberModal?.image)}
                style={styles.sheetAvatar}
                contentFit="cover"
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetName, { color: theme.onSurface }]} numberOfLines={1}>
                  {activeMemberModal?.name || activeMemberModal?.email}
                </Text>
                <Text style={[styles.sheetEmail, { color: theme.outline }]} numberOfLines={1}>
                  {activeMemberModal?.email}
                </Text>
              </View>
              <Pressable onPress={() => setActiveMemberModal(null)} hitSlop={6}>
                <Feather name="x" size={20} color={theme.outline} />
              </Pressable>
            </View>

            {/* Actions list */}
            <View style={styles.sheetActionsList}>
              {/* Message Privately */}
              <Pressable
                onPress={() => activeMemberModal && handleMessagePrivately(activeMemberModal)}
                style={({ pressed }) => [styles.sheetActionRow, pressed && styles.rowPressed]}
              >
                <Feather name="message-circle" size={18} color={theme.primary} style={{ marginRight: 12 }} />
                <Text style={[styles.sheetActionText, { color: theme.onSurface }]}>Message privately</Text>
              </Pressable>

              {/* Admin-only options */}
              {isAdmin && activeMemberModal && (
                <>
                  <Pressable
                    onPress={() => handleToggleAdminRole(activeMemberModal)}
                    style={({ pressed }) => [styles.sheetActionRow, pressed && styles.rowPressed]}
                  >
                    <Feather
                      name={activeMemberModal.isAdmin ? 'shield-off' : 'shield'}
                      size={18}
                      color={theme.primary}
                      style={{ marginRight: 12 }}
                    />
                    <Text style={[styles.sheetActionText, { color: theme.onSurface }]}>
                      {activeMemberModal.isAdmin ? 'Dismiss as admin' : 'Make group admin'}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleRemoveMember(activeMemberModal)}
                    style={({ pressed }) => [styles.sheetActionRow, pressed && styles.rowPressed]}
                  >
                    <Feather name="user-x" size={18} color="#EF4444" style={{ marginRight: 12 }} />
                    <Text style={[styles.sheetActionText, { color: '#EF4444' }]}>
                      Remove from group
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Exit Group Confirmation Modal ─── */}
      <Modal
        visible={showExitGroupConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExitGroupConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={[styles.dialogIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Feather name="log-out" size={28} color="#EF4444" />
            </View>

            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Exit &quot;{groupName}&quot; group?</Text>
            <Text style={[styles.dialogMessage, { color: theme.onSurfaceVariant }]}>
              {isAdmin && groupAdminIds.length <= 1 && groupParticipants.length > 1
                ? 'Since you are the sole admin, another active member will automatically be promoted to group admin.'
                : 'You will no longer be able to send or receive messages in this group.'}
            </Text>

            <View style={styles.dialogButtonsRow}>
              <Pressable
                onPress={() => setShowExitGroupConfirm(false)}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.cancelButton,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.onSurface }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleExitGroup}
                disabled={isActionLoading}
                style={({ pressed }) => [
                  styles.dialogButton,
                  styles.dangerButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerButtonText}>Exit Group</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── E2EE Security Code Verification Modal ─── */}
      <SecurityCodeModal
        visible={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
        contactUserId={isGroup ? undefined : recipient?._id}
        contactName={isGroup ? groupName : recipient?.name || 'Contact'}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  headerActionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  rowPressed: {
    opacity: 0.7,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  heroCard: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
  },
  groupAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  nameEditWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  inlineEditBtn: {
    padding: 4,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
  },
  heroName: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroEmail: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  blockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  blockedBadgeText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  quickActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 18,
    width: '100%',
  },
  quickActionButton: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 80,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  editDescBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editDescBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  creationMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    marginTop: 4,
  },
  creationMetaText: {
    fontSize: 12,
  },
  addMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  addMemberBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  membersList: {
    gap: 2,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 12,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
  },
  youBadgeText: {
    fontSize: 12,
    fontWeight: '400',
  },
  memberEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  adminPillBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  adminPillText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
  },
  counterPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  counterText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyMediaWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyMediaText: {
    fontSize: 13,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItemWrap: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  audioOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  securityOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  securityOptionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  securityOptionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  securityOptionSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rowDetails: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  rowSubtitle: {
    fontSize: 12,
  },
  lightboxContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
  },
  lightboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 10,
  },
  lightboxCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxHeaderActions: {
    flexDirection: 'row',
    gap: 12,
  },
  lightboxActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
  lightboxFooter: {
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  lightboxFooterDate: {
    color: '#94A3B8',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 360,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  dialogIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  dialogMessage: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  dialogButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  dialogButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#EF4444',
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  successButton: {
    backgroundColor: '#10B981',
  },
  saveButton: {
    backgroundColor: '#6366F1',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  modalTextInput: {
    width: '100%',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  modalTextArea: {
    minHeight: 70,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  charCounterText: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  memberActionSheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  sheetAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  sheetName: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  sheetActionsList: {
    paddingTop: 8,
  },
  sheetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sheetActionText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
