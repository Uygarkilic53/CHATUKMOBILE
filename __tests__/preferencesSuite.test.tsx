import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';

// Mock auth-client before importing modules that transitively depend on it
jest.mock('../src/lib/auth-client', () => ({
  signIn: { email: jest.fn(), social: jest.fn() },
  signUp: { email: jest.fn() },
  signOut: jest.fn(),
  useSession: () => ({
    data: {
      user: { id: 'user_123', name: 'Alex Johnson', email: 'alex@example.com', image: null },
      session: { token: 'mock_token' },
    },
    isPending: false,
  }),
  authClient: {
    getSession: jest.fn(),
    changePassword: jest.fn().mockResolvedValue({ data: { success: true } }),
    revokeOtherSessions: jest.fn().mockResolvedValue({ success: true }),
    revokeSessions: jest.fn().mockResolvedValue({ success: true }),
  },
  getOrigin: () => 'http://localhost:5000',
  getBaseURL: () => 'http://localhost:5000/api/auth',
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  getMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
}));

const mockPlay = jest.fn();
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: mockPlay,
    pause: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
  })),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  AudioModule: {
    getRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
    requestRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  },
}));

jest.mock('../src/e2ee/keyStore', () => ({
  getStoredDeviceKeys: jest.fn().mockResolvedValue({ deviceId: 'test_device_key_abcdef123456' }),
  wipeAllSecureKeys: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/e2ee/localDb', () => ({
  wipeLocalDb: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/components/Toast', () => ({
  useToast: () => ({
    showToast: jest.fn(),
    hideToast: jest.fn(),
  }),
}));

import {
  PreferencesProvider,
  usePreferences,
} from '../src/context/PreferencesContext';
import { appStorage } from '../src/lib/storage';
import { api } from '../src/lib/api';
import { socketService } from '../src/services/socket';
import { soundService } from '../src/services/soundService';
import SecurityScreen from '../src/app/security';
import PrivacyScreen from '../src/app/privacy';
import NotificationsScreen from '../src/app/notifications';

describe('Preferences System Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PreferencesContext', () => {
    const TestConsumer = () => {
      const { preferences, updatePreferences, resetPreferences } = usePreferences();
      return (
        <>
          <Text testID="readReceipts">{String(preferences.readReceipts)}</Text>
          <Text testID="senderTone">{preferences.senderTone}</Text>
          <Text testID="receiverTone">{preferences.receiverTone}</Text>
          <Pressable
            testID="toggleReadReceipts"
            onPress={() => updatePreferences({ readReceipts: !preferences.readReceipts })}
          >
            <Text>Toggle</Text>
          </Pressable>
          <Pressable
            testID="changeSenderTone"
            onPress={() => updatePreferences({ senderTone: 'sending2' })}
          >
            <Text>Change Sender Tone</Text>
          </Pressable>
          <Pressable
            testID="changeReceiverTone"
            onPress={() => updatePreferences({ receiverTone: 'silent' })}
          >
            <Text>Change Receiver Tone</Text>
          </Pressable>
          <Pressable testID="resetPrefs" onPress={() => resetPreferences()}>
            <Text>Reset</Text>
          </Pressable>
        </>
      );
    };

    it('provides default preferences and updates state & storage', async () => {
      const setItemSpy = jest.spyOn(appStorage, 'setItem');
      const updateApiSpy = jest.spyOn(api, 'updateUserPreferences').mockResolvedValue({ success: true } as any);

      const { getByTestId } = await render(
        <PreferencesProvider>
          <TestConsumer />
        </PreferencesProvider>
      );

      // Default values
      expect(getByTestId('readReceipts').props.children).toBe('true');
      expect(getByTestId('senderTone').props.children).toBe('sending1');
      expect(getByTestId('receiverTone').props.children).toBe('default');

      // Update read receipts
      await act(async () => {
        fireEvent.press(getByTestId('toggleReadReceipts'));
      });

      expect(getByTestId('readReceipts').props.children).toBe('false');
      expect(setItemSpy).toHaveBeenCalled();
      expect(updateApiSpy).toHaveBeenCalledWith({ readReceipts: false });

      // Change sender tone
      await act(async () => {
        fireEvent.press(getByTestId('changeSenderTone'));
      });

      expect(getByTestId('senderTone').props.children).toBe('sending2');

      // Change receiver tone
      await act(async () => {
        fireEvent.press(getByTestId('changeReceiverTone'));
      });

      expect(getByTestId('receiverTone').props.children).toBe('silent');

      // Reset
      await act(async () => {
        fireEvent.press(getByTestId('resetPrefs'));
      });

      expect(getByTestId('readReceipts').props.children).toBe('true');
      expect(getByTestId('senderTone').props.children).toBe('sending1');
      expect(getByTestId('receiverTone').props.children).toBe('default');
    });
  });

  describe('SoundService Playback', () => {
    it('plays sender sound when enabled and skips when silent', async () => {
      appStorage.setItem('chatuk_user_preferences', JSON.stringify({ inAppSounds: true, sentMessageSound: true, senderTone: 'sending1' }));
      await soundService.playSenderSound('sending1');
      expect(mockPlay).toHaveBeenCalled();

      mockPlay.mockClear();
      await soundService.playSenderSound('silent');
      expect(mockPlay).not.toHaveBeenCalled();
    });

    it('plays receiver sound when enabled and skips when silent', async () => {
      appStorage.setItem('chatuk_user_preferences', JSON.stringify({ inAppSounds: true, receiverTone: 'default', vibration: true }));
      await soundService.playReceiverSound('default');
      expect(mockPlay).toHaveBeenCalled();

      mockPlay.mockClear();
      await soundService.playReceiverSound('silent');
      expect(mockPlay).not.toHaveBeenCalled();
    });
  });

  describe('Read Receipts Suppression via socketService.markRead', () => {
    it('suppresses mark_read socket event when readReceipts is false', () => {
      const mockEmit = jest.fn();
      (socketService as any).socket = {
        connected: true,
        emit: mockEmit,
      };

      // Set readReceipts = false in appStorage
      appStorage.setItem('chatuk_user_preferences', JSON.stringify({ readReceipts: false }));

      socketService.markRead('conv_123');

      expect(mockEmit).not.toHaveBeenCalled();

      // Set readReceipts = true
      appStorage.setItem('chatuk_user_preferences', JSON.stringify({ readReceipts: true }));

      socketService.markRead('conv_123');

      expect(mockEmit).toHaveBeenCalledWith('mark_read', { conversationId: 'conv_123' });
    });
  });

  describe('SecurityScreen', () => {
    it('renders account overview and change password form', async () => {
      jest.spyOn(api, 'getProfile').mockResolvedValue({
        user: {
          id: 'user_123',
          name: 'Alex Johnson',
          email: 'alex@example.com',
          createdAt: new Date().toISOString(),
        },
      } as any);

      const { getByText, getByPlaceholderText } = await render(<SecurityScreen />);

      expect(getByText('Account & Security')).toBeTruthy();
      expect(getByText('Change Password')).toBeTruthy();
      expect(getByPlaceholderText('Enter current password')).toBeTruthy();
      expect(getByPlaceholderText('At least 8 characters')).toBeTruthy();
      expect(getByPlaceholderText('Re-enter new password')).toBeTruthy();
      expect(getByText('Security & E2EE Diagnostics')).toBeTruthy();
      expect(getByText('Log Out From All Devices')).toBeTruthy();
    });
  });

  describe('PrivacyScreen', () => {
    it('renders privacy toggles and blocked contacts section', async () => {
      jest.spyOn(api, 'getBlockedUsers').mockResolvedValue({
        blockedUserIds: ['blocked_1'],
        blockedUsers: [{ id: 'blocked_1', name: 'Spam User', email: 'spam@mail.com', image: null }],
      } as any);

      const { getByText } = await render(
        <PreferencesProvider>
          <PrivacyScreen />
        </PreferencesProvider>
      );

      expect(getByText('Privacy & Permissions')).toBeTruthy();
      expect(getByText('Read Receipts')).toBeTruthy();
      expect(getByText('Online Status & Presence')).toBeTruthy();
      expect(getByText('App Hardware Permissions')).toBeTruthy();
    });
  });

  describe('NotificationsScreen', () => {
    it('renders in-app sounds, categorized sender and receiver tones, and vibration controls', async () => {
      const { getByText } = await render(
        <PreferencesProvider>
          <NotificationsScreen />
        </PreferencesProvider>
      );

      expect(getByText('Notifications & Sounds')).toBeTruthy();
      expect(getByText('In-App Sounds')).toBeTruthy();
      expect(getByText('Sent Message Chime')).toBeTruthy();

      // Receiver tones
      expect(getByText('RECEIVER TONE (INCOMING MESSAGES)')).toBeTruthy();
      expect(getByText('Notification Sound')).toBeTruthy();

      // Sender tones
      expect(getByText('SENDER TONE (OUTGOING MESSAGES)')).toBeTruthy();
      expect(getByText('Sending Tone 1')).toBeTruthy();
      expect(getByText('Sending Tone 2')).toBeTruthy();
      expect(getByText('Sending Tone 3')).toBeTruthy();

      expect(getByText('Vibrate on Messages')).toBeTruthy();
      expect(getByText('Haptic Touch Feedback')).toBeTruthy();
      expect(getByText('Show In-App Banners')).toBeTruthy();
      expect(getByText('Reset to Defaults')).toBeTruthy();
    });
  });
});
