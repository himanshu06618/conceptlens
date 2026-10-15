/**
 * Browser IndexedDB File Store for ConceptLens
 * Namespaced by userId and documentId.
 * Keeps original files locally on device for instant in-app PDF viewing and page linking.
 */

const DB_NAME = 'conceptlens_filestore_v1';
const DB_VERSION = 1;
const STORE_NAME = 'document_files';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported on this browser.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('docId', 'docId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function makeKey(userId, docId) {
  const uid = userId ? String(userId).trim() : 'guest';
  const did = docId ? String(docId).trim() : 'unknown';
  return `${uid}::${did}`;
}

/**
 * Compute SHA-256 hex string for a Blob or File
 */
export async function computeFileSHA256(fileBlob) {
  if (!fileBlob) return '';
  if (window.crypto && window.crypto.subtle) {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

/**
 * Save an original document file into local browser IndexedDB.
 * Supports:
 *   saveLocalFile(userId, docId, fileBlob, metadata)
 *   saveLocalFile(docId, fileBlob, metadata)
 */
export async function saveLocalFile(arg1, arg2, arg3, arg4) {
  let userId, docId, fileBlob, metadata;
  if (arg3 instanceof Blob || arg3 instanceof File) {
    userId = arg1 ? String(arg1).trim() : 'guest';
    docId = String(arg2).trim();
    fileBlob = arg3;
    metadata = typeof arg4 === 'object' && arg4 !== null ? arg4 : (typeof arg4 === 'string' ? { filename: arg4 } : {});
  } else {
    userId = 'guest';
    docId = String(arg1).trim();
    fileBlob = arg2;
    metadata = typeof arg3 === 'object' && arg3 !== null ? arg3 : (typeof arg3 === 'string' ? { filename: arg3 } : {});
  }

  if (!fileBlob || !docId) return null;
  const db = await openDB();

  let sha256 = metadata.sha256;
  if (!sha256) {
    sha256 = await computeFileSHA256(fileBlob);
  }

  const record = {
    key: makeKey(userId, docId),
    userId: userId || 'guest',
    docId: String(docId).trim(),
    blob: fileBlob,
    filename: metadata.filename || fileBlob.name || 'document',
    mime: metadata.mime || fileBlob.type || 'application/pdf',
    size: fileBlob.size || 0,
    sha256,
    savedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const putReq = store.put(record);

    putReq.onsuccess = () => resolve(record);
    putReq.onerror = () => reject(putReq.error);
  });
}

/**
 * Retrieve a local document file from IndexedDB as a Blob.
 * Supports:
 *   getLocalFile(userId, docId)
 *   getLocalFile(docId)
 */
export async function getLocalFile(arg1, arg2) {
  let userId = null;
  let docId = null;
  if (arg2 !== undefined && arg2 !== null) {
    userId = arg1 ? String(arg1).trim() : null;
    docId = String(arg2).trim();
  } else {
    docId = arg1 ? String(arg1).trim() : null;
  }

  if (!docId) return null;

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const handleFound = (record) => {
        if (!record) return resolve(null);
        const blob = record.blob;
        if (blob && !blob.name && record.filename) {
          try {
            Object.defineProperty(blob, 'name', { value: record.filename, configurable: true });
          } catch (_) {}
        }
        resolve(blob || record);
      };

      if (userId) {
        const key = makeKey(userId, docId);
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          if (getReq.result) {
            handleFound(getReq.result);
          } else {
            // Fallback: check docId index across any user
            const index = store.index('docId');
            const idxReq = index.get(docId);
            idxReq.onsuccess = () => handleFound(idxReq.result);
            idxReq.onerror = () => resolve(null);
          }
        };
        getReq.onerror = () => reject(getReq.error);
      } else {
        // Look up by docId index directly
        const index = store.index('docId');
        const idxReq = index.get(docId);
        idxReq.onsuccess = () => handleFound(idxReq.result);
        idxReq.onerror = () => reject(idxReq.error);
      }
    });
  } catch (err) {
    console.warn('Error reading local file store:', err);
    return null;
  }
}

/**
 * Delete a local document file when document is deleted.
 * Supports:
 *   deleteLocalFile(userId, docId)
 *   deleteLocalFile(docId)
 */
export async function deleteLocalFile(arg1, arg2) {
  let userId = null;
  let docId = null;
  if (arg2 !== undefined && arg2 !== null) {
    userId = arg1 ? String(arg1).trim() : null;
    docId = String(arg2).trim();
  } else {
    docId = arg1 ? String(arg1).trim() : null;
  }

  if (!docId) return false;

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      if (userId) {
        store.delete(makeKey(userId, docId));
      }
      store.delete(makeKey('guest', docId));

      // Also clean up any entries matching docId index
      const index = store.index('docId');
      const req = index.openCursor(IDBKeyRange.only(docId));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

/**
 * Clear all saved files on this device (User initiated via Profile/Account menu)
 */
export async function clearAllSavedFiles() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const clearReq = store.clear();
      clearReq.onsuccess = () => resolve(true);
      clearReq.onerror = () => reject(clearReq.error);
    });
  } catch (err) {
    console.warn('Error clearing file store:', err);
    return false;
  }
}

/**
 * Get count and total size of saved files on this device
 */
export async function getLocalFilesSummary(userId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        const filtered = userId ? list.filter((item) => item.userId === String(userId)) : list;
        const totalBytes = filtered.reduce((acc, item) => acc + (item.size || 0), 0);
        resolve({ count: filtered.length, totalBytes });
      };
      req.onerror = () => resolve({ count: 0, totalBytes: 0 });
    });
  } catch (_) {
    return { count: 0, totalBytes: 0 };
  }
}
