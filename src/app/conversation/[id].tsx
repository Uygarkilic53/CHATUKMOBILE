import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MessagingScreen from '../../screens/MessagingScreen';

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const router = useRouter();

  return (
    <View style={styles.errorContainer}>
      <View style={styles.errorIconCircle}>
        <Feather name="alert-triangle" size={32} color="#EF4444" />
      </View>
      <Text style={styles.errorTitle}>Unable to load conversation</Text>
      <Text style={styles.errorMessage}>{error.message || 'An unexpected error occurred.'}</Text>
      <View style={styles.errorActions}>
        <Pressable
          onPress={() => router.replace('/chats')}
          style={[styles.errorButton, styles.secondaryButton]}
        >
          <Text style={styles.secondaryButtonText}>Back to Chats</Text>
        </Pressable>
        <Pressable onPress={retry} style={[styles.errorButton, styles.primaryButton]}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ConversationRoute() {
  const params = useLocalSearchParams<{
    id: string | string[];
    recipientId?: string;
    recipientName?: string;
    recipientEmail?: string;
    recipientImage?: string;
  }>();
  const conversationId = Array.isArray(params.id) ? params.id[0] : params.id;

  if (!conversationId) {
    return null;
  }

  const initialRecipient = params.recipientId
    ? {
        _id: params.recipientId,
        name: params.recipientName || 'Contact',
        email: params.recipientEmail || '',
        image: params.recipientImage || null,
      }
    : undefined;

  return (
    <MessagingScreen
      conversationId={conversationId}
      initialRecipient={initialRecipient}
    />
  );
}

const styles = StyleSheet.create({
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
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
  },
  errorButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 110,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#4F46E5',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
