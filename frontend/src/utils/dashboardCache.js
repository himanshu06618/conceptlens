/**
 * dashboardCache.js
 * 
 * Strict Per-User IndexedDB Cache for ConceptLens Dashboard.
 * 
 * Requirements:
 * - Strictly per-user (keyed by authenticated userId)
 * - Stored in IndexedDB (never localStorage for large payloads)
 * - Never served to another user (validates userId match)
 * - Complete wipe on logout (clearDashboardCache / clearAllDashboardCaches)
 * - Safe error boundaries if IndexedDB is disabled (private browsing / iframe)
 */

const DB_NAME = 'conceptlens_dashboard_db';
const DB_VERSION = 1;
const STORE_NAME = 'user_dashboard_cache';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.warn('IndexedDB open error:', event.target.error);
        resolve(null);
      };

      request.onblocked = () => {
        console.warn('IndexedDB open blocked');
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB unavailable:', err);
      resolve(null);
    }
  });
}

/**
 * Saves bootstrap dashboard payload for a specific user.
 * @param {string} userId - Authenticated user identifier
 * @param {object} data - Fresh bootstrap dashboard payload
 */
export async function saveDashboardCache(userId, data) {
  if (!userId || !data) return;

  try {
    const db = await openDatabase();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const record = {
          userId: String(userId),
          data,
          updatedAt: Date.now()
        };

        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (err) {
        console.warn('saveDashboardCache transaction error:', err);
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('saveDashboardCache error:', err);
  }
}

/**
 * Retrieves the cached dashboard payload for the specified user only.
 * Guaranteed never to return data belonging to another user.
 * @param {string} userId - Authenticated user identifier
 * @returns {Promise<object|null>} Cached payload or null
 */
export async function getDashboardCache(userId) {
  if (!userId) return null;

  try {
    const db = await openDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(String(userId));

        req.onsuccess = () => {
          const result = req.result;
          if (result && result.userId === String(userId) && result.data) {
            resolve({
              data: result.data,
              updatedAt: result.updatedAt || 0
            });
          } else {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      } catch (err) {
        console.warn('getDashboardCache transaction error:', err);
        resolve(null);
      }
    });
  } catch (err) {
    console.warn('getDashboardCache error:', err);
    return null;
  }
}

/**
 * Clears the cached dashboard data for a given user.
 * @param {string} userId 
 */
export async function clearDashboardCache(userId) {
  if (!userId) return;

  try {
    const db = await openDatabase();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(String(userId));
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('clearDashboardCache error:', err);
  }
}

/**
 * Clears all cached dashboard records across all users on logout.
 */
export async function clearAllDashboardCaches() {
  try {
    const db = await openDatabase();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('clearAllDashboardCaches error:', err);
  }
}
