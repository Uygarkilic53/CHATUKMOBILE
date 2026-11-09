import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import ForgotPasswordScreen from '../src/app/forgot-password';
import ResetPasswordScreen from '../src/app/reset-password';
import * as api from '../src/lib/api';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockShowToast = jest.fn();

let mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
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

jest.mock('../src/components/LoadingIndicator', () => ({
  LoadingIndicator: () => 'LoadingIndicator',
}));

jest.mock('../src/lib/api', () => ({
  requestPasswordReset: jest.fn(),
  resetPasswordWithToken: jest.fn(),
}));

describe('ForgotPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    (api.requestPasswordReset as jest.Mock).mockResolvedValue({ status: true, message: 'Reset email sent' });
    (api.resetPasswordWithToken as jest.Mock).mockResolvedValue({ status: true });
  });

  it('TC-FP01: renders email input and submit button disabled when empty', async () => {
    const { getByText, getByPlaceholderText } = await render(<ForgotPasswordScreen />);

    expect(getByText('Forgot Password?')).toBeTruthy();
    expect(getByPlaceholderText('name@example.com')).toBeTruthy();
    expect(getByText('Send Reset Link')).toBeTruthy();
  });

  it('TC-FP02: pre-fills email from navigation params if provided', async () => {
    mockParams = { email: 'prefilled@example.com' };
    const { getByDisplayValue } = await render(<ForgotPasswordScreen />);

    expect(getByDisplayValue('prefilled@example.com')).toBeTruthy();
  });

  it('TC-FP03: validates invalid email format without calling API', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = await render(<ForgotPasswordScreen />);

    const emailInput = getByPlaceholderText('name@example.com');
    await act(async () => {
      fireEvent.changeText(emailInput, 'notanemail');
    });

    const submitBtn = getByLabelText('Send Reset Link');
    await act(async () => {
      fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(getByText('Please enter a valid email address.')).toBeTruthy();
    });

    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('TC-FP04: sends reset link, switches to "Check Your Email" state and displays email chip', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = await render(<ForgotPasswordScreen />);

    const emailInput = getByPlaceholderText('name@example.com');
    await act(async () => {
      fireEvent.changeText(emailInput, 'alice@chatuk.io');
    });

    const submitBtn = getByLabelText('Send Reset Link');
    await act(async () => {
      fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(api.requestPasswordReset).toHaveBeenCalledWith({ email: 'alice@chatuk.io' });
    });

    await waitFor(() => {
      expect(getByText('Check Your Email')).toBeTruthy();
      expect(getByText('alice@chatuk.io')).toBeTruthy();
      expect(getByText('Return to Sign In')).toBeTruthy();
    });

    expect(mockShowToast).toHaveBeenCalledWith('Password reset link sent to your email.', 'success');
  });

  it('TC-FP05: displays error message when API call fails', async () => {
    (api.requestPasswordReset as jest.Mock).mockRejectedValueOnce(new Error('Rate limit exceeded. Please wait a minute.'));

    const { getByPlaceholderText, getByLabelText, getByText } = await render(<ForgotPasswordScreen />);

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('name@example.com'), 'bob@chatuk.io');
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(getByText('Rate limit exceeded. Please wait a minute.')).toBeTruthy();
    });

    expect(mockShowToast).toHaveBeenCalledWith('Rate limit exceeded. Please wait a minute.', 'error');
  });

  it('TC-FP06: navigates back to login screen on clicking Return to Sign In', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = await render(<ForgotPasswordScreen />);

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('name@example.com'), 'charlie@chatuk.io');
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(getByText('Return to Sign In')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Back to Sign In'));
    });

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/auth',
      params: { mode: 'login' },
    });
  });
});

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    (api.resetPasswordWithToken as jest.Mock).mockResolvedValue({ status: true });
  });

  it('TC-RP01: shows invalid reset link warning when token is missing', async () => {
    mockParams = {};
    const { getByText } = await render(<ResetPasswordScreen />);

    expect(getByText('Invalid Reset Link')).toBeTruthy();
    expect(getByText('Request New Reset Link')).toBeTruthy();
  });

  it('TC-RP02: renders password inputs when token is provided', async () => {
    mockParams = { token: 'valid-test-token-123' };
    const { getByText, getByPlaceholderText } = await render(<ResetPasswordScreen />);

    expect(getByText('Create New Password')).toBeTruthy();
    expect(getByPlaceholderText('Enter new password')).toBeTruthy();
    expect(getByPlaceholderText('Confirm new password')).toBeTruthy();
  });

  it('TC-RP03: validates password length and mismatch before submission', async () => {
    mockParams = { token: 'valid-test-token-123' };
    const { getByPlaceholderText, getByText } = await render(<ResetPasswordScreen />);

    const newPassInput = getByPlaceholderText('Enter new password');
    const confirmPassInput = getByPlaceholderText('Confirm new password');

    await act(async () => {
      fireEvent.changeText(newPassInput, 'NewPass1234!');
    });
    await act(async () => {
      fireEvent.changeText(confirmPassInput, 'DifferentPass1234!');
    });

    await waitFor(() => {
      expect(getByText('✗ Passwords do not match')).toBeTruthy();
    });
  });

  it('TC-RP04: successfully resets password and displays success screen', async () => {
    mockParams = { token: 'valid-test-token-123' };
    const { getByPlaceholderText, getByLabelText, getByText } = await render(<ResetPasswordScreen />);

    const newPassInput = getByPlaceholderText('Enter new password');
    const confirmPassInput = getByPlaceholderText('Confirm new password');

    await act(async () => {
      fireEvent.changeText(newPassInput, 'SecurePassword123!');
    });
    await act(async () => {
      fireEvent.changeText(confirmPassInput, 'SecurePassword123!');
    });

    await waitFor(() => {
      expect(getByText('✓ Passwords match')).toBeTruthy();
    });

    const submitBtn = getByLabelText('Reset Password');
    await act(async () => {
      fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(api.resetPasswordWithToken).toHaveBeenCalledWith({
        token: 'valid-test-token-123',
        newPassword: 'SecurePassword123!',
      });
    });

    await waitFor(() => {
      expect(getByText('Password Changed!')).toBeTruthy();
      expect(getByText('Sign In Now')).toBeTruthy();
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'Password reset successfully! Please sign in with your new password.',
      'success'
    );
  });
});
