/**
 * Safe image source resolver to guard against empty strings, invalid types,
 * or broken URIs that cause Expo Image / React Native Image to warn or crash.
 */
export function getSafeImageSource(
  uri?: any,
  fallback = require('../assets/images/blank.png')
) {
  if (typeof uri === 'number') {
    return uri;
  }
  if (typeof uri === 'string' && uri.trim().length > 0) {
    return { uri: uri.trim() };
  }
  if (typeof uri === 'object' && uri !== null && typeof uri.uri === 'string' && uri.uri.trim().length > 0) {
    return { uri: uri.uri.trim() };
  }
  return fallback;
}

export function isValidImageUri(uri?: any): uri is string {
  if (typeof uri === 'string') return uri.trim().length > 0;
  if (typeof uri === 'object' && uri !== null && typeof uri.uri === 'string') return uri.uri.trim().length > 0;
  return false;
}
