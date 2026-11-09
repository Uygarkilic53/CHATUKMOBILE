import type { SocketMessage } from '../services/socket';

/**
 * Stably sorts messages in strict chronological order (oldest at top/index 0, newest at bottom/index N-1).
 */
export const sortMessagesChronologically = (msgs: SocketMessage[]): SocketMessage[] => {
  return [...msgs].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    const safeA = isNaN(timeA) ? 0 : timeA;
    const safeB = isNaN(timeB) ? 0 : timeB;
    if (safeA !== safeB) {
      return safeA - safeB;
    }
    const keyA = a.clientMessageId || a._id || '';
    const keyB = b.clientMessageId || b._id || '';
    return keyA.localeCompare(keyB);
  });
};
