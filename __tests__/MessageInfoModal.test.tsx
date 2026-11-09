import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MessageInfoModal } from '../src/components/MessageInfoModal';
import { SocketMessage } from '../src/services/socket';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
  MaterialIcons: 'MaterialIcons',
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => children,
}));

const mockShowToast = jest.fn();
jest.mock('../src/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

const mockGetLocalMessage = jest.fn().mockResolvedValue(null);
jest.mock('../src/e2ee/localDb', () => ({
  getLocalMessage: (...args: any[]) => mockGetLocalMessage(...args),
}));

jest.mock('../src/e2ee/messageService', () => ({
  processIncomingMessage: jest.fn().mockResolvedValue(null),
}));

const mockGetMessageInfo = jest.fn().mockResolvedValue({
  success: true,
  message: null,
});

jest.mock('../src/lib/api', () => ({
  api: {
    getMessageInfo: (...args: any[]) => mockGetMessageInfo(...args),
  },
}));

describe('<MessageInfoModal />', () => {
  const mockTheme = {
    card: '#ffffff',
    cardItem: '#f1f5f9',
    cardBorder: '#e2e8f0',
    onSurface: '#0f172a',
    outline: '#64748b',
    primary: '#4f46e5',
    isDark: false,
  };

  const sampleOutgoingMessage: SocketMessage = {
    _id: 'msg-101',
    conversationId: 'conv-1',
    senderId: 'user-me',
    senderEmail: 'me@example.com',
    type: 'text',
    content: 'Hello, this is a test message!',
    readBy: ['user-me'],
    deliveredTo: ['user-other'],
    deliveryStatus: 'delivered',
    createdAt: '2026-11-06T18:34:50.000Z',
  };

  const sampleConversation = {
    _id: 'conv-1',
    type: 'direct',
    participants: [
      { _id: 'user-me', name: 'Me', email: 'me@example.com', image: null },
      { _id: 'user-other', name: 'Alice', email: 'alice@example.com', image: null },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when visible is false', async () => {
    const { queryByText } = await render(
      <MessageInfoModal
        visible={false}
        onClose={jest.fn()}
        message={sampleOutgoingMessage}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    expect(queryByText('Message info')).toBeNull();
  });

  it('renders message info header and preview bubble when visible', async () => {
    const { getByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={sampleOutgoingMessage}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    expect(getByText('Message info')).toBeTruthy();
    expect(getByText('Hello, this is a test message!')).toBeTruthy();
    expect(getByText('Sent')).toBeTruthy();
    expect(getByText('Delivered')).toBeTruthy();
    expect(getByText('Read')).toBeTruthy();
    expect(getByText('From your device')).toBeTruthy();
    expect(getByText('End-to-end encrypted')).toBeTruthy();
  });

  it('calls onClose when close/back button is pressed', async () => {
    const onCloseMock = jest.fn();
    const { getByLabelText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={onCloseMock}
        message={sampleOutgoingMessage}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    const closeBtn = getByLabelText('Close message info');
    fireEvent.press(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('displays read status when message is read by recipient in 1-on-1', async () => {
    const readMessage: SocketMessage = {
      ...sampleOutgoingMessage,
      readBy: ['user-me', 'user-other'],
      deliveryStatus: 'read',
      createdAt: '2026-11-06T18:34:50.000Z',
    };

    const { getByText, queryByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={readMessage}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    expect(queryByText('—')).toBeNull();
    expect(getByText('Read')).toBeTruthy();
  });

  it('renders group chat read-by participant list correctly', async () => {
    const groupConversation = {
      _id: 'conv-group',
      type: 'group',
      name: 'Dev Team',
      participants: [
        { _id: 'user-me', name: 'Me', email: 'me@example.com', image: null },
        { _id: 'user-alice', name: 'Alice', email: 'alice@example.com', image: null },
        { _id: 'user-bob', name: 'Bob', email: 'bob@example.com', image: null },
      ],
    };

    const groupMessage: SocketMessage = {
      _id: 'msg-group-1',
      conversationId: 'conv-group',
      senderId: 'user-me',
      type: 'text',
      content: 'Team update',
      readBy: ['user-me', 'user-alice'],
      deliveredTo: ['user-bob'],
      deliveryStatus: 'delivered',
      createdAt: '2026-11-06T18:34:50.000Z',
    };

    const { getByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={groupMessage}
        conversation={groupConversation}
        currentUserId="user-me"
        theme={mockTheme}
        isGroupChat={true}
      />
    );

    expect(getByText('Dev Team')).toBeTruthy();
    expect(getByText('Read by')).toBeTruthy();
    expect(getByText('1 of 2')).toBeTruthy();
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
  });

  it('renders incoming message info with sender details', async () => {
    const incomingMessage: SocketMessage = {
      _id: 'msg-in-1',
      conversationId: 'conv-1',
      senderId: 'user-other',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
      type: 'text',
      content: 'Hey there!',
      readBy: ['user-other', 'user-me'],
      deliveryStatus: 'read',
      createdAt: '2026-11-06T18:34:50.000Z',
      isOutgoing: false,
    };

    const { getByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={incomingMessage}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    expect(getByText('From')).toBeTruthy();
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('alice@example.com')).toBeTruthy();
    expect(getByText('Read by you')).toBeTruthy();
    expect(getByText('Sent by Alice')).toBeTruthy();
  });

  it('resolves sender name from recipient or conversation when senderName is "Unknown"', async () => {
    const incomingMessageUnknown: SocketMessage = {
      _id: 'msg-in-2',
      conversationId: 'conv-1',
      senderId: 'user-other',
      senderName: 'Unknown',
      type: 'text',
      content: 'Hey there without sender name!',
      readBy: ['user-other'],
      deliveryStatus: 'read',
      createdAt: '2026-11-06T18:34:50.000Z',
      isOutgoing: false,
    };

    const { getByText, queryByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={incomingMessageUnknown}
        conversation={sampleConversation}
        recipient={{ _id: 'user-other', name: 'Alice', email: 'alice@example.com' }}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    expect(getByText('From')).toBeTruthy();
    expect(getByText('Alice')).toBeTruthy();
    expect(queryByText('Unknown')).toBeNull();
  });

  it('renders reactions list when message has reactions', async () => {
    const messageWithReactions: SocketMessage = {
      ...sampleOutgoingMessage,
      reactions: [
        {
          emoji: '❤️',
          userId: 'user-other',
          userName: 'Alice',
          createdAt: '2026-11-06T18:35:00.000Z',
        },
        {
          emoji: '👍',
          userId: 'user-me',
          userName: 'Me',
          createdAt: '2026-11-06T18:36:00.000Z',
        },
      ],
    };

    const { getByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={messageWithReactions}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    expect(getByText('Reactions')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('❤️')).toBeTruthy();
    expect(getByText('👍')).toBeTruthy();
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
  });

  it('fetches decrypted message body from SQLite when message is encrypted', async () => {
    mockGetLocalMessage.mockResolvedValueOnce({
      clientMessageId: 'msg-enc-1',
      conversationId: 'conv-1',
      body: 'Decrypted secret text from local SQLite',
    });

    const encryptedMessage: SocketMessage = {
      _id: 'msg-enc-1',
      clientMessageId: 'msg-enc-1',
      conversationId: 'conv-1',
      senderId: 'user-other',
      type: 'text',
      content: '🔒 Encrypted message',
      readBy: ['user-other'],
      createdAt: '2026-11-06T18:34:50.000Z',
    };

    const { findByText } = await render(
      <MessageInfoModal
        visible={true}
        onClose={jest.fn()}
        message={encryptedMessage}
        conversation={sampleConversation}
        currentUserId="user-me"
        theme={mockTheme}
      />
    );

    const decryptedNode = await findByText('Decrypted secret text from local SQLite');
    expect(decryptedNode).toBeTruthy();
  });
});
