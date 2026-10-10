const getApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE;
  if (envUrl && typeof envUrl === 'string') {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  // In development with Vite proxy, use relative '/api'
  if (import.meta.env.DEV) {
    return '/api';
  }
  // Default fallback to local backend
  return 'http://localhost:8000/api';
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
    // Only dispatch session expired event for expired session requests (not login/register/initial check)
    if (!endpoint.includes('/auth/login') && !endpoint.includes('/auth/register') && !endpoint.includes('/auth/me')) {
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

export async function uploadDocument(file, { password = null, mode = null } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (password) {
    formData.append('pdf_password', password);
  }
  if (mode) {
    formData.append('extraction_mode', mode);
  }

  const res = await apiFetch('/documents', {
    method: 'POST',
    body: formData,
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

export async function getDocumentFlowchart(docId, { topic = '', subflow = 0, includeRelated = false } = {}) {
  const params = new URLSearchParams();
  if (topic) params.set('topic', topic);
  if (subflow) params.set('subflow', String(subflow));
  if (includeRelated) params.set('include_related', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/documents/${docId}/flowchart${query}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to load flowchart');
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

export async function checkBackendHealth() {
  try {
    const res = await apiFetch('/health');
    return res.ok;
  } catch {
    return false;
  }
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

export async function updateUserProfile(displayName) {
  const res = await apiFetch('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
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

// ==================== Study Planner API ====================

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
