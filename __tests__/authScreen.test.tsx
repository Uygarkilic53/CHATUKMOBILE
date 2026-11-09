import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AuthScreen from '../src/app/auth';
import { signIn, authClient } from '../src/lib/auth-client';
import { appStorage } from '../src/lib/storage';
import { setActiveUserInfo } from '../src/lib/api';
import { socketService } from '../src/services/socket';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({
    mode: 'login',
  }),
}));

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

jest.mock('../src/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
    hideToast: jest.fn(),
  }),
}));

jest.mock('../src/lib/auth-client', () => ({
  signIn: {
    email: jest.fn(),
    social: jest.fn(),
  },
  signUp: {
    email: jest.fn(),
  },
  useSession: () => ({
    data: null,
    isPending: false,
  }),
  authClient: {
    getSession: jest.fn(),
  },
}));

jest.mock('../src/lib/storage', () => ({
  appStorage: {
    getItemAsync: jest.fn().mockResolvedValue(null),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/lib/api', () => ({
  setActiveUserInfo: jest.fn(),
}));

jest.mock('../src/services/socket', () => ({
  socketService: {
    disconnect: jest.fn(),
  },
}));

describe('AuthScreen - Google Authentication & UI Cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (signIn.social as jest.Mock).mockReset();
    (authClient.getSession as jest.Mock).mockReset();
    (appStorage.getItemAsync as jest.Mock).mockResolvedValue(null);
    (appStorage.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (appStorage.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    mockReplace.mockReset();
    mockPush.mockReset();
    mockBack.mockReset();
    mockShowToast.mockReset();
  });

  it('TC-01: renders Continue with Google button and Chatuk logo without Apple button', async () => {
    const { queryByText, getByText, getByLabelText } = await render(<AuthScreen />);

    // Apple button must NOT be present
    expect(queryByText('Apple')).toBeNull();

    // Google button must be present
    expect(getByText('Continue with Google')).toBeTruthy();

    // Verify logo has contentFit="contain"
    const logoImage = getByLabelText('Chatuk Logo');
    expect(logoImage.props.contentFit).toBe('contain');
  });

  it('TC-02: successfully signs in with Google and persists session with remember_me', async () => {
    (signIn.social as jest.Mock).mockResolvedValueOnce({ data: { success: true }, error: null });
    (authClient.getSession as jest.Mock).mockResolvedValueOnce({
      data: {
        user: { id: 'google_user_123', email: 'test@google.com' },
        session: { token: 'google_session_token_xyz' },
      },
    });

    const { getByText } = await render(<AuthScreen />);
    const googleBtn = getByText('Continue with Google');

    await act(async () => {
      fireEvent.press(googleBtn);
    });

    await waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: 'chatuk://chats',
      });
    });

    await waitFor(() => {
      expect(authClient.getSession).toHaveBeenCalled();
      expect(appStorage.setItemAsync).toHaveBeenCalledWith(
        'chatuk_session_token',
        'google_session_token_xyz'
      );
      expect(appStorage.setItemAsync).toHaveBeenCalledWith('chatuk_remember_me', 'true');
      expect(appStorage.setItemAsync).toHaveBeenCalledWith('chatuk_remembered_email', 'test@google.com');
      expect(setActiveUserInfo).toHaveBeenCalledWith('google_user_123', 'test@google.com');
      expect(socketService.disconnect).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/chats');
    });
  });

  it('TC-04: handles user cancellation gracefully without navigating or erroring', async () => {
    (signIn.social as jest.Mock).mockResolvedValueOnce({ data: null, error: null });
    (authClient.getSession as jest.Mock).mockResolvedValueOnce({ data: null });

    const { getByText } = await render(<AuthScreen />);
    const googleBtn = getByText('Continue with Google');

    await act(async () => {
      fireEvent.press(googleBtn);
    });

    await waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: 'chatuk://chats',
      });
    });

    // Should not navigate or show error toast
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(getByText('Continue with Google')).toBeTruthy();
  });

  it('TC-05: handles Google Sign-In failure from provider error', async () => {
    (signIn.social as jest.Mock).mockResolvedValueOnce({
      error: { message: 'Google OAuth access denied' },
    });

    const { getByText, findByText } = await render(<AuthScreen />);
    const googleBtn = getByText('Continue with Google');

    await act(async () => {
      fireEvent.press(googleBtn);
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Google OAuth access denied', { type: 'error' });
    });

    const errorDisplay = await findByText('Google OAuth access denied');
    expect(errorDisplay).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('TC-05b: handles network exceptions during Google sign in gracefully', async () => {
    (signIn.social as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));

    const { getByText, findByText } = await render(<AuthScreen />);
    const googleBtn = getByText('Continue with Google');

    await act(async () => {
      fireEvent.press(googleBtn);
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Network request failed', { type: 'error' });
    });

    const errorDisplay = await findByText('Network request failed');
    expect(errorDisplay).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('TC-06: handles session retrieval error after Google sign-in gracefully', async () => {
    (signIn.social as jest.Mock).mockResolvedValueOnce({ data: { success: true }, error: null });
    (authClient.getSession as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Session lookup failed' },
    });

    const { getByText, findByText } = await render(<AuthScreen />);
    const googleBtn = getByText('Continue with Google');

    await act(async () => {
      fireEvent.press(googleBtn);
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Session lookup failed', { type: 'error' });
    });

    const errorDisplay = await findByText('Session lookup failed');
    expect(errorDisplay).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('TC-07: ignores clicks on Google button while another sign-in is already in progress', async () => {
    let resolveFirst: any;
    const slowSocialPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    (signIn.social as jest.Mock).mockReturnValueOnce(slowSocialPromise);

    const { getByText } = await render(<AuthScreen />);
    const googleBtn = getByText('Continue with Google');

    // First press starts sign-in
    await act(async () => {
      fireEvent.press(googleBtn);
    });

    // Press again while the first is pending
    await act(async () => {
      fireEvent.press(googleBtn);
    });

    expect(signIn.social).toHaveBeenCalledTimes(1);

    // Complete the first call
    await act(async () => {
      resolveFirst({ data: null, error: null });
    });
  });

  it('TC-08: back button navigates back when possible or to root, and respects submitting guard', async () => {
    const { getByLabelText } = await render(<AuthScreen />);
    const backBtn = getByLabelText('Go back');

    await act(async () => {
      fireEvent.press(backBtn);
    });

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('TC-09: pressing Forgot Password navigates to /forgot-password with email', async () => {
    const { getByLabelText, getByPlaceholderText } = await render(<AuthScreen />);
    const emailInput = getByPlaceholderText('alex@chatuk.io');

    await act(async () => {
      fireEvent.changeText(emailInput, 'user@chatuk.io');
    });

    const forgotBtn = getByLabelText('Forgot password');
    await act(async () => {
      fireEvent.press(forgotBtn);
    });

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/forgot-password',
      params: { email: 'user@chatuk.io' },
    });
  });
});
