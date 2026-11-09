/**
 * Ensures that audio URLs (especially those recorded in web browsers using WebM/Opus)
 * are served in universal MP3 format via Cloudinary dynamic transformation.
 * iOS AVPlayer natively supports MP3/AAC, but cannot decode WebM/Opus audio containers.
 */
export function getPlayableAudioUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('res.cloudinary.com')) {
    // If it is a Cloudinary asset, ensure delivery in universal MP3 format
    if (trimmed.includes('/upload/') && !trimmed.includes('/f_mp3')) {
      const transformed = trimmed.replace('/upload/', '/upload/f_mp3/');
      return transformed.replace(/\.(webm|ogg|wav|opus)(\?.*)?$/i, '.mp3$2');
    }
  }

  return trimmed;
}
