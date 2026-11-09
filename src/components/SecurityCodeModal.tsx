import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getSafetyNumberForContact, acknowledgeKeyChange, getPinnedKey } from '../e2ee/keyDirectory';
import { getOrGenerateDeviceKeys } from '../e2ee/keyStore';
import { fetchUserActiveDevices } from '../e2ee/messageService';

interface SecurityCodeModalProps {
  visible: boolean;
  onClose: () => void;
  contactUserId?: string;
  contactName?: string;
}

export default function SecurityCodeModal({
  visible,
  onClose,
  contactUserId,
  contactName = 'Contact',
}: SecurityCodeModalProps) {
  const { theme } = useTheme();
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (!visible || !contactUserId) {
      return;
    }

    const loadCode = async () => {
      await Promise.resolve();
      if (!isMounted) return;
      setIsLoading(true);
      setSafetyNumber(null);

      try {
        const ownKeys = await getOrGenerateDeviceKeys();
        let targetSignPk: string | undefined;

        const pinned = await getPinnedKey(contactUserId);
        if (pinned?.signPublicKey) {
          targetSignPk = pinned.signPublicKey;
        } else {
          const devices = await fetchUserActiveDevices(contactUserId);
          if (devices.length > 0) {
            targetSignPk = devices[0].signPublicKey;
          }
        }

        if (targetSignPk && isMounted) {
          const sn = await getSafetyNumberForContact(ownKeys.signPublicKey, targetSignPk);
          setSafetyNumber(sn);
        }
      } catch (err) {
        console.warn('[E2EE] Error loading safety number:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadCode();

    return () => {
      isMounted = false;
    };
  }, [visible, contactUserId]);

  const handleAcknowledge = async () => {
    if (contactUserId) {
      await acknowledgeKeyChange(contactUserId);
      Alert.alert('Verified', `${contactName}'s security code has been marked as verified.`);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
        >
          <View style={styles.header}>
            <View style={styles.shieldBadge}>
              <Ionicons name="shield-checkmark" size={30} color="#6366F1" />
            </View>
            <Text style={[styles.title, { color: theme.onSurface }]}>
              Verify Security Code
            </Text>
            <Text style={[styles.subtitle, { color: theme.outline }]}>
              Compare this 60-digit number with {contactName} to confirm end-to-end encryption.
            </Text>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6366F1" />
              <Text style={[styles.loadingText, { color: theme.outline }]}>
                Verifying device keys...
              </Text>
            </View>
          ) : safetyNumber ? (
            <View style={[styles.codeBox, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
              <Text style={[styles.codeText, { color: theme.onSurface }]}>
                {safetyNumber.match(/.{1,5}/g)?.join(' ')}
              </Text>
            </View>
          ) : (
            <Text style={[styles.unavailableText, { color: theme.outline }]}>
              Could not compute safety number. Contact device key not yet pinned.
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={handleAcknowledge}
              style={[styles.verifyButton, { backgroundColor: '#6366F1' }]}
            >
              <Ionicons name="checkmark-circle" size={18} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={styles.verifyButtonText}>Mark as Verified</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              style={[styles.closeButton, { borderColor: theme.cardBorder }]}
            >
              <Text style={[styles.closeButtonText, { color: theme.onSurface }]}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
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
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  shieldBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  loadingContainer: {
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  codeBox: {
    width: '100%',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    alignItems: 'center',
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
    lineHeight: 24,
    textAlign: 'center',
  },
  unavailableText: {
    textAlign: 'center',
    marginVertical: 20,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: 12,
  },
  verifyButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
