import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getCurrentUser,
  loginUser,
  registerUser,
  googleLogin,
  logoutUser,
  updateUserProfile,
  changePassword,
  deleteAccount
} from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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

  // Restore session on mount
  useEffect(() => {
    let isMounted = true;
    const restoreSession = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (isMounted) {
          setUser(currentUser);
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    restoreSession();

    // Listen for unauthorized events from apiFetch (expired sessions)
    const handleUnauthorized = () => {
      setUser(null);
      openAuthModal('signin', 'Your session expired, please sign in again.');
    };

    window.addEventListener('conceptlens:unauthorized', handleUnauthorized);
    return () => {
      isMounted = false;
      window.removeEventListener('conceptlens:unauthorized', handleUnauthorized);
    };
  }, [openAuthModal]);

  const signIn = async (username, password) => {
    const userData = await loginUser({ username, password });
    setUser(userData);
    closeAuthModal();
    return userData;
  };

  const signUp = async (formData) => {
    const userData = await registerUser(formData);
    setUser(userData);
    closeAuthModal();
    return userData;
  };

  const signInWithGoogle = async (credential) => {
    const userData = await googleLogin(credential);
    setUser(userData);
    closeAuthModal();
    return userData;
  };

  const signOut = async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.warn('Sign out request failed:', e);
    } finally {
      setUser(null);
    }
  };

  const updateProfile = async (displayName) => {
    const updated = await updateUserProfile(displayName);
    setUser(updated);
    return updated;
  };

  const updatePassword = async (currentPassword, newPassword, confirmPassword) => {
    return await changePassword({ currentPassword, newPassword, confirmPassword });
  };

  const removeAccount = async () => {
    await deleteAccount();
    setUser(null);
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
