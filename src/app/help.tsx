import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { useSession } from '../lib/auth-client';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { getSafeImageSource } from '../utils/image';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const FAQ_LIST: FAQItem[] = [
  {
    category: 'Security & Privacy',
    question: 'Are my messages stored on the server?',
    answer:
      'No. Chatuk utilizes transient encrypted envelopes that are deleted from server queues immediately upon delivery. Only the encrypted payloads reside locally on your device in your secure SQLite database.',
  },
  {
    category: 'Security & Privacy',
    question: 'Can Chatuk or third parties read my messages or calls?',
    answer:
      'Never. Chatuk implements end-to-end encryption via the Double Ratchet and X3DH protocols. Only you and your recipient possess the private keys needed to decrypt messages, voice notes, and calls.',
  },
  {
    category: 'Security & Privacy',
    question: 'How do I verify a contact’s safety number?',
    answer:
      'Open any conversation, tap the contact name or shield icon in the top header, and inspect the 60-digit safety fingerprint or scan their verification QR code to ensure your channel is tamper-proof.',
  },
  {
    category: 'Storage & Cache',
    question: 'What happens when I clear cache in Settings?',
    answer:
      'Only temporary cached media, downloaded image thumbnails, and audio buffers are wiped. Your login credentials, message history, and cryptographic identity keys remain completely untouched.',
  },
  {
    category: 'Storage & Cache',
    question: 'How does WhatsApp-style Media Auto-Download work?',
    answer:
      'In Settings > Data & Storage, you can disable Auto-Download. Inbound photos, videos, and media will then display a blurred placeholder with file size; tap anytime to download on demand.',
  },
  {
    category: 'Messaging & Calls',
    question: 'Can I use Chatuk across multiple devices?',
    answer:
      'Yes! Each authorized device registers its own distinct device key pair with our key distribution hub, delivering seamless multi-device messaging with uncompromising end-to-end encryption.',
  },
];

const CATEGORIES = ['Bug Report', 'Feature Request', 'General Feedback', 'Security Issue'];

export default function HelpScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { data: session } = useSession();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'faq' | 'contact'>('faq');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  // Contact / Bug Report form state
  const [name, setName] = useState(session?.user?.name || '');
  const [email, setEmail] = useState(session?.user?.email || '');
  const [category, setCategory] = useState<string>('Bug Report');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleAccordion = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const handlePickAttachment = async () => {
    if (attachments.length >= 3) {
      showToast('Maximum 3 screenshot attachments allowed', { type: 'info' });
      return;
    }

    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Denied', 'Media library access is needed to attach screenshots.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        setIsUploadingImage(true);

        const token =
          (session as any)?.session?.token ||
          (session as any)?.token ||
          (session as any)?.sessionToken;

        // Strictly upload via Cloudinary under folder chatuk/contact
        const uploadRes = await api.uploadMedia(
          {
            uri: asset.uri,
            name: asset.fileName || 'bug_screenshot.jpg',
            type: asset.mimeType || 'image/jpeg',
            folder: 'chatuk/contact',
          },
          token
        );

        if (uploadRes?.url) {
          setAttachments((prev) => [...prev, uploadRes.url]);
          showToast('Screenshot attached successfully!', { type: 'success' });
        } else {
          showToast('Failed to upload image. Please try again.', { type: 'error' });
        }
      }
    } catch (err: any) {
      console.error('Attachment upload error:', err);
      showToast('Error attaching screenshot', { type: 'error' });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleRemoveAttachment = (indexToRemove: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmitContact = async () => {
    if (!name.trim()) {
      showToast('Please provide your name', { type: 'error' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      showToast('Please provide a valid email address', { type: 'error' });
      return;
    }

    if (!message.trim() || message.trim().length < 10) {
      showToast('Please provide a descriptive message (at least 10 characters)', {
        type: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const token =
        (session as any)?.session?.token ||
        (session as any)?.token ||
        (session as any)?.sessionToken;

      await api.sendContactSubmission(
        {
          name: name.trim(),
          email: email.trim(),
          category,
          message: message.trim(),
          attachments,
        },
        token
      );

      showToast('Your feedback has been submitted to the dev team. Thank you!', {
        type: 'success',
      });

      // Clear form
      setMessage('');
      setAttachments([]);
      setActiveTab('faq');
    } catch (err: any) {
      console.error('Failed to submit contact report:', err);
      showToast(err?.message || 'Failed to submit report. Please try again.', {
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]} edges={['top', 'left', 'right']}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.cardBorder }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: theme.cardItem, borderColor: theme.cardBorder },
            pressed && styles.buttonPressed,
          ]}
          hitSlop={8}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={theme.onSurface} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Help Center & FAQ</Text>
          <Text style={[styles.headerSubtitle, { color: theme.onSurfaceVariant }]}>
            Guides, privacy & developer support
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* ─── Segmented Tabs ─── */}
      <View style={[styles.tabBar, { backgroundColor: theme.card, borderBottomColor: theme.cardBorder }]}>
        <Pressable
          style={[
            styles.tabItem,
            activeTab === 'faq' && [
              styles.tabItemActive,
              { borderBottomColor: theme.primary },
            ],
          ]}
          onPress={() => setActiveTab('faq')}
        >
          <Feather
            name="help-circle"
            size={16}
            color={activeTab === 'faq' ? theme.primary : theme.onSurfaceVariant}
          />
          <Text
            style={[
              styles.tabText,
              {
                color: activeTab === 'faq' ? theme.primary : theme.onSurfaceVariant,
                fontFamily: activeTab === 'faq' ? 'PlusJakartaSans-Bold' : 'PlusJakartaSans-Medium',
              },
            ]}
          >
            FAQ & Guides
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.tabItem,
            activeTab === 'contact' && [
              styles.tabItemActive,
              { borderBottomColor: theme.primary },
            ],
          ]}
          onPress={() => setActiveTab('contact')}
        >
          <Feather
            name="send"
            size={15}
            color={activeTab === 'contact' ? theme.primary : theme.onSurfaceVariant}
          />
          <Text
            style={[
              styles.tabText,
              {
                color: activeTab === 'contact' ? theme.primary : theme.onSurfaceVariant,
                fontFamily: activeTab === 'contact' ? 'PlusJakartaSans-Bold' : 'PlusJakartaSans-Medium',
              },
            ]}
          >
            Contact Dev Team
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'faq' ? (
            <>
              {/* ─── Security Showcase Hero Card ─── */}
              <View
                style={[
                  styles.heroCard,
                  {
                    backgroundColor: theme.isDark ? '#0F172A' : '#EEF2FF',
                    borderColor: theme.isDark ? '#1E293B' : '#C7D2FE',
                  },
                ]}
              >
                <View style={styles.heroHeaderRow}>
                  <View style={[styles.heroIconBox, { backgroundColor: theme.primary }]}>
                    <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.heroTitle, { color: theme.onSurface }]}>
                      Zero-Knowledge Architecture
                    </Text>
                    <Text style={[styles.heroBadge, { color: theme.primary }]}>
                      Double Ratchet • X3DH • XChaCha20
                    </Text>
                  </View>
                </View>
                <Text style={[styles.heroDescription, { color: theme.onSurfaceVariant }]}>
                  Chatuk is engineered with cryptographic integrity at its core. Every message, photo,
                  voice note, and call is end-to-end encrypted on your device. Not even the Chatuk
                  servers can inspect your messages.
                </Text>
              </View>

              {/* ─── Community Guidelines & Etiquette ─── */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                  COMMUNITY GUIDELINES & ETIQUETTE
                </Text>
                <View
                  style={[
                    styles.card,
                    { backgroundColor: theme.card, borderColor: theme.cardBorder },
                  ]}
                >
                  <View style={styles.guidelineRow}>
                    <View style={[styles.guidelineDot, { backgroundColor: theme.success }]} />
                    <Text style={[styles.guidelineText, { color: theme.onSurface }]}>
                      <Text style={{ fontFamily: 'PlusJakartaSans-Bold' }}>Respectful Interaction: </Text>
                      Zero tolerance for harassment, hate speech, abusive behavior, or impersonation.
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
                  <View style={styles.guidelineRow}>
                    <View style={[styles.guidelineDot, { backgroundColor: theme.primary }]} />
                    <Text style={[styles.guidelineText, { color: theme.onSurface }]}>
                      <Text style={{ fontFamily: 'PlusJakartaSans-Bold' }}>Responsible Sharing: </Text>
                      Do not transmit malicious code, unconsented private media, or spam envelopes.
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
                  <View style={styles.guidelineRow}>
                    <View style={[styles.guidelineDot, { backgroundColor: '#F59E0B' }]} />
                    <Text style={[styles.guidelineText, { color: theme.onSurface }]}>
                      <Text style={{ fontFamily: 'PlusJakartaSans-Bold' }}>Key Security: </Text>
                      Always verify contact safety numbers in person or via trusted secondary channels.
                    </Text>
                  </View>
                </View>
              </View>

              {/* ─── Frequently Asked Questions Accordions ─── */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
                  FREQUENTLY ASKED QUESTIONS
                </Text>

                <View
                  style={[
                    styles.card,
                    { backgroundColor: theme.card, borderColor: theme.cardBorder, padding: 0 },
                  ]}
                >
                  {FAQ_LIST.map((item, idx) => {
                    const isExpanded = expandedFaq === idx;
                    const isLast = idx === FAQ_LIST.length - 1;

                    return (
                      <View key={idx}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.faqHeader,
                            { backgroundColor: pressed ? theme.cardItem : 'transparent' },
                          ]}
                          onPress={() => toggleAccordion(idx)}
                        >
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={[styles.faqCategoryLabel, { color: theme.primary }]}>
                              {item.category.toUpperCase()}
                            </Text>
                            <Text style={[styles.faqQuestion, { color: theme.onSurface }]}>
                              {item.question}
                            </Text>
                          </View>
                          <Feather
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.outline}
                          />
                        </Pressable>

                        {isExpanded && (
                          <View
                            style={[
                              styles.faqAnswerContainer,
                              { backgroundColor: theme.cardItem },
                            ]}
                          >
                            <Text style={[styles.faqAnswer, { color: theme.onSurfaceVariant }]}>
                              {item.answer}
                            </Text>
                          </View>
                        )}

                        {!isLast && (
                          <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Switch Tab Prompt */}
              <Pressable
                style={[
                  styles.needMoreHelpCard,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder },
                ]}
                onPress={() => setActiveTab('contact')}
              >
                <View style={styles.needMoreHelpLeft}>
                  <View style={[styles.supportIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
                    <Feather name="message-circle" size={18} color={theme.primary} />
                  </View>
                  <View>
                    <Text style={[styles.needMoreHelpTitle, { color: theme.onSurface }]}>
                      Still have questions or found a bug?
                    </Text>
                    <Text style={[styles.needMoreHelpSubtitle, { color: theme.onSurfaceVariant }]}>
                      Contact our engineering team directly
                    </Text>
                  </View>
                </View>
                <Feather name="arrow-right" size={16} color={theme.primary} />
              </Pressable>
            </>
          ) : (
            /* ─── Contact Dev Team / Bug Report Tab ─── */
            <View style={styles.formContainer}>
              <View
                style={[
                  styles.formInfoCard,
                  {
                    backgroundColor: theme.isDark ? '#0F172A' : '#EEF2FF',
                    borderColor: theme.isDark ? '#1E293B' : '#C7D2FE',
                  },
                ]}
              >
                <Ionicons name="mail" size={20} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.formInfoTitle, { color: theme.onSurface }]}>
                    Direct Developer Support
                  </Text>
                  <Text style={[styles.formInfoSubtitle, { color: theme.onSurfaceVariant }]}>
                    Submissions are dispatched straight to our development team via MailDog Sandbox SMTP.
                  </Text>
                </View>
              </View>

              {/* Name Field */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>YOUR NAME</Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.cardBorder,
                      color: theme.onSurface,
                    },
                  ]}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Alex Smith"
                  placeholderTextColor={theme.outline}
                />
              </View>

              {/* Email Field */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                  EMAIL ADDRESS
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.cardBorder,
                      color: theme.onSurface,
                    },
                  ]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="e.g. alex@example.com"
                  placeholderTextColor={theme.outline}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              {/* Category Selector Pills */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>CATEGORY</Text>
                <View style={styles.categoryPillsRow}>
                  {CATEGORIES.map((cat) => {
                    const isSelected = category === cat;
                    return (
                      <Pressable
                        key={cat}
                        style={[
                          styles.categoryPillItem,
                          {
                            backgroundColor: isSelected
                              ? theme.primary
                              : theme.card,
                            borderColor: isSelected ? theme.primary : theme.cardBorder,
                          },
                        ]}
                        onPress={() => setCategory(cat)}
                      >
                        <Text
                          style={[
                            styles.categoryPillItemText,
                            { color: isSelected ? '#FFFFFF' : theme.onSurface },
                          ]}
                        >
                          {cat}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Message Field */}
              <View style={styles.inputGroup}>
                <View style={styles.labelWithCounterRow}>
                  <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>MESSAGE</Text>
                  <Text style={[styles.counterText, { color: theme.outline }]}>
                    {message.length} chars (min 10)
                  </Text>
                </View>
                <TextInput
                  style={[
                    styles.textAreaInput,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.cardBorder,
                      color: theme.onSurface,
                    },
                  ]}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Describe the bug, issue, or feature request in detail..."
                  placeholderTextColor={theme.outline}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />
              </View>

              {/* Screenshot Attachments */}
              <View style={styles.inputGroup}>
                <View style={styles.labelWithCounterRow}>
                  <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                    ATTACH SCREENSHOTS (OPTIONAL)
                  </Text>
                  <Text style={[styles.counterText, { color: theme.outline }]}>
                    {attachments.length}/3 attached
                  </Text>
                </View>

                {/* Horizontal Attachments List */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachmentScroll}>
                  {attachments.map((url, index) => (
                    <View
                      key={index}
                      style={[
                        styles.attachmentThumbnailBox,
                        { borderColor: theme.cardBorder },
                      ]}
                    >
                      <Image source={getSafeImageSource(url)} style={styles.attachmentImage} contentFit="cover" />
                      <Pressable
                        style={styles.attachmentDeleteButton}
                        onPress={() => handleRemoveAttachment(index)}
                      >
                        <Feather name="x" size={12} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  ))}

                  {attachments.length < 3 && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.addAttachmentButton,
                        {
                          backgroundColor: theme.card,
                          borderColor: theme.cardBorder,
                        },
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={handlePickAttachment}
                      disabled={isUploadingImage}
                    >
                      {isUploadingImage ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <>
                          <Feather name="camera" size={20} color={theme.primary} />
                          <Text style={[styles.addAttachmentText, { color: theme.primary }]}>
                            Add Image
                          </Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </ScrollView>
              </View>

              {/* Submit Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  {
                    backgroundColor: theme.primary,
                    opacity: isSubmitting || isUploadingImage ? 0.7 : 1,
                  },
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleSubmitContact}
                disabled={isSubmitting || isUploadingImage}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="send" size={17} color="#FFFFFF" />
                    <Text style={styles.submitButtonText}>Submit to Dev Team</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    marginTop: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 13,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 50,
  },
  heroCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  heroIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 15,
  },
  heroBadge: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    marginTop: 1,
  },
  heroDescription: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  guidelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guidelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  guidelineText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  faqCategoryLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  faqQuestion: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  faqAnswerContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  faqAnswer: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  needMoreHelpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 4,
  },
  needMoreHelpLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  supportIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  needMoreHelpTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
  },
  needMoreHelpSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    marginTop: 2,
  },
  formContainer: {
    paddingTop: 4,
  },
  formInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 20,
  },
  formInfoTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
  },
  formInfoSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  labelWithCounterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  counterText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 11,
  },
  textInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 14,
  },
  categoryPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPillItem: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryPillItemText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
  },
  textAreaInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14,
    minHeight: 110,
  },
  attachmentScroll: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  attachmentThumbnailBox: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: 10,
    position: 'relative',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  attachmentDeleteButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addAttachmentButton: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  addAttachmentText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 8,
  },
  submitButtonText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
});
