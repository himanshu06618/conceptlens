import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getCurrentUser,
  loginUser,
  registerUser,
  googleLogin,
  setUserRole,
  logoutUser,
  updateUserProfile,
  changePassword,
  deleteAccount
} from '../api/client';

import { clearAllDashboardCaches } from '../utils/dashboardCache';

export const AuthContext = createContext(null);

function getInitialUser() {
  try {
    const raw = localStorage.getItem('conceptlens_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getInitialUser);
  const [loading, setLoading] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState('signin'); // 'signin' | 'signup'
  const [authModalPrompt, setAuthModalPrompt] = useState('');

  const openAuthModal = useCallback((tab = 'signin', prompt = '') => {
    setAuthModalTab(tab);
    setAuthModalPrompt(prompt);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setAuthModalPrompt('');
  }, []);

  // Restore and verify session on mount in the background without blocking first paint
  useEffect(() => {
    let isMounted = true;
    const restoreSession = async () => {
      // If no token or user was stored, no session to restore
      const token = localStorage.getItem('conceptlens_token');
      const storedUser = localStorage.getItem('conceptlens_user');
      if (!token && !storedUser) {
        return;
      }

      try {
        const currentUser = await getCurrentUser();
        if (isMounted && currentUser) {
          setUser(currentUser);
          try {
            localStorage.setItem('conceptlens_user', JSON.stringify({
              id: currentUser.id,
              username: currentUser.username,
              display_name: currentUser.display_name,
              role: currentUser.role || 'student',
              email: currentUser.email,
              avatar_url: currentUser.avatar_url,
              created_at: currentUser.created_at,
              last_login_at: currentUser.last_login_at
            }));
          } catch {}
        }
      } catch (err) {
        // Session invalid or expired: clear cached session and IndexedDB cache
        if (isMounted) {
          console.warn('Session verification failed, resetting auth state:', err);
          setUser(null);
          try {
            localStorage.removeItem('conceptlens_user');
            localStorage.removeItem('conceptlens_token');
            clearAllDashboardCaches();
          } catch {}
        }
      }
    };
    restoreSession();

    // Listen for unauthorized events from apiFetch (expired sessions)
    const handleUnauthorized = () => {
      setUser(null);
      try {
        localStorage.removeItem('conceptlens_user');
        localStorage.removeItem('conceptlens_token');
        clearAllDashboardCaches();
      } catch {}
      openAuthModal('signin', 'Your session expired, please sign in again.');
    };

    window.addEventListener('conceptlens:unauthorized', handleUnauthorized);
    return () => {
      isMounted = false;
      window.removeEventListener('conceptlens:unauthorized', handleUnauthorized);
    };
  }, [openAuthModal]);

  const saveUserSession = (userData) => {
    if (!userData) return;
    try {
      localStorage.setItem('conceptlens_user', JSON.stringify({
        id: userData.id,
        username: userData.username,
        display_name: userData.display_name,
        role: userData.role || 'student',
        email: userData.email,
        avatar_url: userData.avatar_url,
        created_at: userData.created_at,
        last_login_at: userData.last_login_at
      }));
    } catch {}
  };

  const signIn = async (usernameOrEmail, password) => {
    const isEmail = usernameOrEmail && usernameOrEmail.includes('@');
    const res = await loginUser({
      email: isEmail ? usernameOrEmail : undefined,
      username: !isEmail ? usernameOrEmail : undefined,
      password,
    });
    const finalUser = res.user || res;
    setUser(finalUser);
    saveUserSession(finalUser);
    return res;
  };

  const signUp = async (formData) => {
    const res = await registerUser(formData);
    const finalUser = res.user || res;
    setUser(finalUser);
    saveUserSession(finalUser);
    return res;
  };

  const signInWithGoogle = async (credential) => {
    const res = await googleLogin(credential);
    const finalUser = res.user || res;
    setUser(finalUser);
    saveUserSession(finalUser);
    return res;
  };

  const setRole = async (role) => {
    const res = await setUserRole(role);
    const updatedUser = res.user || res;
    setUser((prev) => {
      const merged = { ...(prev || {}), ...updatedUser, role };
      saveUserSession(merged);
      return merged;
    });
    return res;
  };

  const signOut = async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.warn('Sign out request failed:', e);
    } finally {
      localStorage.removeItem('conceptlens_token');
      localStorage.removeItem('conceptlens_user');
      setUser(null);
      await clearAllDashboardCaches();
    }
  };

  const updateProfile = async (displayName) => {
    const updated = await updateUserProfile(displayName);
    setUser(updated);
    saveUserSession(updated);
    return updated;
  };

  const updatePassword = async (currentPassword, newPassword, confirmPassword) => {
    return await changePassword({ currentPassword, newPassword, confirmPassword });
  };

  const removeAccount = async () => {
    await deleteAccount();
    localStorage.removeItem('conceptlens_token');
    localStorage.removeItem('conceptlens_user');
    setUser(null);
    await clearAllDashboardCaches();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        signIn,
        signUp,
        signInWithGoogle,
        setRole,
        signOut,
        updateProfile,
        updatePassword,
        removeAccount,
        authModalOpen,
        authModalTab,
        authModalPrompt,
        setAuthModalTab,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
