import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import CreateGroupModal, { ContactItem } from '../src/components/CreateGroupModal';
import { api } from '../src/lib/api';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => children,
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      card: '#ffffff',
      cardItem: '#f1f5f9',
      cardBorder: '#e2e8f0',
      onSurface: '#0f172a',
      onSurfaceVariant: '#64748b',
      primary: '#4f46e5',
      outline: '#94a3b8',
      error: '#ef4444',
      isDark: false,
    },
    themeMode: 'light',
  }),
}));

jest.mock('../src/components/Toast', () => ({
  useToast: () => ({
    showToast: jest.fn(),
  }),
}));

jest.mock('../src/lib/auth-client', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'user_creator_id',
        email: 'creator@example.com',
        name: 'Group Creator',
      },
    },
    isPending: false,
  }),
}));

jest.mock('../src/lib/api', () => ({
  api: {
    getConversations: jest.fn(),
    createGroup: jest.fn(),
    uploadMedia: jest.fn(),
  },
}));

describe('<CreateGroupModal />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.getConversations as jest.Mock).mockResolvedValue({
      currentUserId: 'user_creator_id',
      currentUserEmail: 'creator@example.com',
      conversations: [],
    });
  });

  it('renders provided availableContacts immediately without fetching and without infinite loop', async () => {
    const contacts: ContactItem[] = [
      { _id: 'u1', name: 'Alice Smith', email: 'alice@example.com', image: null },
      { _id: 'u2', name: 'Bob Jones', email: 'bob@example.com', image: null },
    ];
    const onClose = jest.fn();
    const onGroupCreated = jest.fn();

    const { getByText } = await render(
      <CreateGroupModal
        visible={true}
        onClose={onClose}
        onGroupCreated={onGroupCreated}
        availableContacts={contacts}
      />
    );

    // Shows recent contacts header
    expect(getByText('Recent Contacts')).toBeTruthy();
    // Displays Alice and Bob
    expect(getByText('Alice Smith')).toBeTruthy();
    expect(getByText('alice@example.com')).toBeTruthy();
    expect(getByText('Bob Jones')).toBeTruthy();
    expect(getByText('bob@example.com')).toBeTruthy();

    // Verify api.getConversations was NOT called since contacts were already provided
    expect(api.getConversations).not.toHaveBeenCalled();
  });

  it('filters recent contacts by search query', async () => {
    const contacts: ContactItem[] = [
      { _id: 'u1', name: 'Alice Smith', email: 'alice@example.com', image: null },
      { _id: 'u2', name: 'Bob Jones', email: 'bob@example.com', image: null },
    ];

    const { getByPlaceholderText, getByText, queryByText } = await render(
      <CreateGroupModal
        visible={true}
        onClose={jest.fn()}
        onGroupCreated={jest.fn()}
        availableContacts={contacts}
      />
    );

    const searchInput = getByPlaceholderText('Search contacts...');
    fireEvent.changeText(searchInput, 'Alice');

    await waitFor(() => {
      expect(getByText('Alice Smith')).toBeTruthy();
      expect(queryByText('Bob Jones')).toBeNull();
    });
  });

  it('fetches contacts once without infinite loop when availableContacts is empty', async () => {
    (api.getConversations as jest.Mock).mockResolvedValue({
      currentUserId: 'me',
      currentUserEmail: 'me@example.com',
      conversations: [
        {
          _id: 'c1',
          participants: [
            { _id: 'me', email: 'me@example.com', name: 'Me' },
            { _id: 'u3', email: 'charlie@example.com', name: 'Charlie Brown', image: null },
          ],
        },
      ],
    });

    const { findByText } = await render(
      <CreateGroupModal
        visible={true}
        onClose={jest.fn()}
        onGroupCreated={jest.fn()}
      />
    );

    // Wait for fetched contacts to appear
    const contactName = await findByText('Charlie Brown');
    expect(contactName).toBeTruthy();

    // Verify it was only called once, not in an infinite loop
    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });

  it('selects and deselects contacts when tapped', async () => {
    const contacts: ContactItem[] = [
      { _id: 'u1', name: 'Alice Smith', email: 'alice@example.com', image: null },
    ];

    const { getByText, getByTestId, queryByText } = await render(
      <CreateGroupModal
        visible={true}
        onClose={jest.fn()}
        onGroupCreated={jest.fn()}
        availableContacts={contacts}
      />
    );

    // Initial state: 1 participant (the creator)
    expect(getByText('1 participant (max 100)')).toBeTruthy();

    // Tap Alice contact row pressable
    fireEvent.press(getByTestId('contact-item-u1'));

    // Now selected contacts has Alice, header updates to 2 participants
    await waitFor(() => {
      expect(getByText('2 participants (max 100)')).toBeTruthy();
      expect(getByText('Selected (1)')).toBeTruthy();
    });

    // Tap Alice contact row pressable again to deselect
    fireEvent.press(getByTestId('contact-item-u1'));

    // Returns to 1 participant
    await waitFor(() => {
      expect(getByText('1 participant (max 100)')).toBeTruthy();
      expect(queryByText('Selected (1)')).toBeNull();
    });
  });

  it('guards against backdrop touch-through immediately after modal opens (< 350ms)', async () => {
    const onClose = jest.fn();

    const { getByTestId } = await render(
      <CreateGroupModal
        visible={true}
        onClose={onClose}
        onGroupCreated={jest.fn()}
      />
    );

    const backdrop = getByTestId('create-group-modal-backdrop');

    // Press backdrop immediately (< 350ms)
    fireEvent.press(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop press after guard period (>= 350ms)', async () => {
    const now = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const onClose = jest.fn();

    const { getByTestId } = await render(
      <CreateGroupModal
        visible={true}
        onClose={onClose}
        onGroupCreated={jest.fn()}
      />
    );

    const backdrop = getByTestId('create-group-modal-backdrop');

    // Fast-forward Date.now() by 400ms
    dateSpy.mockReturnValue(now + 400);

    fireEvent.press(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    dateSpy.mockRestore();
  });

  it('prevents creator from adding their own email with an error banner', async () => {
    const { getByPlaceholderText, getByTestId, findByText } = await render(
      <CreateGroupModal
        visible={true}
        onClose={jest.fn()}
        onGroupCreated={jest.fn()}
        currentUserEmail="creator@example.com"
      />
    );

    const emailInput = getByPlaceholderText('friend@example.com');
    await act(async () => {
      fireEvent.changeText(emailInput, 'creator@example.com');
    });
    await act(async () => {
      fireEvent.press(getByTestId('add-email-button'));
    });

    expect(await findByText('You are already included in the group as creator')).toBeTruthy();
  });

  it('selects existing known contact when their email is entered in email input', async () => {
    const contacts: ContactItem[] = [
      { _id: 'u_known', name: 'Known Friend', email: 'known@example.com', image: null },
    ];

    const { getByPlaceholderText, getByTestId, findByText } = await render(
      <CreateGroupModal
        visible={true}
        onClose={jest.fn()}
        onGroupCreated={jest.fn()}
        availableContacts={contacts}
      />
    );

    const emailInput = getByPlaceholderText('friend@example.com');
    await act(async () => {
      fireEvent.changeText(emailInput, 'known@example.com');
    });
    await act(async () => {
      fireEvent.press(getByTestId('add-email-button'));
    });

    expect(await findByText('Selected (1)')).toBeTruthy();
    expect(await findByText('2 participants (max 100)')).toBeTruthy();
  });

  it('does not re-fetch contacts when reopening if contacts are already fetched', async () => {
    (api.getConversations as jest.Mock).mockResolvedValue({
      currentUserId: 'me',
      currentUserEmail: 'me@example.com',
      conversations: [
        {
          _id: 'c1',
          participants: [
            { _id: 'me', email: 'me@example.com', name: 'Me' },
            { _id: 'u9', email: 'persisted@example.com', name: 'Persisted User', image: null },
          ],
        },
      ],
    });

    const { findByText, rerender } = await render(
      <CreateGroupModal
        visible={true}
        onClose={jest.fn()}
        onGroupCreated={jest.fn()}
      />
    );

    expect(await findByText('Persisted User')).toBeTruthy();
    expect(api.getConversations).toHaveBeenCalledTimes(1);

    // Close modal
    await act(async () => {
      rerender(
        <CreateGroupModal
          visible={false}
          onClose={jest.fn()}
          onGroupCreated={jest.fn()}
        />
      );
    });

    // Reopen modal
    await act(async () => {
      rerender(
        <CreateGroupModal
          visible={true}
          onClose={jest.fn()}
          onGroupCreated={jest.fn()}
        />
      );
    });

    // Verify api.getConversations was NOT called a second time
    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });
});
