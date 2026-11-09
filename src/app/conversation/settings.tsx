import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ConversationSettingsScreen from '../../screens/ConversationSettingsScreen';

export default function ConversationSettingsRoute() {
  const params = useLocalSearchParams<{ id?: string; conversationId?: string }>();
  const activeId = params.id || params.conversationId;

  if (!activeId) {
    return null;
  }

  return <ConversationSettingsScreen conversationId={activeId} />;
}
