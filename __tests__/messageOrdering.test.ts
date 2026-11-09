import { sortMessagesChronologically } from '../src/utils/messageOrder';
import type { SocketMessage } from '../src/services/socket';

describe('Message Chronological Ordering and Optimistic Resolution', () => {
  it('stably sorts messages from oldest to newest by createdAt', () => {
    const rawMsgs: SocketMessage[] = [
      {
        _id: 'msg-3',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'third message',
        type: 'text',
        createdAt: '2026-10-27T02:00:10.000Z',
      } as SocketMessage,
      {
        _id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'first message',
        type: 'text',
        createdAt: '2026-10-27T02:00:00.000Z',
      } as SocketMessage,
      {
        _id: 'msg-2',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'second message',
        type: 'text',
        createdAt: '2026-10-27T02:00:05.000Z',
      } as SocketMessage,
    ];

    const sorted = sortMessagesChronologically(rawMsgs);
    expect(sorted.map((m) => m._id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('keeps newly appended optimistic message at the bottom', () => {
    const existing: SocketMessage[] = [
      {
        _id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Hello',
        type: 'text',
        createdAt: '2026-10-27T02:00:00.000Z',
      } as SocketMessage,
      {
        _id: 'msg-2',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'World',
        type: 'text',
        createdAt: '2026-10-27T02:00:05.000Z',
      } as SocketMessage,
    ];

    const optimistic: SocketMessage = {
      _id: 'temp-1740000010000',
      clientMessageId: 'temp-1740000010000',
      conversationId: 'conv-1',
      senderId: 'user-1',
      content: 'Newest sent text',
      type: 'text',
      createdAt: '2026-10-27T02:00:10.000Z',
    } as SocketMessage;

    const combined = sortMessagesChronologically([...existing, optimistic]);
    expect(combined[combined.length - 1]._id).toBe('temp-1740000010000');
    expect(combined[combined.length - 1].content).toBe('Newest sent text');
  });

  it('resolves optimistic messages strictly by unique ID without jumping on identical content', () => {
    // Scenario: user previously sent "ok" or photo (empty content), then sends another "ok"
    const prevList: SocketMessage[] = [
      {
        _id: 'temp-older-1',
        clientMessageId: 'temp-older-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'ok',
        type: 'text',
        createdAt: '2026-10-27T01:50:00.000Z',
      } as SocketMessage,
      {
        _id: 'msg-middle',
        clientMessageId: 'msg-middle',
        conversationId: 'conv-1',
        senderId: 'user-2',
        content: 'are you there?',
        type: 'text',
        createdAt: '2026-10-27T01:55:00.000Z',
      } as SocketMessage,
      {
        _id: 'temp-latest-2',
        clientMessageId: 'temp-latest-2',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'ok',
        type: 'text',
        createdAt: '2026-10-27T02:00:00.000Z',
      } as SocketMessage,
    ];

    const incomingConfirmation: SocketMessage = {
      _id: 'server-mongo-id-2',
      clientMessageId: 'temp-latest-2',
      conversationId: 'conv-1',
      senderId: 'user-1',
      content: 'ok',
      type: 'text',
      createdAt: '2026-10-27T02:00:00.100Z',
    } as SocketMessage;

    // Strict ID-based resolution matching onNewMessage logic
    const optIndex = prevList.findIndex(
      (m) =>
        (incomingConfirmation.clientMessageId &&
          (m.clientMessageId === incomingConfirmation.clientMessageId || m._id === incomingConfirmation.clientMessageId)) ||
        (incomingConfirmation._id && (m._id === incomingConfirmation._id || m.clientMessageId === incomingConfirmation._id))
    );

    expect(optIndex).toBe(2); // Must target the latest message, NOT index 0!

    const copy = [...prevList];
    copy[optIndex] = {
      ...incomingConfirmation,
      fileUrl: incomingConfirmation.fileUrl || copy[optIndex].fileUrl,
    };
    const filtered = copy.filter(
      (m, idx) =>
        idx === optIndex ||
        (m._id !== incomingConfirmation._id &&
          (!incomingConfirmation.clientMessageId || m.clientMessageId !== incomingConfirmation.clientMessageId))
    );
    const sorted = sortMessagesChronologically(filtered);

    // Old message stays at index 0, middle stays at index 1, newest confirmed stays at index 2
    expect(sorted[0]._id).toBe('temp-older-1');
    expect(sorted[1]._id).toBe('msg-middle');
    expect(sorted[2]._id).toBe('server-mongo-id-2');
    expect(sorted[2].clientMessageId).toBe('temp-latest-2');
  });
});
