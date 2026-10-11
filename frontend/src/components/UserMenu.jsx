import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User, 
  KeyRound, 
  LogOut, 
  Trash2, 
  AlertTriangle, 
  Eye, 
  EyeOff,
  LayoutDashboard,
  BookOpen,
  FileText
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar, Button, Modal, Input, PaperSurface } from './ui';

export default function UserMenu({ onToast }) {
  const { 
    user, 
    signOut, 
    updateProfile, 
    updatePassword, 
    removeAccount 
  } = useAuth();

  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'profile' | 'password' | 'delete' | null
  const menuRef = useRef(null);

  // Profile modal state
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Password modal state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Delete modal state
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!user) return null;

  const handleOpenModal = (modalName) => {
    setIsOpen(false);
    setActiveModal(modalName);
    if (modalName === 'profile') {
      setDisplayName(user.display_name || '');
      setProfileError('');
    } else if (modalName === 'password') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
    } else if (modalName === 'delete') {
      setDeleteConfirmText('');
      setDeleteError('');
    }
  };

  const handleCloseModal = () => {
    setActiveModal(null);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setProfileError('Display name cannot be empty.');
      return;
    }
    setProfileLoading(true);
    setProfileError('');
    try {
      await updateProfile({ displayName: displayName.trim() });
      if (onToast) onToast('Profile updated successfully!', 'success');
      handleCloseModal();
    } catch (err) {
      setProfileError(err.message || 'Failed to update profile.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleSavePassword = async (e) => {
    e.preventDefault();
    if (!currentPassword) {
      setPasswordError('Current password is required.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordLoading(true);
    setPasswordError('');
    try {
      await updatePassword(currentPassword, newPassword, confirmPassword);
      if (onToast) onToast('Password changed successfully!', 'success');
      handleCloseModal();
    } catch (err) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') {
      setDeleteError('Please type DELETE to confirm.');
      return;
    }
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await removeAccount();
      navigate('/');
      if (onToast) onToast('Your account and private notes have been deleted.', 'info');
      handleCloseModal();
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete account.');
      setDeleteLoading(false);
    }
  };

  return (
    <div className="user-menu-wrap" ref={menuRef}>
      {/* Small Avatar Button */}
      <button
        type="button"
        className="user-avatar-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`${user.name || user.display_name} user menu`}
      >
        <Avatar name={user.name || user.display_name} src={user.avatar || user.avatar_url} size={34} />
      </button>

      {isOpen && (
        <div className="user-dropdown-panel shadow-md" role="menu" aria-label="Account menu">
          <div className="user-dropdown-header">
            <span className="user-dropdown-eyebrow">YOUR ACCOUNT</span>
            <div className="user-dropdown-identity">
              <Avatar name={user.name || user.display_name} src={user.avatar || user.avatar_url} size={46} className="user-dropdown-avatar" />
              <div className="user-dropdown-details">
                <span className="user-name">{user.name || user.display_name}</span>
                <span className="user-username">@{user.username}</span>
              </div>
            </div>
          </div>

          <div className="user-dropdown-section-label">STUDY & WORKSPACE</div>

          <button
            type="button"
            className="user-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              navigate('/');
            }}
            role="menuitem"
          >
            <span className="user-dropdown-item-icon"><LayoutDashboard size={17} strokeWidth={1.75} /></span>
            <span className="user-dropdown-item-copy">
              <span className="user-dropdown-item-title">Dashboard</span>
              <span className="user-dropdown-item-description">{user?.role === 'teacher' ? 'Instructor Portal' : 'Study planner & uploads'}</span>
            </span>
          </button>

          <button
            type="button"
            className="user-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              navigate('/notes');
            }}
            role="menuitem"
          >
            <span className="user-dropdown-item-icon"><FileText size={17} strokeWidth={1.75} /></span>
            <span className="user-dropdown-item-copy">
              <span className="user-dropdown-item-title">Personal Notes</span>
              <span className="user-dropdown-item-description">Private study notebook</span>
            </span>
          </button>

          <div className="user-dropdown-divider" />

          <div className="user-dropdown-section-label">ACCOUNT SETTINGS</div>

          <button
            type="button"
            className="user-dropdown-item"
            onClick={() => handleOpenModal('profile')}
            role="menuitem"
          >
            <span className="user-dropdown-item-icon"><User size={17} strokeWidth={1.75} /></span>
            <span className="user-dropdown-item-copy">
              <span className="user-dropdown-item-title">Profile</span>
              <span className="user-dropdown-item-description">Manage your details</span>
            </span>
          </button>

          <button
            type="button"
            className="user-dropdown-item"
            onClick={() => handleOpenModal('password')}
            role="menuitem"
          >
            <span className="user-dropdown-item-icon"><KeyRound size={17} strokeWidth={1.75} /></span>
            <span className="user-dropdown-item-copy">
              <span className="user-dropdown-item-title">Change password</span>
              <span className="user-dropdown-item-description">Keep your account secure</span>
            </span>
          </button>

          <div className="user-dropdown-divider" />

          <button
            type="button"
            className="user-dropdown-item user-dropdown-logout"
            onClick={() => {
              setIsOpen(false);
              signOut();
              navigate('/');
              if (onToast) onToast('Signed out of workspace.', 'info');
            }}
            role="menuitem"
          >
            <span className="user-dropdown-item-icon"><LogOut size={17} strokeWidth={1.75} /></span>
            <span className="user-dropdown-item-copy">
              <span className="user-dropdown-item-title">Log out</span>
              <span className="user-dropdown-item-description">Sign out of this workspace</span>
            </span>
          </button>

          <button
            type="button"
            className="user-dropdown-item user-dropdown-delete"
            onClick={() => handleOpenModal('delete')}
            role="menuitem"
          >
            <span className="user-dropdown-item-icon"><Trash2 size={17} strokeWidth={1.75} /></span>
            <span className="user-dropdown-item-copy">
              <span className="user-dropdown-item-title">Delete account</span>
              <span className="user-dropdown-item-description">Permanently remove your account</span>
            </span>
          </button>
        </div>
      )}

      {/* Edit Profile Modal */}
      <Modal
        isOpen={activeModal === 'profile'}
        onClose={handleCloseModal}
        title="Edit Profile"
        maxWidth="440px"
      >
        <PaperSurface className="user-modal-paper">
          <form onSubmit={handleSaveProfile} className="modal-form-vertical">
            <Input
              label="Username"
              type="text"
              value={user.username}
              disabled
              helper="Your username cannot be changed."
            />

            <Input
              label="Display Name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={profileLoading}
              required
            />

            {profileError && <div className="modal-form-error">{profileError}</div>}

            <div className="modal-form-actions">
              <Button variant="secondary" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={profileLoading}>
                Save changes
              </Button>
            </div>
          </form>
        </PaperSurface>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        isOpen={activeModal === 'password'}
        onClose={handleCloseModal}
        title="Change Password"
        maxWidth="440px"
      >
        <PaperSurface className="user-modal-paper">
          <form onSubmit={handleSavePassword} className="modal-form-vertical">
            <div className="password-input-wrap">
              <Input
                label="Current Password"
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={passwordLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                className="password-toggle-eye"
                aria-label={showCurrentPw ? 'Hide password' : 'Show password'}
              >
                {showCurrentPw ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              </button>
            </div>

            <div className="password-input-wrap">
              <Input
                label="New Password"
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
                helper="Must be at least 8 characters long."
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                className="password-toggle-eye"
                aria-label={showNewPw ? 'Hide password' : 'Show password'}
              >
                {showNewPw ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              </button>
            </div>

            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={passwordLoading}
              required
            />

            {passwordError && <div className="modal-form-error">{passwordError}</div>}

            <div className="modal-form-actions">
              <Button variant="secondary" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={passwordLoading}>
                Update password
              </Button>
            </div>
          </form>
        </PaperSurface>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={activeModal === 'delete'}
        onClose={handleCloseModal}
        title="Delete Account"
        maxWidth="440px"
      >
        <PaperSurface className="user-modal-paper">
          <form onSubmit={handleDeleteAccount} className="modal-form-vertical">
            <div className="delete-warning-box">
              <AlertTriangle size={24} strokeWidth={2} className="warning-icon" />
              <div>
                <strong style={{ display: 'block', marginBottom: 4 }}>This action cannot be undone</strong>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  All your uploaded documents, extracted concepts, and workspace data will be permanently deleted.
                </p>
              </div>
            </div>

            <Input
              label='Type "DELETE" to confirm'
              type="text"
              placeholder="DELETE"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleteLoading}
              required
            />

            {deleteError && <div className="modal-form-error">{deleteError}</div>}

            <div className="modal-form-actions">
              <Button variant="secondary" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button
                variant="danger"
                type="submit"
                loading={deleteLoading}
                disabled={deleteConfirmText.trim().toLowerCase() !== 'delete'}
              >
                Permanently delete
              </Button>
            </div>
          </form>
        </PaperSurface>
      </Modal>
    </div>
  );
}
