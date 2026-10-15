const getApiBase = () => {
  if (typeof window !== 'undefined' && window.__API_BASE__) {
    const custom = String(window.__API_BASE__).trim().replace(/\/+$/, '');
    return custom.endsWith('/api') ? custom : `${custom}/api`;
  }
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE;
  if (envUrl && typeof envUrl === 'string') {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  // In development with Vite proxy, use relative '/api'
  if (import.meta.env.DEV) {
    return '/api';
  }
  // In browser on localhost without env var, use standard local backend
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:8000/api';
  }
  // Production fallback: relative '/api' for platforms with reverse-proxy/rewrites
  return '/api';
};

const API_BASE = getApiBase();

/**
 * Enhanced fetch wrapper with credentials: 'include' and automatic 401 interceptor.
 */
async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const headers = { ...options.headers };

  // Attach Authorization Bearer token from localStorage if available
  const token = localStorage.getItem('conceptlens_token');
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Attach guest session ID from localStorage if available
  const guestSession = localStorage.getItem('conceptlens_guest_session');
  if (guestSession && !headers['X-Guest-Session']) {
    headers['X-Guest-Session'] = guestSession;
  }

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    // Only dispatch session expired event for expired session requests (not login/register/initial check or public queries)
    if (!endpoint.includes('/auth/login') && !endpoint.includes('/auth/register') && !endpoint.includes('/auth/me') && !endpoint.includes('/documents')) {
      window.dispatchEvent(new CustomEvent('conceptlens:unauthorized'));
    }
  }

  return res;
}

export async function getGuestStatus() {
  try {
    const res = await apiFetch('/guest/status');
    if (!res.ok) {
      return {
        is_authenticated: false,
        uploads_count: 0,
        upload_limit: 5,
        remaining: 5,
      };
    }
    const data = await res.json();
    if (data.guest_id) {
      localStorage.setItem('conceptlens_guest_session', data.guest_id);
    }
    return data;
  } catch (err) {
    return {
      is_authenticated: false,
      uploads_count: 0,
      upload_limit: 5,
      remaining: 5,
    };
  }
}

export async function uploadDocument(file, { password = null, mode = null, idempotencyKey = null, signal = null } = {}) {
  const key = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('idempotency_key', key);
  if (password) {
    formData.append('pdf_password', password);
  }
  if (mode) {
    formData.append('extraction_mode', mode);
  }

  const res = await apiFetch('/documents', {
    method: 'POST',
    body: formData,
    headers: {
      'X-Idempotency-Key': key,
    },
    signal,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const error = new Error(errorData.detail || `Upload failed (${res.status})`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}

export async function getDocumentStatus(docId) {
  const res = await apiFetch(`/documents/${docId}/status`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to fetch document status');
  }
  return res.json();
}

export async function getProvidersHealth() {
  const res = await apiFetch('/health/providers');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export async function listDocuments() {
  const res = await apiFetch('/documents');
  if (!res.ok) {
    if (res.status === 401) {
      return [];
    }
    throw new Error('Failed to fetch documents list');
  }
  return res.json();
}

export async function getDocument(docId) {
  const res = await apiFetch(`/documents/${docId}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to fetch document status');
  }
  return res.json();
}

export async function getDocumentConcepts(docId, { q = '', topic = '', minImportance = null } = {}) {
  const params = new URLSearchParams();
  if (q && q.trim()) params.append('q', q.trim());
  if (topic && topic !== 'All') params.append('topic', topic);
  if (minImportance) params.append('min_importance', minImportance);

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/documents/${docId}/concepts${queryStr}`);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to fetch concepts');
  }
  return res.json();
}

export async function getDocumentTree(docId) {
  const res = await apiFetch(`/documents/${docId}/tree`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to load concept tree');
  }
  return res.json();
}


export async function deleteDocument(docId) {
  const res = await apiFetch(`/documents/${docId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to delete document');
  }
  return res.json();
}

export async function exportDocument(docId, filename, format = 'json') {
  const res = await apiFetch(`/documents/${docId}/export?format=${format}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Export failed');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = filename ? filename.replace(/\.[^/.]+$/, '') : 'document';
  a.download = `${baseName}_concepts.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export function getExportUrl(docId, format = 'json') {
  return `${API_BASE}/documents/${docId}/export?format=${format}`;
}

export function getDocumentFileUrl(docId, page = null) {
  const hash = page ? `#page=${page}` : '';
  return `${API_BASE}/documents/${docId}/file${hash}`;
}

export async function fetchDocumentFileUrl(docId) {
  const res = await apiFetch(`/documents/${docId}/file-url`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to fetch document file URL');
  }
  return res.json();
}

export async function downloadDocumentBlob(urlOrDocId) {
  let url = urlOrDocId;
  if (!url.startsWith('http') && !url.startsWith('/')) {
    url = `/documents/${urlOrDocId}/file`;
  }
  // External presigned S3 URL
  if (url.startsWith('https://') && !url.includes('/api/documents/') && typeof window !== 'undefined' && !url.includes(window.location.host)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download file from storage: ${res.statusText}`);
    return await res.blob();
  }
  // Internal API endpoint: authenticated via apiFetch
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to download file: ${res.statusText}`);
  }
  return await res.blob();
}

export async function reattachDocumentFile(docId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`/documents/${docId}/file`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to re-attach file');
  }
  return res.json();
}

export async function checkBackendHealth() {
  try {
    const res = await apiFetch('/health');
    return res.ok;
  } catch {
    return false;
  }
}

export async function setConceptProgress(conceptId, status) {
  const res = await apiFetch(`/concepts/${encodeURIComponent(conceptId)}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.detail || 'Failed to update concept progress');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function bulkSetConceptProgress(conceptIds, status) {
  const res = await apiFetch('/concepts/progress/bulk', {
    method: 'PUT',
    body: JSON.stringify({ concept_ids: conceptIds, status }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.detail || 'Failed to bulk update concept progress');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function getDocumentProgress(docId) {
  const res = await apiFetch(`/documents/${encodeURIComponent(docId)}/progress`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to fetch document progress');
  }
  return res.json();
}

export async function reanalyzeDocument(docId) {
  const res = await apiFetch(`/documents/${encodeURIComponent(docId)}/reanalyze`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.detail || 'Failed to re-analyze document');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ==================== Authentication API ====================

export async function registerUser({ email, username, password, confirmPassword, name, displayName, role = 'student' }) {
  const cleanEmail = email?.trim() || (username && username.includes('@') ? username.trim() : undefined);
  const cleanUsername = username && !username.includes('@') ? username.trim() : undefined;
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: cleanEmail,
      username: cleanUsername,
      password,
      confirm_password: confirmPassword,
      name: name?.trim() || displayName?.trim() || undefined,
      display_name: displayName?.trim() || name?.trim() || undefined,
      role: role || 'student',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Registration failed');
  }
  const token = data.token || data.access_token;
  if (token) {
    localStorage.setItem('conceptlens_token', token);
  }
  localStorage.removeItem('conceptlens_guest_session');
  return data;
}

export async function loginUser({ email, username, password }) {
  const cleanEmail = email?.trim() || (username && username.includes('@') ? username.trim() : undefined);
  const cleanUsername = username && !username.includes('@') ? username.trim() : undefined;
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: cleanEmail,
      username: cleanUsername,
      password,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Login failed');
  }
  const token = data.token || data.access_token;
  if (token) {
    localStorage.setItem('conceptlens_token', token);
  }
  localStorage.removeItem('conceptlens_guest_session');
  return data;
}

export async function googleLogin(credential) {
  const res = await apiFetch('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Google sign-in failed');
  }
  const token = data.token || data.access_token;
  if (token) {
    localStorage.setItem('conceptlens_token', token);
  }
  localStorage.removeItem('conceptlens_guest_session');
  return data;
}

export async function setUserRole(role) {
  const res = await apiFetch('/auth/role', {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to set account role');
  }
  return data;
}

export async function getAuthConfig() {
  try {
    const res = await apiFetch('/auth/config');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function logoutUser() {
  localStorage.removeItem('conceptlens_token');
  const res = await apiFetch('/auth/logout', {
    method: 'POST',
  });
  return res.json().catch(() => ({ success: true }));
}

export async function getCurrentUser() {
  const res = await apiFetch('/auth/me');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export async function updateUserProfile(payload) {
  const cleanDisplayName = typeof payload === 'string'
    ? payload.trim()
    : (payload?.displayName || payload?.display_name || '').trim();

  const res = await apiFetch('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: cleanDisplayName }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to update profile');
  }
  return data;
}

export async function changePassword({ currentPassword, newPassword, confirmPassword }) {
  const res = await apiFetch('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to change password');
  }
  return data;
}

export async function deleteAccount() {
  const res = await apiFetch('/auth/me', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: true }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to delete account');
  }
  return data;
}

export async function checkUsernameAvailability(username) {
  try {
    const res = await apiFetch(`/auth/check-username?username=${encodeURIComponent(username || '')}`);
    if (!res.ok) {
      return { available: false, valid: false, message: 'Could not verify username' };
    }
    return await res.json();
  } catch (err) {
    return { available: false, valid: false, message: 'Connection error' };
  }
}

export async function getDashboardBootstrap({
  subjectId = null,
  days = 7,
  orderMode = 'syllabus'
} = {}) {
  const params = new URLSearchParams();
  if (subjectId) params.append('subject_id', subjectId);
  if (days) params.append('days', String(days));
  if (orderMode) params.append('order_mode', orderMode);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/dashboard/bootstrap${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to load dashboard bootstrap');
  }
  return res.json();
}

/**
 * Lightweight background warm-up request fired as soon as the app shell loads.
 * Completely non-blocking; wakes up sleeping Render free-tier instance early.
 */
export function wakeBackendServer() {
  try {
    const base = getApiBase().replace(/\/api$/, '');
    const healthUrl = `${base}/health`;
    fetch(healthUrl, { method: 'GET', keepalive: true, credentials: 'omit' }).catch(() => {});
  } catch {}
}

export async function getDashboardSummary({
  subjectId = null,
  days = 7,
  orderMode = 'syllabus',
  scopeChapterId = null,
  chapterForRelations = null
} = {}) {
  const params = new URLSearchParams();
  if (subjectId) params.append('subject_id', subjectId);
  if (days) params.append('days', String(days));
  if (orderMode) params.append('order_mode', orderMode);
  if (scopeChapterId) params.append('scope_chapter_id', scopeChapterId);
  if (chapterForRelations) params.append('chapter_for_relations', chapterForRelations);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/dashboard/summary${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to load dashboard summary');
  }
  return res.json();
}

export async function renameDocument(docId, newFilename) {
  const res = await apiFetch(`/documents/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ filename: newFilename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to rename document');
  }
  return res.json();
}

export async function getPlannerOverview(subjectId = null) {
  const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : '';
  const res = await apiFetch(`/planner/overview${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to load planner overview');
  }
  return res.json();
}

export async function updateChapterProgress(chapterId, status) {
  const res = await apiFetch(`/chapters/${encodeURIComponent(chapterId)}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ status: Number(status) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update chapter progress');
  }
  return res.json();
}

export async function updateChapterMeta(chapterId, { difficulty, est_hours }) {
  const body = {};
  if (difficulty !== undefined) body.difficulty = Number(difficulty);
  if (est_hours !== undefined) body.est_hours = Number(est_hours);
  const res = await apiFetch(`/chapters/${encodeURIComponent(chapterId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update chapter details');
  }
  return res.json();
}

export async function getChapterRelations(chapterId) {
  const res = await apiFetch(`/chapters/${encodeURIComponent(chapterId)}/relations`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to load chapter topic relations');
  }
  return res.json();
}

export async function previewStudyPlan({ subject_id, days, order_mode = 'syllabus', scope_chapter_id = null, start_date = null }) {
  const res = await apiFetch('/plans/preview', {
    method: 'POST',
    body: JSON.stringify({
      subject_id,
      days: Number(days),
      order_mode,
      scope_chapter_id: scope_chapter_id || null,
      start_date,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate plan preview');
  }
  return res.json();
}

export async function createStudyPlan({ subject_id, days, order_mode = 'syllabus', scope_chapter_id = null, start_date = null }) {
  const res = await apiFetch('/plans', {
    method: 'POST',
    body: JSON.stringify({
      subject_id,
      days: Number(days),
      order_mode,
      scope_chapter_id: scope_chapter_id || null,
      start_date,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to save study plan');
  }
  return res.json();
}

export async function getActiveStudyPlan(subjectId) {
  const res = await apiFetch(`/plans/active?subject_id=${encodeURIComponent(subjectId)}`);
  if (!res.ok) {
    return { plan: null, plan_status: null };
  }
  return res.json();
}

export async function togglePlanDay(planId, dayIndex) {
  const res = await apiFetch(`/plans/${encodeURIComponent(planId)}/days/${dayIndex}`, {
    method: 'PATCH',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to toggle day completion');
  }
  return res.json();
}

export async function resetStudyPlan(planId) {
  const res = await apiFetch(`/plans/${encodeURIComponent(planId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to reset study plan');
  }
  return res.json();
}

export async function getReminders() {
  const res = await apiFetch('/reminders');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to load reminders');
  }
  return res.json();
}

export async function createReminder({ time, weekdays = [0, 1, 2, 3, 4, 5, 6], label = 'Study Session', enabled = true }) {
  const res = await apiFetch('/reminders', {
    method: 'POST',
    body: JSON.stringify({
      time,
      weekdays,
      label,
      enabled,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create reminder');
  }
  return res.json();
}

export async function updateReminder(id, data) {
  const res = await apiFetch(`/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update reminder');
  }
  return res.json();
}

export async function deleteReminder(id) {
  const res = await apiFetch(`/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete reminder');
  }
  return res.json();
}

// ==================== Personal Notes API ====================

export async function listNotes({
  search = '',
  tag = '',
  pinned = null,
  document_id = '',
  page = 1,
  limit = 20,
} = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (tag) params.set('tag', tag);
  if (pinned !== null && pinned !== undefined && pinned !== '') params.set('pinned', String(pinned));
  if (document_id) params.set('document_id', document_id);
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));

  const query = params.toString();
  const res = await apiFetch(`/notes${query ? `?${query}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch notes');
  }
  return res.json();
}

export async function getNote(noteId) {
  const res = await apiFetch(`/notes/${encodeURIComponent(noteId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch note');
  }
  return res.json();
}

export async function createNote(data) {
  const res = await apiFetch('/notes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create note');
  }
  return res.json();
}

export async function updateNote(noteId, data) {
  const res = await apiFetch(`/notes/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update note');
  }
  return res.json();
}

export async function deleteNote(noteId) {
  const res = await apiFetch(`/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete note');
  }
  return res.json();
}

