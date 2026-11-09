import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { api } from '../lib/api';
import { useSession } from '../lib/auth-client';
import { useToast } from './Toast';
import { getSafeImageSource } from '../utils/image';

export interface ContactItem {
  _id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface CreateGroupModalProps {
  visible: boolean;
  onClose: () => void;
  onGroupCreated: (newGroup: any) => void;
  availableContacts?: ContactItem[];
  currentUserId?: string | null;
  currentUserEmail?: string | null;
}

const EMPTY_CONTACTS: ContactItem[] = [];

export default function CreateGroupModal({
  visible,
  onClose,
  onGroupCreated,
  availableContacts = EMPTY_CONTACTS,
  currentUserId,
  currentUserEmail,
}: CreateGroupModalProps) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { data: session } = useSession();

  const effectiveUserId = currentUserId || session?.user?.id || null;
  const effectiveUserEmail = (currentUserEmail || session?.user?.email || '').toLowerCase();

  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarAsset, setAvatarAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const [selectedContacts, setSelectedContacts] = useState<ContactItem[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fetchedContacts, setFetchedContacts] = useState<ContactItem[]>([]);
  const hasPropContacts = Boolean(availableContacts && availableContacts.length > 0);
  const contacts = hasPropContacts ? availableContacts : fetchedContacts;
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Timestamp to guard against backdrop touch-through immediately after modal opens
  const openTimeRef = useRef(0);

  useEffect(() => {
    if (visible) {
      openTimeRef.current = Date.now();
    }
  }, [visible]);

  const resetForm = () => {
    setGroupName('');
    setDescription('');
    setAvatarUri(null);
    setAvatarAsset(null);
    setSelectedContacts([]);
    setEmailInput('');
    setSearchQuery('');
    setErrorMsg(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleBackdropPress = () => {
    // Avoid closing if tap was part of the button press opening the modal
    if (Date.now() - openTimeRef.current < 350) return;
    handleClose();
  };

  // Fetch contacts from conversations only if none provided by parent and none fetched yet
  useEffect(() => {
    if (!visible) return;
    if (hasPropContacts) return;
    if (fetchedContacts.length > 0) return;

    let isMounted = true;
    (async () => {
      try {
        setIsLoadingContacts(true);
        const res = await api.getConversations();
        if (!isMounted) return;
        if (res?.conversations && Array.isArray(res.conversations)) {
          const idMap = new Map<string, ContactItem>();
          const emailSet = new Set<string>();
          const currentUserId = res.currentUserId || effectiveUserId;
          const currentUserEmail = (res.currentUserEmail || effectiveUserEmail || '').toLowerCase();

          for (const conv of res.conversations) {
            for (const p of conv.participants || []) {
              if (!p || !p._id) continue;
              const pEmail = (p.email || '').toLowerCase();
              const isMe =
                Boolean(currentUserId && (p._id === currentUserId || String(p._id) === String(currentUserId))) ||
                Boolean(currentUserEmail && pEmail && pEmail === currentUserEmail);

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
          if (isMounted) {
            setFetchedContacts(Array.from(idMap.values()));
          }
        }
      } catch (err) {
        console.warn('[CreateGroupModal] Error fetching contacts:', err);
      } finally {
        if (isMounted) {
          setIsLoadingContacts(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [visible, hasPropContacts, fetchedContacts.length, effectiveUserId, effectiveUserEmail]);

  // Handle Pick Group Avatar
  const handlePickAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setAvatarUri(result.assets[0].uri);
        setAvatarAsset(result.assets[0]);
      }
    } catch (err: any) {
      console.warn('[CreateGroupModal] Avatar pick error:', err);
      showToast('Could not access image gallery', { type: 'error' });
    }
  };

  const handleClearAvatar = () => {
    setAvatarUri(null);
    setAvatarAsset(null);
  };

  // Toggle contact selection
  const toggleContact = (contact: ContactItem) => {
    setSelectedContacts((prev) => {
      const exists = prev.some(
        (c) =>
          c._id === contact._id ||
          Boolean(c.email && contact.email && c.email.toLowerCase() === contact.email.toLowerCase())
      );
      if (exists) {
        return prev.filter(
          (c) =>
            c._id !== contact._id &&
            (!c.email || !contact.email || c.email.toLowerCase() !== contact.email.toLowerCase())
        );
      } else {
        if (prev.length >= 99) {
          showToast('Group participant limit reached (maximum 100 members)', { type: 'error' });
          return prev;
        }
        return [...prev, contact];
      }
    });
  };

  // Add custom email
  const handleAddEmail = () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setErrorMsg('Please enter a valid email address');
      return;
    }

    if (effectiveUserEmail && trimmed.toLowerCase() === effectiveUserEmail) {
      setErrorMsg('You are already included in the group as creator');
      return;
    }

    if (selectedContacts.some((c) => c.email.toLowerCase() === trimmed.toLowerCase())) {
      setEmailInput('');
      setErrorMsg(null);
      return;
    }

    if (selectedContacts.length >= 99) {
      showToast('Group participant limit reached (maximum 100 members)', { type: 'error' });
      return;
    }

    // Check if entered email matches an existing known contact
    const existingContact = contacts.find(
      (c) => Boolean(c.email && c.email.toLowerCase() === trimmed.toLowerCase())
    );

    if (existingContact) {
      setSelectedContacts((prev) => [...prev, existingContact]);
      setEmailInput('');
      setErrorMsg(null);
      return;
    }

    const newContact: ContactItem = {
      _id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: trimmed.split('@')[0],
      email: trimmed,
      image: null,
    };

    setSelectedContacts((prev) => [...prev, newContact]);
    setEmailInput('');
    setErrorMsg(null);
  };

  // Filtered contacts list
  const filteredContacts = useMemo(() => {
    if (!contacts || contacts.length === 0) return [];
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase().trim();
    return contacts.filter(
      (c) =>
        Boolean(c) &&
        (((c.name || '').toLowerCase().includes(q)) ||
          ((c.email || '').toLowerCase().includes(q)))
    );
  }, [contacts, searchQuery]);

  // Submit form
  const handleCreateGroup = async () => {
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setErrorMsg('Group name is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      let uploadedAvatarUrl: string | undefined;
      let uploadedAvatarPublicId: string | undefined;

      // Upload avatar if selected
      if (avatarAsset && avatarAsset.uri) {
        try {
          const uploadRes = await api.uploadMedia(
            {
              uri: avatarAsset.uri,
              name: 'group_avatar.jpg',
              type: avatarAsset.mimeType || 'image/jpeg',
              folder: 'chatuk/avatars',
            } as any
          );
          if (uploadRes?.url) {
            uploadedAvatarUrl = uploadRes.url;
            uploadedAvatarPublicId = uploadRes.publicId;
          }
        } catch (uploadErr) {
          console.warn('[CreateGroupModal] Avatar upload warning:', uploadErr);
        }
      }

      // Collect IDs and Emails
      const participantIds: string[] = [];
      const participantEmails: string[] = [];

      for (const sc of selectedContacts) {
        if (sc._id && !sc._id.startsWith('custom_')) {
          participantIds.push(sc._id);
        } else if (sc.email) {
          participantEmails.push(sc.email);
        }
      }

      const res = await api.createGroup({
        name: trimmedName,
        description: description.trim() || undefined,
        groupAvatarUrl: uploadedAvatarUrl,
        groupAvatarPublicId: uploadedAvatarPublicId,
        participantIds,
        participantEmails,
      });

      if (res?.conversation) {
        showToast('Group created successfully');
        handleClose();
        onGroupCreated(res.conversation);
      } else {
        throw new Error(res?.error || 'Failed to create group');
      }
    } catch (err: any) {
      console.error('[CreateGroupModal] Error:', err);
      setErrorMsg(err.message || 'Failed to create group. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={handleBackdropPress}
          testID="create-group-modal-backdrop"
          accessibilityLabel="Close modal"
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
          {/* Header */}
          <View style={[styles.headerRow, { borderBottomColor: theme.cardBorder }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={[
                  styles.headerIconWrap,
                  { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
                ]}
              >
                <Feather name="users" size={20} color={theme.primary} />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: theme.onSurface }]}>New Group</Text>
                <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
                  {selectedContacts.length + 1} participant{selectedContacts.length + 1 === 1 ? '' : 's'} (max 100)
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              hitSlop={8}
            >
              <Feather name="x" size={20} color={theme.outline} />
            </Pressable>
          </View>

          {/* Form Content */}
          <ScrollView
            style={styles.scrollContent}
            contentContainerStyle={styles.scrollInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Error Message */}
            {errorMsg ? (
              <View
                style={[
                  styles.errorBanner,
                  { backgroundColor: theme.isDark ? '#451a1a' : '#fee2e2' },
                ]}
              >
                <Ionicons name="alert-circle" size={16} color={theme.error} />
                <Text style={[styles.errorText, { color: theme.error }]}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Avatar & Name Input Row */}
            <View style={styles.topInfoRow}>
              {/* Avatar Picker */}
              <Pressable
                onPress={handlePickAvatar}
                style={[
                  styles.avatarPicker,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                  },
                ]}
                accessibilityLabel="Choose group photo"
              >
                {avatarUri ? (
                  <>
                    <Image
                      source={getSafeImageSource(avatarUri)}
                      style={styles.avatarImage}
                      contentFit="cover"
                    />
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        handleClearAvatar();
                      }}
                      style={styles.avatarClearBadge}
                      hitSlop={6}
                    >
                      <Feather name="x" size={12} color="#ffffff" />
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Feather name="camera" size={22} color={theme.primary} />
                    <Text style={[styles.avatarPlaceholderText, { color: theme.outline }]}>
                      Photo
                    </Text>
                  </View>
                )}
              </Pressable>

              {/* Group Subject / Name */}
              <View style={styles.nameContainer}>
                <View style={styles.labelCounterRow}>
                  <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                    Group Subject *
                  </Text>
                  <Text style={[styles.counterText, { color: theme.outline }]}>
                    {groupName.length}/100
                  </Text>
                </View>

                <TextInput
                  style={[
                    styles.nameInput,
                    {
                      backgroundColor: theme.cardItem,
                      borderColor: theme.cardBorder,
                      color: theme.onSurface,
                    },
                  ]}
                  placeholder="e.g. Designers & Devs"
                  placeholderTextColor={theme.outline}
                  value={groupName}
                  onChangeText={(text) => {
                    setGroupName(text);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  maxLength={100}
                />
              </View>
            </View>

            {/* Description Input */}
            <View style={styles.descContainer}>
              <View style={styles.labelCounterRow}>
                <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                  Description (optional)
                </Text>
                <Text style={[styles.counterText, { color: theme.outline }]}>
                  {description.length}/512
                </Text>
              </View>
              <TextInput
                style={[
                  styles.descInput,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                    color: theme.onSurface,
                  },
                ]}
                placeholder="What is this group about?"
                placeholderTextColor={theme.outline}
                value={description}
                onChangeText={setDescription}
                maxLength={512}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Selected Members Chips */}
            {selectedContacts.length > 0 && (
              <View style={styles.chipsSection}>
                <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                  Selected ({selectedContacts.length})
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsScroll}
                >
                  {selectedContacts.map((sc) => (
                    <View
                      key={sc._id || sc.email}
                      style={[
                        styles.chipItem,
                        {
                          backgroundColor: theme.cardItem,
                          borderColor: theme.cardBorder,
                        },
                      ]}
                    >
                      <Image
                        source={getSafeImageSource(sc.image)}
                        style={styles.chipAvatar}
                        contentFit="cover"
                      />
                      <Text
                        style={[styles.chipText, { color: theme.onSurface }]}
                        numberOfLines={1}
                      >
                        {sc.name}
                      </Text>
                      <Pressable
                        onPress={() => toggleContact(sc)}
                        style={styles.chipRemoveBtn}
                        hitSlop={6}
                      >
                        <Feather name="x" size={13} color={theme.outline} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Invite by Email Row */}
            <View style={styles.inviteEmailSection}>
              <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                Add participant by email
              </Text>
              <View style={styles.emailInputRow}>
                <View
                  style={[
                    styles.emailInputWrap,
                    {
                      backgroundColor: theme.cardItem,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  <Feather name="mail" size={16} color={theme.outline} style={{ marginRight: 8 }} />
                  <TextInput
                    style={[styles.emailInput, { color: theme.onSurface }]}
                    placeholder="friend@example.com"
                    placeholderTextColor={theme.outline}
                    value={emailInput}
                    onChangeText={setEmailInput}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onSubmitEditing={handleAddEmail}
                  />
                </View>
                <Pressable
                  testID="add-email-button"
                  onPress={handleAddEmail}
                  style={({ pressed }) => [
                    styles.addEmailBtn,
                    { backgroundColor: theme.primary },
                    pressed && { opacity: 0.8 },
                  ]}
                  hitSlop={6}
                >
                  <Feather name="plus" size={18} color="#ffffff" />
                </Pressable>
              </View>
            </View>

            {/* Contacts Filter & List */}
            <View style={styles.contactsSection}>
              <View style={styles.contactsHeaderRow}>
                <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                  Recent Contacts
                </Text>
              </View>

              <View
                style={[
                  styles.searchBar,
                  {
                    backgroundColor: theme.cardItem,
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <Feather name="search" size={16} color={theme.outline} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.searchInput, { color: theme.onSurface }]}
                  placeholder="Search contacts..."
                  placeholderTextColor={theme.outline}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                    <Feather name="x" size={14} color={theme.outline} />
                  </Pressable>
                )}
              </View>

              {!hasPropContacts && isLoadingContacts ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={theme.primary} />
                </View>
              ) : filteredContacts.length === 0 ? (
                <View style={styles.emptyContacts}>
                  <Text style={[styles.emptyText, { color: theme.outline }]}>
                    {contacts.length === 0
                      ? 'No existing contacts found. You can add members above via email.'
                      : 'No contacts match your search.'}
                  </Text>
                </View>
              ) : (
                <View style={styles.contactsList}>
                  {filteredContacts.map((item) => {
                    const isSelected = selectedContacts.some((c) => c._id === item._id);
                    return (
                      <Pressable
                        key={item._id}
                        testID={`contact-item-${item._id}`}
                        onPress={() => toggleContact(item)}
                        style={({ pressed }) => [
                          styles.contactRow,
                          {
                            backgroundColor: isSelected
                              ? theme.isDark
                                ? '#1e293b'
                                : '#f1f5f9'
                              : 'transparent',
                            borderColor: theme.cardBorder,
                          },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Image
                          source={getSafeImageSource(item.image)}
                          style={styles.contactAvatar}
                          contentFit="cover"
                        />
                        <View style={styles.contactInfo}>
                          <Text
                            style={[
                              styles.contactName,
                              { color: theme.onSurface, fontWeight: isSelected ? '600' : '500' },
                            ]}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          <Text
                            style={[styles.contactEmail, { color: theme.outline }]}
                            numberOfLines={1}
                          >
                            {item.email}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.checkbox,
                            {
                              borderColor: isSelected ? theme.primary : theme.outline,
                              backgroundColor: isSelected ? theme.primary : 'transparent',
                            },
                          ]}
                        >
                          {isSelected && <Feather name="check" size={12} color="#ffffff" />}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footerRow, { borderTopColor: theme.cardBorder }]}>
            <Pressable
              onPress={handleClose}
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.cancelBtn,
                { borderColor: theme.cardBorder },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.cancelBtnText, { color: theme.onSurfaceVariant }]}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={handleCreateGroup}
              disabled={isSubmitting || !groupName.trim()}
              style={({ pressed }) => [
                styles.createBtn,
                (!groupName.trim() || isSubmitting) && styles.createBtnDisabled,
                pressed && { opacity: 0.85 },
              ]}
            >
              <LinearGradient
                colors={
                  !groupName.trim() || isSubmitting
                    ? [theme.cardBorder, theme.cardBorder]
                    : ['#6366F1', '#8B5CF6']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientBtn}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Feather name="check" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.createBtnText}>Create Group</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
    display: 'flex',
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  scrollContent: {
    flexShrink: 1,
  },
  scrollInner: {
    padding: 20,
    gap: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  topInfoRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  avatarPicker: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  avatarPlaceholderText: {
    fontSize: 10,
    fontWeight: '500',
  },
  avatarClearBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    padding: 3,
  },
  nameContainer: {
    flex: 1,
  },
  labelCounterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  counterText: {
    fontSize: 11,
  },
  nameInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  descContainer: {
    gap: 6,
  },
  descInput: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  chipsSection: {
    gap: 4,
  },
  chipsScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  chipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    maxWidth: 160,
  },
  chipAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  chipRemoveBtn: {
    padding: 2,
  },
  inviteEmailSection: {
    gap: 6,
  },
  emailInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  emailInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  emailInput: {
    flex: 1,
    fontSize: 13,
  },
  addEmailBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactsSection: {
    gap: 8,
  },
  contactsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  loadingContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyContacts: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
  },
  contactsList: {
    gap: 6,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    borderWidth: 0.5,
    gap: 10,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 13,
  },
  contactEmail: {
    fontSize: 11,
    marginTop: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    gap: 12,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  createBtn: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  gradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  createBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
