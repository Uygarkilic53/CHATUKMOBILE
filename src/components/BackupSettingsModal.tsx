import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import {
  checkRemoteBackup,
  uploadBackupToServer,
  downloadAndRestoreBackupFromServer,
  deleteBackupFromServer,
} from '../e2ee/backupService';

interface BackupSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function BackupSettingsModal({
  visible,
  onClose,
}: BackupSettingsModalProps) {
  const { theme } = useTheme();

  const [loadingStatus, setLoadingStatus] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [cloudBackupInfo, setCloudBackupInfo] = useState<{
    exists: boolean;
    exportedAt?: number;
    updatedAt?: string;
  } | null>(null);

  // Tab mode: 'overview' | 'create' | 'restore'
  const [mode, setMode] = useState<'overview' | 'create' | 'restore'>('overview');

  // Input states
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleClose = () => {
    setMode('overview');
    setPassword('');
    setConfirmPassword('');
    onClose();
  };

  useEffect(() => {
    let isMounted = true;
    if (!visible) return;

    const refreshStatus = async () => {
      await Promise.resolve();
      if (!isMounted) return;
      setLoadingStatus(true);
      try {
        const status = await checkRemoteBackup();
        if (isMounted) {
          setCloudBackupInfo(status);
        }
      } catch {
        if (isMounted) {
          setCloudBackupInfo({ exists: false });
        }
      } finally {
        if (isMounted) {
          setLoadingStatus(false);
        }
      }
    };

    refreshStatus();

    return () => {
      isMounted = false;
    };
  }, [visible]);

  const handleCreateBackup = async () => {
    if (!password || password.length < 6) {
      Alert.alert('Password Required', 'Please enter a password of at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match. Please re-enter.');
      return;
    }

    setActionLoading(true);
    setLoadingMessage('Deriving Argon2id key & encrypting database...');

    try {
      const meta = await uploadBackupToServer(password);
      Alert.alert(
        'Backup Complete',
        'Your local messages have been encrypted with your password and safely uploaded.'
      );
      setCloudBackupInfo({
        exists: true,
        exportedAt: meta.exportedAt,
        updatedAt: meta.updatedAt,
      });
      setPassword('');
      setConfirmPassword('');
      setMode('overview');
    } catch (err: any) {
      Alert.alert('Backup Failed', err.message || 'Could not create cloud backup.');
    } finally {
      setActionLoading(false);
      setLoadingMessage('');
    }
  };

  const handleRestoreBackup = async () => {
    if (!password) {
      Alert.alert('Password Required', 'Please enter your backup encryption password.');
      return;
    }

    setActionLoading(true);
    setLoadingMessage('Deriving key & decrypting cloud snapshot...');

    try {
      const result = await downloadAndRestoreBackupFromServer(password);
      Alert.alert(
        'Restore Complete',
        `Successfully decrypted and restored ${result.restoredCount} messages into your secure local storage.`
      );
      setPassword('');
      setMode('overview');
    } catch (err: any) {
      Alert.alert('Restore Failed', err.message || 'Could not restore backup.');
    } finally {
      setActionLoading(false);
      setLoadingMessage('');
    }
  };

  const handleDeleteBackup = () => {
    Alert.alert(
      'Delete Cloud Backup',
      'Are you sure you want to delete your encrypted backup from the server? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            setLoadingMessage('Removing backup from server...');
            try {
              await deleteBackupFromServer();
              setCloudBackupInfo({ exists: false });
              Alert.alert('Backup Deleted', 'Your cloud backup has been removed.');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not delete backup.');
            } finally {
              setActionLoading(false);
              setLoadingMessage('');
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoidingView}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={[styles.iconCircle, { backgroundColor: theme.isDark ? 'rgba(79, 70, 229, 0.2)' : '#e0e7ff' }]}>
                <Ionicons name="cloud-done-outline" size={24} color={theme.primary} />
              </View>
              <View style={styles.headerTitles}>
                <Text style={[styles.title, { color: theme.onSurface }]}>
                  Encrypted Cloud Backup
                </Text>
                <Text style={[styles.subtitle, { color: theme.onSurfaceVariant }]}>
                  Zero-Knowledge End-to-End Encryption
                </Text>
              </View>
              <Pressable onPress={handleClose} style={styles.closeBtn}>
                <Feather name="x" size={20} color={theme.onSurfaceVariant} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {loadingStatus ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="small" color={theme.primary} />
                  <Text style={[styles.infoText, { color: theme.onSurfaceVariant }]}>
                    Checking cloud backup status...
                  </Text>
                </View>
              ) : mode === 'overview' ? (
                <>
                  {/* Status Banner */}
                  <View
                    style={[
                      styles.statusBanner,
                      {
                        backgroundColor: cloudBackupInfo?.exists
                          ? theme.isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5'
                          : theme.isDark ? 'rgba(239, 68, 68, 0.12)' : '#fef2f2',
                        borderColor: cloudBackupInfo?.exists
                          ? theme.isDark ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0'
                          : theme.isDark ? 'rgba(239, 68, 68, 0.25)' : '#fecaca',
                      },
                    ]}
                  >
                    <Ionicons
                      name={cloudBackupInfo?.exists ? 'checkmark-circle' : 'alert-circle'}
                      size={20}
                      color={cloudBackupInfo?.exists ? theme.success : theme.error}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        style={[
                          styles.statusTitle,
                          { color: cloudBackupInfo?.exists ? theme.success : theme.error },
                        ]}
                      >
                        {cloudBackupInfo?.exists ? 'Cloud Backup Active' : 'No Cloud Backup Found'}
                      </Text>
                      <Text style={[styles.statusSubtitle, { color: theme.onSurfaceVariant }]}>
                        {cloudBackupInfo?.exists && cloudBackupInfo.exportedAt
                          ? `Last saved: ${new Date(cloudBackupInfo.exportedAt).toLocaleDateString()} at ${new Date(cloudBackupInfo.exportedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'Create a backup to protect your chat history when switching devices.'}
                      </Text>
                    </View>
                  </View>

                  {/* Informational Card */}
                  <View
                    style={[
                      styles.infoBox,
                      {
                        backgroundColor: theme.cardItem,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                  >
                    <Feather name="shield" size={16} color={theme.primary} style={{ marginTop: 2 }} />
                    <Text style={[styles.infoBoxText, { color: theme.onSurfaceVariant }]}>
                      Backups are client-side encrypted using Argon2id key derivation and XChaCha20-Poly1305. The server only stores opaque ciphertext. Without your chosen password, neither Chatuk nor anyone else can read your messages.
                    </Text>
                  </View>

                  {/* Actions */}
                  <View style={styles.actionButtonsCol}>
                    <Pressable
                      style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
                      onPress={() => setMode('create')}
                    >
                      <Feather name="upload-cloud" size={18} color="#ffffff" />
                      <Text style={styles.primaryBtnText}>
                        {cloudBackupInfo?.exists ? 'Create New Backup' : 'Back Up Now'}
                      </Text>
                    </Pressable>

                    {cloudBackupInfo?.exists && (
                      <Pressable
                        style={[
                          styles.secondaryBtn,
                          {
                            backgroundColor: theme.cardItem,
                            borderColor: theme.cardBorder,
                          },
                        ]}
                        onPress={() => setMode('restore')}
                      >
                        <Feather name="download-cloud" size={18} color={theme.primary} />
                        <Text style={[styles.secondaryBtnText, { color: theme.primary }]}>
                          Restore Chats from Cloud
                        </Text>
                      </Pressable>
                    )}

                    {cloudBackupInfo?.exists && (
                      <Pressable
                        style={[styles.deleteBtn, { borderColor: theme.error }]}
                        onPress={handleDeleteBackup}
                      >
                        <Feather name="trash-2" size={16} color={theme.error} />
                        <Text style={[styles.deleteBtnText, { color: theme.error }]}>
                          Delete Cloud Backup
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </>
              ) : mode === 'create' ? (
                <>
                  <Text style={[styles.formHeader, { color: theme.onSurface }]}>
                    Set a Backup Password
                  </Text>
                  <Text style={[styles.formSubheader, { color: theme.onSurfaceVariant }]}>
                    Choose a strong password to protect your chat history. Remember this password — it cannot be recovered or reset!
                  </Text>

                  <View style={styles.inputContainer}>
                    <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                      BACKUP PASSWORD
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.cardItem,
                          borderColor: theme.cardBorder,
                        },
                      ]}
                    >
                      <TextInput
                        style={[styles.input, { color: theme.onSurface }]}
                        placeholder="Enter 6+ character password"
                        placeholderTextColor={theme.outline}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        autoCapitalize="none"
                      />
                      <Pressable onPress={() => setShowPassword((prev) => !prev)}>
                        <Feather
                          name={showPassword ? 'eye-off' : 'eye'}
                          size={18}
                          color={theme.outline}
                        />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                      CONFIRM PASSWORD
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.cardItem,
                          borderColor: theme.cardBorder,
                        },
                      ]}
                    >
                      <TextInput
                        style={[styles.input, { color: theme.onSurface }]}
                        placeholder="Re-enter password"
                        placeholderTextColor={theme.outline}
                        secureTextEntry={!showPassword}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  {actionLoading ? (
                    <View style={styles.actionLoadingBox}>
                      <ActivityIndicator size="small" color={theme.primary} />
                      <Text style={[styles.actionLoadingText, { color: theme.onSurfaceVariant }]}>
                        {loadingMessage}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.formButtonsRow}>
                      <Pressable
                        style={[styles.backBtn, { borderColor: theme.cardBorder }]}
                        onPress={() => setMode('overview')}
                      >
                        <Text style={[styles.backBtnText, { color: theme.onSurfaceVariant }]}>
                          Back
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                        onPress={handleCreateBackup}
                      >
                        <Text style={styles.submitBtnText}>Encrypt & Upload</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={[styles.formHeader, { color: theme.onSurface }]}>
                    Restore Chats from Backup
                  </Text>
                  <Text style={[styles.formSubheader, { color: theme.onSurfaceVariant }]}>
                    Enter the password you used when creating your cloud backup.
                  </Text>

                  <View style={styles.inputContainer}>
                    <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
                      BACKUP PASSWORD
                    </Text>
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: theme.cardItem,
                          borderColor: theme.cardBorder,
                        },
                      ]}
                    >
                      <TextInput
                        style={[styles.input, { color: theme.onSurface }]}
                        placeholder="Enter your backup password"
                        placeholderTextColor={theme.outline}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        autoCapitalize="none"
                      />
                      <Pressable onPress={() => setShowPassword((prev) => !prev)}>
                        <Feather
                          name={showPassword ? 'eye-off' : 'eye'}
                          size={18}
                          color={theme.outline}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {actionLoading ? (
                    <View style={styles.actionLoadingBox}>
                      <ActivityIndicator size="small" color={theme.primary} />
                      <Text style={[styles.actionLoadingText, { color: theme.onSurfaceVariant }]}>
                        {loadingMessage}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.formButtonsRow}>
                      <Pressable
                        style={[styles.backBtn, { borderColor: theme.cardBorder }]}
                        onPress={() => setMode('overview')}
                      >
                        <Text style={[styles.backBtnText, { color: theme.onSurfaceVariant }]}>
                          Back
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.submitBtn, { backgroundColor: theme.primary }]}
                        onPress={handleRestoreBackup}
                      >
                        <Text style={styles.submitBtnText}>Decrypt & Restore</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  avoidingView: {
    width: '100%',
    maxWidth: 440,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  scrollContent: {
    paddingVertical: 4,
  },
  centerContainer: {
    padding: 30,
    alignItems: 'center',
    gap: 12,
  },
  infoText: {
    fontSize: 13,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginBottom: 20,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  actionButtonsCol: {
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  formHeader: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  formSubheader: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 18,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
  },
  actionLoadingBox: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 10,
  },
  actionLoadingText: {
    fontSize: 13,
  },
  formButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  backBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
