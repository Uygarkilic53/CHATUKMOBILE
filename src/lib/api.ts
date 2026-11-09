import { Platform } from 'react-native';
import { getOrigin, authClient } from './auth-client';
import { appStorage } from './storage';
import { getStoredDeviceKeys } from '../e2ee/keyStore';

export const getApiBaseUrl = () => {
  return `${getOrigin()}/api`;
};

/**
 * Safely parse JSON responses from backend.
 * Protects against unexpected HTML responses (such as 404/502 error pages or wrong server ports).
 */
async function parseJsonResponse(res: Response, defaultErrorMessage: string) {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}: ${res.statusText || defaultErrorMessage}`);
    }
    throw new Error(`Invalid response received from server (${res.status}). Expected JSON.`);
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearSessionAuth().catch(() => {});
    }
    throw new Error(data?.error || data?.message || defaultErrorMessage);
  }

  return data;
}

let isLoggingOut = false;

export const isLoggingOutState = (): boolean => isLoggingOut;

export const setIsLoggingOut = (value: boolean): void => {
  isLoggingOut = value;
};

export const clearSessionAuth = async () => {
  cachedActiveUserId = null;
  cachedActiveUserEmail = null;
  try {
    appStorage.setItem('chatuk_remember_me', 'false');
    await appStorage.deleteItemAsync('chatuk_cookie');
    await appStorage.deleteItemAsync('chatuk_session_token');
    await appStorage.deleteItemAsync('chatuk_session_data');
    await appStorage.deleteItemAsync('chatuk_token');
    await appStorage.deleteItemAsync('chatuk_active_user_id');
    await appStorage.deleteItemAsync('chatuk_active_user_email');
    await appStorage.setItemAsync('chatuk_remember_me', 'false');
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.cookie = 'better-auth.session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;';
      document.cookie = 'chatuk.session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;';
    }
  } catch (e) {
    console.warn('[clearSessionAuth] Error clearing auth state:', e);
  }
};

/**
 * Extract active session token and standard HTTP Cookie string from storage
 */
export const getSessionAuth = async (): Promise<{ token: string | null; cookie: string | null }> => {
  let token: string | null = null;
  let cookieHeader: string | null = null;

  try {
    // 1. Check raw cookie stored by @better-auth/expo (key: 'chatuk_cookie')
    const storedCookieJson = await appStorage.getItemAsync('chatuk_cookie');
    if (storedCookieJson) {
      try {
        const parsed = JSON.parse(storedCookieJson);
        const sessionTokenObj =
          parsed['better-auth.session_token'] ||
          parsed['chatuk.session_token'] ||
          parsed['__Secure-better-auth.session_token'];

        if (sessionTokenObj?.value) {
          let val = sessionTokenObj.value;
          if (val.startsWith('s:')) val = val.slice(2);
          token = val.split('.')[0].trim();
        }

        // Format valid standard HTTP Cookie header: "name=value; name2=value2"
        const validCookies = Object.entries(parsed)
          .filter(([_, v]: any) => !v.expires || new Date(v.expires).getTime() > Date.now())
          .map(([k, v]: any) => `${k}=${v.value}`);

        if (validCookies.length > 0) {
          cookieHeader = validCookies.join('; ');
        }
      } catch {
        cookieHeader = storedCookieJson;
      }
    }

    // 2. Fallback: check session data cached by @better-auth/expo (key: 'chatuk_session_data')
    if (!token) {
      const cachedSessionRaw = await appStorage.getItemAsync('chatuk_session_data');
      if (cachedSessionRaw) {
        try {
          const cached = JSON.parse(cachedSessionRaw);
          if (cached?.session?.token) {
            token = cached.session.token;
          }
        } catch {}
      }
    }

    // 3. Fallback: direct token keys
    if (!token) {
      token =
        (await appStorage.getItemAsync('chatuk_session_token')) ||
        (await appStorage.getItemAsync('chatuk_token'));
    }

    // 4. Web browser fallback: read document.cookie if available
    if (!token && Platform.OS === 'web' && typeof document !== 'undefined' && document.cookie) {
      const match =
        document.cookie.match(/(?:better-auth\.session_token|chatuk\.session_token)=([^;]+)/);
      if (match && match[1]) {
        let val = decodeURIComponent(match[1]);
        if (val.startsWith('s:')) val = val.slice(2);
        token = val.split('.')[0].trim();
      }
    }

    // 5. Active session fallback: query authClient directly
    if (!token) {
      try {
        const sessRes = await authClient.getSession().catch(() => null);
        const resolvedToken = sessRes?.data?.session?.token;
        if (resolvedToken && typeof resolvedToken === 'string') {
          token = resolvedToken;
          await appStorage.setItemAsync('chatuk_session_token', token);
          if (sessRes?.data) {
            await appStorage.setItemAsync('chatuk_session_data', JSON.stringify(sessRes.data));
          }
          if (sessRes?.data?.user?.id) {
            setActiveUserInfo(sessRes.data.user.id, sessRes.data.user.email);
          }
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[getSessionAuth] Error resolving auth token:', err);
  }

  return { token, cookie: cookieHeader };
};

let cachedActiveUserId: string | null = null;
let cachedActiveUserEmail: string | null = null;

export const setActiveUserInfo = (userId: string | null, email?: string | null) => {
  if (userId) {
    cachedActiveUserId = userId;
    appStorage.setItem('chatuk_active_user_id', userId);
    appStorage.setItemAsync('chatuk_active_user_id', userId).catch(() => {});
  }
  if (email) {
    cachedActiveUserEmail = email;
    appStorage.setItem('chatuk_active_user_email', email);
    appStorage.setItemAsync('chatuk_active_user_email', email).catch(() => {});
  }
};

export const getActiveUserIdSync = (): string | null => {
  if (cachedActiveUserId) return cachedActiveUserId;
  const stored = appStorage.getItem('chatuk_active_user_id');
  if (stored) {
    cachedActiveUserId = stored;
    return stored;
  }
  const sessionRaw = appStorage.getItem('chatuk_session_data');
  if (sessionRaw) {
    try {
      const parsed = JSON.parse(sessionRaw);
      const uid = parsed?.user?.id || parsed?.session?.userId;
      if (uid) {
        cachedActiveUserId = uid;
        return uid;
      }
    } catch {}
  }
  return null;
};

export const getActiveUserEmailSync = (): string | null => {
  if (cachedActiveUserEmail) return cachedActiveUserEmail;
  const stored = appStorage.getItem('chatuk_active_user_email');
  if (stored) {
    cachedActiveUserEmail = stored;
    return stored;
  }
  const sessionRaw = appStorage.getItem('chatuk_session_data');
  if (sessionRaw) {
    try {
      const parsed = JSON.parse(sessionRaw);
      const email = parsed?.user?.email;
      if (email) {
        cachedActiveUserEmail = email;
        return email;
      }
    } catch {}
  }
  return null;
};

/**
 * Safely extracts the current authenticated user's ID from storage, session, or profile
 */
export const getActiveUserId = async (): Promise<string | null> => {
  if (cachedActiveUserId) return cachedActiveUserId;

  try {
    const stored = await appStorage.getItemAsync('chatuk_active_user_id');
    if (stored) {
      cachedActiveUserId = stored;
      return stored;
    }

    const sessionRes = await authClient.getSession().catch(() => null);
    if (sessionRes?.data?.user?.id) {
      cachedActiveUserId = sessionRes.data.user.id;
      if (sessionRes.data.user.email) {
        cachedActiveUserEmail = sessionRes.data.user.email;
      }
      setActiveUserInfo(cachedActiveUserId, cachedActiveUserEmail);
      return cachedActiveUserId;
    }

    const raw = await appStorage.getItemAsync('chatuk_session_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user?.id) {
        cachedActiveUserId = parsed.user.id;
        return parsed.user.id;
      }
      if (parsed?.session?.userId) {
        cachedActiveUserId = parsed.session.userId;
        return parsed.session.userId;
      }
    }
  } catch {}
  return null;
};

export const api = {
  async getAuthHeaders(sessionToken?: string) {
    const headers: Record<string, string> = {};

    // In browsers, setting 'Origin' is forbidden and causes console warnings.
    // On native mobile platforms, Expo needs it for CSRF / origin validation.
    if (Platform.OS !== 'web') {
      headers['Origin'] = getOrigin();
    }

    const { token, cookie } = await getSessionAuth();
    const finalToken = sessionToken || token;

    if (finalToken) {
      headers['Authorization'] = `Bearer ${finalToken}`;
      headers['x-session-token'] = finalToken;
    }

    // In browsers, setting 'Cookie' is forbidden and sent automatically via credentials: 'include'.
    if (cookie && Platform.OS !== 'web') {
      headers['Cookie'] = cookie;
    }

    return headers;
  },

  async uploadProfilePicture(imageInput: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    if (typeof imageInput === 'string' && (imageInput.startsWith('file://') || imageInput.startsWith('content://'))) {
      const formData = new FormData();
      const filename = imageInput.split('/').pop() || 'avatar.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1].toLowerCase() : 'jpg';
      const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      formData.append('image', {
        uri: imageInput,
        name: filename,
        type,
      } as any);

      // Do not set Content-Type header so fetch adds multipart boundary
      delete headers['Content-Type'];

      const res = await fetch(`${baseUrl}/user/profile-picture`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });

      return await parseJsonResponse(res, 'Failed to upload profile picture');
    }

    headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}/user/profile-picture`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ image: imageInput }),
    });

    return await parseJsonResponse(res, 'Failed to upload profile picture');
  },

  async uploadMedia(
    fileInput: string | { uri: string; name?: string; type?: string; folder?: string },
    sessionToken?: string
  ): Promise<{
    success: boolean;
    url: string;
    publicId: string;
    resourceType: 'image' | 'video' | string;
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
    bytes?: number;
  }> {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    // Resolve file upload payload (object with uri, name, type)
    let filePayload: any = null;
    if (typeof fileInput === 'object' && fileInput.uri) {
      const filename = fileInput.name || fileInput.uri.split('/').pop() || 'media_file';
      const type = fileInput.type || (filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
      filePayload = {
        uri: fileInput.uri,
        name: filename,
        type,
      };
    } else if (
      typeof fileInput === 'string' &&
      (fileInput.startsWith('file://') ||
        fileInput.startsWith('content://') ||
        fileInput.startsWith('ph://'))
    ) {
      const filename = fileInput.split('/').pop() || 'media_file';
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1].toLowerCase() : '';
      const isVideo = ['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext);
      const type = isVideo
        ? ext === 'mov'
          ? 'video/quicktime'
          : 'video/mp4'
        : ext === 'png'
        ? 'image/png'
        : 'image/jpeg';
      filePayload = {
        uri: fileInput,
        name: filename,
        type,
      };
    }

    // Performance Optimization: Direct-to-Cloudinary pre-signed upload (Sprint 4)
    if (filePayload) {
      const targetFolder =
        typeof fileInput === 'object' && (fileInput as any).folder
          ? (fileInput as any).folder
          : filePayload.type?.startsWith('audio/') || filePayload.name?.toLowerCase().endsWith('.m4a')
          ? 'chatuk/VoiceMessages'
          : 'chatuk/MessageMedia';

      // In web browser environments, convert blob: / data: URIs to real File objects so browser FormData does not stringify to [object Object]
      let uploadBinary: any = filePayload;
      if (
        typeof window !== 'undefined' &&
        typeof filePayload?.uri === 'string' &&
        (filePayload.uri.startsWith('blob:') || filePayload.uri.startsWith('data:'))
      ) {
        try {
          const blobRes = await fetch(filePayload.uri);
          const blobData = await blobRes.blob();
          uploadBinary = new File([blobData], filePayload.name || 'media_file', {
            type: filePayload.type || blobData.type || 'application/octet-stream',
          });
        } catch (blobErr) {
          console.warn('[Upload] Could not convert URI to Blob on web:', blobErr);
        }
      }

      try {
        const signHeaders = { ...headers };
        signHeaders['Content-Type'] = 'application/json';
        const signRes = await fetch(`${baseUrl}/uploads/sign`, {
          method: 'POST',
          headers: signHeaders,
          credentials: 'include',
          body: JSON.stringify({ folder: targetFolder }),
        });

        if (signRes.ok) {
          const signData = await signRes.json();
          if (signData?.success && signData.cloud_name && signData.api_key && signData.signature) {
            const cloudFormData = new FormData();
            cloudFormData.append('api_key', signData.api_key);
            cloudFormData.append('timestamp', signData.timestamp.toString());
            cloudFormData.append('signature', signData.signature);
            cloudFormData.append('public_id', signData.public_id);
            cloudFormData.append('folder', signData.folder || targetFolder);
            cloudFormData.append('file', uploadBinary as any);

            const cloudRes = await fetch(
              `https://api.cloudinary.com/v1_1/${signData.cloud_name}/auto/upload`,
              {
                method: 'POST',
                body: cloudFormData,
              }
            );

            if (cloudRes.ok) {
              const result = await cloudRes.json();
              return {
                success: true,
                url: result.secure_url || result.url,
                publicId: result.public_id,
                resourceType: result.resource_type || 'image',
                width: result.width,
                height: result.height,
                duration: result.duration,
                format: result.format,
                bytes: result.bytes,
              };
            } else {
              console.warn('[Upload] Direct Cloudinary upload failed status:', cloudRes.status);
            }
          }
        }
      } catch (directErr) {
        console.warn('[Upload] Direct Cloudinary upload failed, using server fallback:', directErr);
      }

      // Fallback: upload through backend Node.js server
      const formData = new FormData();
      formData.append('file', uploadBinary as any);
      formData.append('folder', targetFolder);
      delete headers['Content-Type'];

      const res = await fetch(`${baseUrl}/uploads/media`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });

      return await parseJsonResponse(res, 'Failed to upload media to Cloudinary');
    }

    // Base64 or direct URL payload fallback
    headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}/uploads/media`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ file: fileInput }),
    });

    return await parseJsonResponse(res, 'Failed to upload media to Cloudinary');
  },


  async deleteProfilePicture(sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/user/profile-picture`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to delete profile picture');
  },

  async getProfile(sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/user/profile`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    const data = await parseJsonResponse(res, 'Failed to fetch profile');
    if (data?.user?.id) {
      setActiveUserInfo(data.user.id, data.user.email);
    }
    return data;
  },

  async updateTheme(theme: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/user/theme`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ theme }),
    });

    return await parseJsonResponse(res, 'Failed to update theme preference');
  },

  async updateBio(bio: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/user/bio`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ bio }),
    });

    return await parseJsonResponse(res, 'Failed to update bio');
  },

  async updateWallpaper(wallpaperId: string, updatedAt: number, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/user/wallpaper`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ wallpaperId, updatedAt }),
    });

    return await parseJsonResponse(res, 'Failed to update wallpaper preference');
  },

  async getUserPreferences(sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/user/preferences`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to fetch preferences');
  },

  async updateUserPreferences(preferences: Record<string, any>, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/user/preferences`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ preferences }),
    });

    return await parseJsonResponse(res, 'Failed to update preferences');
  },

  async createOrFindConversation(email: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/messages/conversations`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });

    return await parseJsonResponse(res, 'Failed to create conversation');
  },

  async getConversations(sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    const data = await parseJsonResponse(res, 'Failed to fetch conversations');
    if (data?.currentUserId) {
      setActiveUserInfo(data.currentUserId, data.currentUserEmail);
    }
    return data;
  },

  async getConversation(id: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations/${id}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    const data = await parseJsonResponse(res, 'Failed to fetch conversation');
    if (data?.currentUserId) {
      setActiveUserInfo(data.currentUserId, data.currentUserEmail);
    }
    return data;
  },

  async getMessages(id: string, page = 1, limit = 50, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    try {
      const keys = await getStoredDeviceKeys();
      if (keys?.deviceId) {
        headers['x-device-id'] = keys.deviceId;
      }
    } catch {}

    const res = await fetch(`${baseUrl}/messages/conversations/${id}/messages?page=${page}&limit=${limit}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to fetch messages');
  },

  async clearConversation(id: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations/${id}/clear`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to clear conversation');
  },

  async deleteConversation(id: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations/${id}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to delete conversation');
  },

  async getConversationMedia(id: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations/${id}/media`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to fetch conversation media');
  },

  async deleteMessage(messageId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/${messageId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to delete message');
  },

  async getMessageInfo(messageId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/${encodeURIComponent(messageId)}/info`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to fetch message info');
  },

  async toggleReaction(
    messageId: string,
    conversationId: string,
    emoji: string,
    action: 'add' | 'remove' | 'toggle' = 'toggle',
    sessionToken?: string
  ) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/messages/${messageId}/reaction`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ conversationId, emoji, action }),
    });

    return await parseJsonResponse(res, 'Failed to toggle reaction');
  },

  async blockUser(targetUserId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/user/block`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ targetUserId }),
    });

    return await parseJsonResponse(res, 'Failed to block user');
  },

  async unblockUser(targetUserId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/user/unblock`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ targetUserId }),
    });

    return await parseJsonResponse(res, 'Failed to unblock user');
  },

  async getBlockedUsers(sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/user/blocked`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to fetch blocked users');
  },

  async acceptConversation(conversationId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations/${conversationId}/accept`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to accept conversation');
  },

  async denyConversation(conversationId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/messages/conversations/${conversationId}/deny`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to deny conversation');
  },

  async createGroup(data: {
    name: string;
    description?: string;
    groupAvatarUrl?: string;
    groupAvatarPublicId?: string;
    participantEmails?: string[];
    participantIds?: string[];
  }, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/groups`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(data),
    });

    return await parseJsonResponse(res, 'Failed to create group');
  },

  async getGroupDetails(groupId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/groups/${groupId}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to fetch group details');
  },

  async updateGroupDetails(groupId: string, data: {
    name?: string;
    description?: string;
    groupAvatarUrl?: string;
    groupAvatarPublicId?: string;
  }, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/groups/${groupId}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify(data),
    });

    return await parseJsonResponse(res, 'Failed to update group');
  },

  async addGroupParticipants(groupId: string, data: {
    emails?: string[];
    userIds?: string[];
  }, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/groups/${groupId}/participants`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(data),
    });

    return await parseJsonResponse(res, 'Failed to add participants');
  },

  async removeGroupParticipant(groupId: string, userId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/groups/${groupId}/participants/${userId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to remove participant');
  },

  async changeGroupAdminRole(groupId: string, userId: string, action: 'promote' | 'demote', sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/groups/${groupId}/admins/${userId}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ action }),
    });

    return await parseJsonResponse(res, 'Failed to update admin role');
  },

  async leaveGroup(groupId: string, sessionToken?: string) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);

    const res = await fetch(`${baseUrl}/groups/${groupId}/leave`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });

    return await parseJsonResponse(res, 'Failed to leave group');
  },

  async sendContactSubmission(
    data: {
      name: string;
      email: string;
      category: string;
      message: string;
      attachments?: string[];
    },
    sessionToken?: string
  ) {
    const baseUrl = getApiBaseUrl();
    const headers = await this.getAuthHeaders(sessionToken);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}/contact`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(data),
    });

    return await parseJsonResponse(res, 'Failed to submit contact report');
  },
};

export const updateUserWallpaper = async (
  wallpaperId: string,
  updatedAt: number,
  sessionToken?: string
) => {
  return api.updateWallpaper(wallpaperId, updatedAt, sessionToken);
};

export interface RequestPasswordResetParams {
  email: string;
  redirectTo?: string;
}

export interface ResetPasswordWithTokenParams {
  newPassword: string;
  token: string;
}

export interface PasswordResetResponse {
  status: boolean;
  message?: string;
}

/**
 * Request a password reset link to be sent via email (Mailtrap)
 */
export const requestPasswordReset = async (
  params: RequestPasswordResetParams
): Promise<PasswordResetResponse> => {
  const origin = getOrigin();
  const res = await fetch(`${origin}/api/auth/request-password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(Platform.OS !== 'web' ? { Origin: origin } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(params),
  });

  return await parseJsonResponse(res, 'Failed to send password reset email.');
};

/**
 * Reset user password with token received via email
 */
export const resetPasswordWithToken = async (
  params: ResetPasswordWithTokenParams
): Promise<PasswordResetResponse> => {
  const origin = getOrigin();
  const res = await fetch(`${origin}/api/auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(Platform.OS !== 'web' ? { Origin: origin } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(params),
  });

  return await parseJsonResponse(res, 'Failed to reset password.');
};





