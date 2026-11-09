/**
 * Client-side attachment encryption and Cloudinary upload service.
 * Enforces zero-knowledge storage: Cloudinary only ever receives ciphertext.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.6.
 */
import { defaultCipher } from '../crypto/sodiumCipher';
import { toBase64, fromBase64 } from '../crypto/encoding';
import { PlainAttachment } from '../crypto/E2EECipher';
import { getOrigin } from '../lib/auth-client';
import { getSessionAuth } from '../lib/api';

export interface UploadSignResponse {
  success: boolean;
  signature: string;
  timestamp: number;
  public_id: string;
  folder: string;
  api_key: string;
  cloud_name: string;
}

/**
 * Requests signed upload parameters from the backend.
 */
export async function getSignedUploadParams(): Promise<UploadSignResponse> {
  const serverUrl = getOrigin();
  const { token, cookie } = await getSessionAuth();

  const response = await fetch(`${serverUrl}/api/uploads/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get signed upload parameters: ${response.status}`);
  }

  return response.json();
}

/**
 * Encrypts a binary attachment and uploads the encrypted blob directly to Cloudinary.
 * Returns the PlainAttachment object containing the Cloudinary URL and base64 file key.
 */
export async function encryptAndUploadAttachment(
  bytes: Uint8Array,
  mime: string,
  meta?: { width?: number; height?: number; durationMs?: number }
): Promise<PlainAttachment> {
  // 1. Encrypt file on-device using XChaCha20-Poly1305 with prefixed nonce
  const { blob, key } = await defaultCipher.encryptFile(bytes);

  // 2. Obtain signed upload parameters from the backend
  const signParams = await getSignedUploadParams();

  // 3. Upload raw encrypted blob directly to Cloudinary
  const uploadUrl = `https://api.cloudinary.com/v1_1/${signParams.cloud_name}/raw/upload`;

  const formData = new FormData();
  formData.append('api_key', signParams.api_key);
  formData.append('timestamp', signParams.timestamp.toString());
  formData.append('signature', signParams.signature);
  formData.append('public_id', signParams.public_id);
  formData.append('folder', signParams.folder);

  // Append encrypted blob as raw file
  const fileBlob = new Blob([blob.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  formData.append('file', fileBlob as any, `${signParams.public_id}.enc`);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Cloudinary raw upload failed: ${uploadRes.status} ${errorText}`);
  }

  const uploadResult = await uploadRes.json();

  return {
    url: uploadResult.secure_url || uploadResult.url,
    key: toBase64(key),
    size: bytes.length,
    mime,
    width: meta?.width,
    height: meta?.height,
    durationMs: meta?.durationMs,
  };
}

/**
 * Downloads an encrypted attachment blob from Cloudinary and decrypts it on-device.
 */
export async function downloadAndDecryptAttachment(
  url: string,
  keyBase64: string
): Promise<Uint8Array> {
  const keyBytes = fromBase64(keyBase64);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download attachment blob: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const encryptedBlob = new Uint8Array(arrayBuffer);

  return defaultCipher.decryptFile(encryptedBlob, keyBytes);
}
