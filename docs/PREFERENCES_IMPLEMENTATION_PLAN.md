# Implementation Plan: Profile "PREFERENCES" Section

**Target Files / Routes:**
- `src/app/profile.tsx` (Menu triggers & updated subtitles)
- `src/app/_layout.tsx` (Route registration & `PreferencesProvider`)
- `src/app/security.tsx` (Account & Security screen + Change Password)
- `src/app/privacy.tsx` (Privacy & Permissions screen + Blocked Contacts + App Permissions)
- `src/app/notifications.tsx` (Notifications & Sounds screen + Audio & Vibration)
- `src/context/PreferencesContext.tsx` (Unified Preferences state & persistence)
- `src/lib/api.ts` (API methods for preferences & blocked user enrichment)
- `backend/src/controllers/user.controller.ts` & `backend/src/routes/user.routes.ts` (Backend endpoints)

---

## 1. Executive Summary & Objectives

The "PREFERENCES" section inside `src/app/profile.tsx` currently contains three static placeholder rows that lack `onPress` navigation handlers:
1. **Account & Security** (Currently displays *"Two-step verification, passkeys"* - non-functional)
2. **Privacy & Permissions** (Currently displays *"Last seen, read receipts, blocked"* - non-functional)
3. **Notifications & Sounds** (Currently displays *"Push alerts, vibration, tones"* - non-functional)

### Directives:
1. **Account & Security**: Skip 2FA/passkeys; implement a dedicated, secure **Change Password** flow powered by Better Auth, along with active account and cryptographic security diagnostics.
2. **Privacy & Permissions**: Implement a fully functional privacy suite including **Blocked Contacts Management** (backed by the existing MongoDB blocking infrastructure), **Read Receipts toggle**, **Last Seen / Online Presence toggle**, and **System App Permissions Audit** (Camera, Microphone, Photo Library).
3. **Notifications & Sounds**: Implement a complete in-app notification management center with **In-App Message Sounds**, **Audio Tone Selector**, **Vibration & Haptics** (via React Native native `Vibration`), **In-App Banner Notifications & Message Previews**, and **Incoming Call Ringtones**.
4. **Architecture**: Mirror Chatuk's modular screen architecture (as seen in `storage.tsx`, `wallpaper.tsx`, and `help.tsx`) to keep `profile.tsx` clean and performant. Create a dedicated `PreferencesContext` to manage local persistence and cross-screen reactivity.

---

## 2. Technical Architecture & Data Flow

```
                                  +------------------------+
                                  |   src/app/profile.tsx  |
                                  |  (PREFERENCES section) |
                                  +-----------+------------+
                                              |
                   +--------------------------+--------------------------+
                   |                          |                          |
                   v                          v                          v
       +-----------------------+  +-----------------------+  +-----------------------+
       |  src/app/security.tsx |  |   src/app/privacy.tsx |  | src/app/notifications |
       | (Account & Security)  |  | (Privacy & Permissions|  | (Notifications/Sounds)|
       +-----------+-----------+  +-----------+-----------+  +-----------+-----------+
                   |                          |                          |
                   v                          v                          v
       +-----------------------------------------------------------------------------+
       |                    src/context/PreferencesContext.tsx                       |
       |  - Fast local state backed by appStorage (AsyncStorage / SecureStore)       |
       |  - Cloud sync via backend /api/user/preferences                             |
       +--------------------------------------+--------------------------------------+
                                              |
                     +------------------------+------------------------+
                     |                                                 |
                     v                                                 v
       +---------------------------+                     +---------------------------+
       |   src/lib/auth-client.ts  |                     |      src/lib/api.ts       |
       | authClient.changePassword |                     |  - api.getBlockedUsers()  |
       | Better Auth Session API   |                     |  - api.unblockUser()      |
       +---------------------------+                     |  - api.updatePreferences()|
                                                         +---------------------------+
```

---

## 3. Detailed Screen & Feature Breakdown

### 3.1. Account & Security (`src/app/security.tsx`)
*Route: `/security`, Subtitle in Profile: "Change password, account details & security"*

* **Account Overview Card**:
  - Displays user profile avatar, display name, and registered email.
  - Verified badge & account creation timestamp.
  - Auth Provider indicator: Displays whether the account was created with Email/Password or Google OAuth.
* **Change Password Section**:
  - Button to open a smooth animated Change Password Modal/Card.
  - **Inputs**:
    1. *Current Password*: Masked with eye toggle (required for authentication).
    2. *New Password*: Masked with eye toggle + real-time password strength meter (minimum 8 characters, letters & numbers).
    3. *Confirm New Password*: Masked with eye toggle + real-time matching indicator.
    4. *Revoke Other Sessions Switch*: Checkbox/switch to invalidate active sessions on other devices (using Better Auth's `revokeOtherSessions: true`).
  - **Better Auth Integration**:
    ```typescript
    const { data, error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    });
    ```
  - **OAuth Protection**: If the user signed in with Google OAuth without a password, a helpful info banner explains that password change is handled through Google account settings.
* **Active Session & E2EE Cryptographic Diagnostics**:
  - Current device identifier & platform (`iOS`, `Android`, or `Web`).
  - E2EE Identity status: Indicates that device identity keys and local database are active.
  - "Log Out From All Devices" button (calls Better Auth session invalidation).

---

### 3.2. Privacy & Permissions (`src/app/privacy.tsx`)
*Route: `/privacy`, Subtitle in Profile: "Last seen, read receipts, blocked contacts"*

* **Privacy Controls (PreferencesContext)**:
  - **Read Receipts**: Switch to toggle sending and receiving read receipts (double checkmarks / `seen` timestamps).
    - When turned off, `messageService.ts` suppresses emitting `message:read` socket events.
  - **Last Seen & Online Presence**: Switch to toggle online status visibility (`Everyone` vs `Nobody`).
    - Stored locally and synchronized with MongoDB `showLastSeen` field.
* **Blocked Contacts Management (Live Backend Integration)**:
  - Fetches the user's blocked users via `api.getBlockedUsers()`.
  - Backend controller (`backend/src/controllers/user.controller.ts`) enhanced to return populated user objects (`id`, `name`, `email`, `image`).
  - Displays a clean list of blocked contacts with:
    - User Avatar & Name.
    - Prominent "Unblock" button with confirmation alert.
    - Instant UI update and call to `api.unblockUser(targetUserId)`.
  - Empty state with shield icon: *"You have not blocked any contacts."*
* **App System Permissions Audit**:
  - Live inspection of mobile device hardware permissions:
    1. **Camera**: Used for taking profile photos and sending media messages (`ImagePicker.getCameraPermissionsAsync()`).
    2. **Microphone**: Used for recording voice notes (`AudioModule.getRecordingPermissionsAsync()`).
    3. **Photo Library**: Used for choosing chat attachments and wallpapers (`ImagePicker.getMediaLibraryPermissionsAsync()`).
  - Each item shows:
    - Feature Icon & Title.
    - Status Badge: `Granted` (green) or `Not Granted` (amber).
    - Interactive action: If not granted, requests permission immediately or opens system device settings via `Linking.openSettings()`.

---

### 3.3. Notifications & Sounds (`src/app/notifications.tsx`)
*Route: `/notifications`, Subtitle in Profile: "In-app sounds, vibration, banner alerts"*

* **In-App Message Alerts**:
  - **In-App Sounds Switch**: Master toggle for all sound effects inside chats (default: `true`).
  - **Sent Message Chime**: Subtle audio feedback when your message successfully sends (default: `true`).
  - **Notification Tone Picker**: Selectable sound presets (*"Chatuk Classic"*, *"Minimal Bell"*, *"Subtle Pop"*, *"Silent"*) with live audio preview via `expo-audio`.
* **Haptics & Vibration**:
  - **Vibrate on Incoming Message Switch**: Triggers gentle vibration on incoming message (default: `true`).
    - Implemented natively using React Native's `Vibration.vibrate(100)` (works 100% cross-platform without native build changes).
  - **Haptic Touch Feedback**: Light haptic feel on key button presses and audio recording controls.
* **In-App Notification Banners**:
  - **Show In-App Banners Switch**: Controls whether toast banners drop down when a message arrives while browsing another chat or settings screen (default: `true`).
  - **Message Preview Switch**: Controls whether the banner displays message text preview vs masked *"New message received"* (protects user privacy in public).
* **Voice & Video Call Alerts**:
  - **Call Ringtones Switch**: Controls audio playback for incoming WebRTC calls (linked with `CallContext`).
  - **Call Vibration Switch**: Controls vibration pattern during incoming calls.
* **Reset to Defaults Button**:
  - Convenient option at the bottom to reset all notification preferences to factory default.

---

### 3.4. Shared State: `PreferencesContext.tsx`
*Location: `src/context/PreferencesContext.tsx`*

```typescript
export interface UserPreferences {
  // Privacy
  readReceipts: boolean;
  showLastSeen: boolean;
  // Notifications & Sounds
  inAppSounds: boolean;
  sentMessageSound: boolean;
  notificationTone: 'default' | 'minimal' | 'pop' | 'silent';
  vibration: boolean;
  hapticFeedback: boolean;
  inAppBanners: boolean;
  messagePreview: boolean;
  callRingtone: boolean;
  callVibration: boolean;
}
```

* **Storage Strategy**:
  - Uses `appStorage.getItemAsync('chatuk_user_preferences')` for instant zero-latency loading on app boot.
  - Updates local state optimistically.
  - Debounced background sync to backend `PUT /api/user/preferences`.

---

## 4. Step-by-Step Implementation Roadmap

### Phase 1: Backend API Enhancements
1. **Enhance `getBlockedUsers` in `backend/src/controllers/user.controller.ts`**:
   - Query `db.collection('user')` for the details of blocked IDs so the endpoint returns `blockedUsers: [{ id, name, email, image }]` alongside `blockedUserIds`.
2. **Add Preferences Endpoints**:
   - In `backend/src/routes/user.routes.ts`:
     - `GET /api/user/preferences`
     - `PUT /api/user/preferences`
   - In `backend/src/controllers/user.controller.ts`:
     - Persist `preferences` subdocument in MongoDB user record and Redis cache.
3. **Frontend API Client (`src/lib/api.ts`)**:
   - Add `api.getUserPreferences()` and `api.updateUserPreferences(prefs)`.
   - Ensure `api.getBlockedUsers()` returns populated blocked user profiles.

### Phase 2: Preferences State Layer
1. Create `src/context/PreferencesContext.tsx` with default settings, types, local `appStorage` caching, and backend syncing.
2. Register `<PreferencesProvider>` inside `src/app/_layout.tsx` alongside `ThemeProvider` and `WallpaperProvider`.

### Phase 3: Screen 1 - Account & Security (`src/app/security.tsx`)
1. Create `src/app/security.tsx` following Chatuk's design system (`SafeAreaView`, `theme`, standard header with back button).
2. Build Account Information Card (email, auth provider, creation date).
3. Build Change Password Modal/Card:
   - Form fields for `currentPassword`, `newPassword`, `confirmPassword`.
   - Real-time password strength meter & match validation.
   - Show/Hide eye buttons for all password fields.
   - "Revoke other active sessions" toggle switch.
   - Connect to `authClient.changePassword` with error handling and success toasts.
4. Add OAuth fallback notice for Google Sign-In users.
5. Add Session & Cryptographic Key Diagnostics card.

### Phase 4: Screen 2 - Privacy & Permissions (`src/app/privacy.tsx`)
1. Create `src/app/privacy.tsx`.
2. Build Privacy Switches section:
   - Read Receipts toggle (hooked into `PreferencesContext`).
   - Last Seen & Online Status toggle (hooked into `PreferencesContext`).
3. Build Blocked Contacts section:
   - Load blocked users using `api.getBlockedUsers()`.
   - Render blocked users with avatar, name, email, and unblock button.
   - Handle unblock action via `api.unblockUser()` with confirmation modal and optimistic removal.
   - Empty state when no users are blocked.
4. Build App Permissions Audit section:
   - Inspect Camera, Microphone, and Photo Library permissions on mount.
   - Display status chips (`Granted` / `Not Granted`).
   - Action buttons to request permissions or deep-link to app settings (`Linking.openSettings()`).

### Phase 5: Screen 3 - Notifications & Sounds (`src/app/notifications.tsx`)
1. Create `src/app/notifications.tsx`.
2. Build In-App Audio & Tones section:
   - In-App Sounds switch.
   - Sent Message Chime switch.
   - Notification Tone selector with audio preview using `expo-audio`.
3. Build Vibration & Haptics section:
   - Message Vibration switch (tests vibration with `Vibration.vibrate(100)`).
   - In-app Haptics switch.
4. Build Banner Notifications section:
   - In-App Floating Banners switch.
   - Show Message Preview switch.
5. Build Call Alerts section (Call Ringtones & Vibration).
6. Build "Reset to Defaults" button with alert confirmation.

### Phase 6: Router & Profile Screen Integration
1. Update `src/app/_layout.tsx` Stack navigator:
   - Register `security`, `privacy`, and `notifications` stack screens with `slide_from_right` transitions.
2. Update `src/app/profile.tsx`:
   - Update MenuItem subtitles:
     - Account & Security: *"Change password, account details & security"*
     - Privacy & Permissions: *"Last seen, read receipts, blocked contacts"*
     - Notifications & Sounds: *"In-app sounds, vibration, banner alerts"*
   - Hook up `onPress` navigation:
     - `router.push('/security')`
     - `router.push('/privacy')`
     - `router.push('/notifications')`

### Phase 7: Verification & Quality Assurance
1. Run `npx tsc --noEmit` (ensure 0 TypeScript errors).
2. Run `npx expo lint` (ensure 0 ESLint errors in all touched files).
3. Test edge cases:
   - Passwords with incorrect current password or short new password.
   - Unblocking a user and confirming the list and chat state update.
   - Permission status changes when returning from system settings.
   - Switching themes (Light and Obsidian Sky) across all 3 new screens.

---

## 5. Definition of Done Checklist

- [ ] All three PREFERENCES menu items in `profile.tsx` navigate to their respective screens.
- [ ] Users can change their password using `authClient.changePassword` with clear validation and error handling.
- [ ] Blocked contacts list displays live data with instant unblocking capabilities.
- [ ] Privacy switches (Read Receipts, Online Status) persist locally and sync to the backend.
- [ ] App permissions (Camera, Mic, Photos) accurately reflect system status and offer deep-links.
- [ ] Notification and sound preferences persist and provide responsive audio and vibration feedback.
- [ ] Both Dark (Obsidian Sky) and Light themes look pixel-perfect across all new screens.
- [ ] `npx tsc --noEmit` passes with 0 errors.
- [ ] `npx expo lint` passes with 0 errors or warnings.
