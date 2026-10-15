/**
 * Robust User Utilities
 * Provides safe display name and initials extraction that never throws on empty or missing values.
 */

/**
 * Returns the best available display name for a user.
 * Priority: user.name -> user.display_name -> user.username -> email prefix -> 'Student' / 'Guest'
 *
 * @param {object|string|null|undefined} user
 * @param {string} [guestFallback='Guest']
 * @returns {string} Safe non-empty display name
 */
export function getDisplayName(user, guestFallback = 'Guest') {
  if (!user) return guestFallback;

  if (typeof user === 'string') {
    const trimmed = user.trim();
    return trimmed || guestFallback;
  }

  if (typeof user === 'object') {
    // 1. Explicit full name
    const name = typeof user.name === 'string' ? user.name.trim() : '';
    if (name) return name;

    // 2. Explicit display name
    const displayName = typeof user.display_name === 'string' ? user.display_name.trim() : '';
    if (displayName) return displayName;

    // 3. Username
    const username = typeof user.username === 'string' ? user.username.trim() : '';
    if (username) return username;

    // 4. Email prefix (e.g. "alex.smith" from "alex.smith@example.com")
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    if (email && email.includes('@')) {
      const prefix = email.split('@')[0].trim();
      if (prefix) return prefix;
    }
  }

  return guestFallback;
}

/**
 * Returns a clean user handle (e.g. '@alexsmith' or '@alex.smith').
 * Returns empty string if no valid username or email exists.
 *
 * @param {object|null|undefined} user
 * @returns {string}
 */
export function getUserHandle(user) {
  if (!user || typeof user !== 'object') return '';

  const username = typeof user.username === 'string' ? user.username.trim() : '';
  if (username) return username.startsWith('@') ? username : `@${username}`;

  const email = typeof user.email === 'string' ? user.email.trim() : '';
  if (email && email.includes('@')) {
    const prefix = email.split('@')[0].trim();
    if (prefix) return `@${prefix}`;
  }

  return '';
}

/**
 * Returns clean 1-2 letter initials for avatars.
 * Never throws on null, undefined, numbers, or malformed objects.
 *
 * @param {object|string|null|undefined} userOrName
 * @returns {string} 1-2 uppercase letters
 */
export function getInitials(userOrName) {
  let text = '';
  if (typeof userOrName === 'string') {
    text = userOrName.trim();
  } else if (userOrName && typeof userOrName === 'object') {
    text = getDisplayName(userOrName, 'CL');
  }

  if (!text || text === 'Guest') return 'CL';

  // Strip non-alphanumeric leading/trailing symbols
  const cleaned = text.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (!cleaned) return 'CL';

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CL';
  if (parts.length === 1) {
    const first = parts[0];
    return (first.length >= 2 ? first.slice(0, 2) : first).toUpperCase();
  }

  const firstChar = parts[0][0] || '';
  const lastChar = parts[parts.length - 1][0] || '';
  const combined = (firstChar + lastChar).toUpperCase();
  return combined || 'CL';
}
