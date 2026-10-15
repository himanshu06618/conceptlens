import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getDisplayName, getUserHandle, getInitials } from '../utils/userUtils';
import Avatar from '../components/ui/Avatar';
import UserMenu from '../components/UserMenu';
import { ErrorBoundary } from '../main';
import { AuthContext } from '../context/AuthContext';
import { MemoryRouter } from 'react-router-dom';

// Mock test user profiles
const testUsers = {
  emailUserWithName: {
    id: 'u1',
    name: 'Alice Henderson',
    email: 'alice.h@university.edu',
    username: 'alice_h',
    role: 'student',
  },
  googleUser: {
    id: 'u2',
    name: 'Bob Googleton',
    email: 'bob.googleton@gmail.com',
    avatar: 'https://lh3.googleusercontent.com/test-bob.jpg',
    role: 'student',
  },
  userWithoutName: {
    id: 'u3',
    email: 'quantum_coder@lab.org',
    role: 'student',
  },
  userWithOnlyUsername: {
    id: 'u4',
    username: 'cyber_scholar_42',
    role: 'student',
  },
  guestUser: null,
};

describe('User Display Helpers (userUtils.js)', () => {
  it('correctly resolves display name for all 5 user profiles', () => {
    // 1. Email user with full name
    expect(getDisplayName(testUsers.emailUserWithName)).toBe('Alice Henderson');

    // 2. Google user with name
    expect(getDisplayName(testUsers.googleUser)).toBe('Bob Googleton');

    // 3. User with email only (missing name & username)
    expect(getDisplayName(testUsers.userWithoutName)).toBe('quantum_coder');

    // 4. User with username only (missing name & email)
    expect(getDisplayName(testUsers.userWithOnlyUsername)).toBe('cyber_scholar_42');

    // 5. Guest user (null or undefined)
    expect(getDisplayName(testUsers.guestUser)).toBe('Guest');
    expect(getDisplayName(undefined)).toBe('Guest');
    expect(getDisplayName({})).toBe('Guest');
  });

  it('correctly resolves user handle without throwing', () => {
    expect(getUserHandle(testUsers.emailUserWithName)).toBe('@alice_h');
    expect(getUserHandle(testUsers.googleUser)).toBe('@bob.googleton');
    expect(getUserHandle(testUsers.userWithoutName)).toBe('@quantum_coder');
    expect(getUserHandle(testUsers.userWithOnlyUsername)).toBe('@cyber_scholar_42');
    expect(getUserHandle(testUsers.guestUser)).toBe('');
    expect(getUserHandle(null)).toBe('');
  });

  it('generates initials safely without throwing on empty or corrupted inputs', () => {
    expect(getInitials('Alice Henderson')).toBe('AH');
    expect(getInitials('Bob')).toBe('BO');
    expect(getInitials(testUsers.emailUserWithName)).toBe('AH');
    expect(getInitials(testUsers.googleUser)).toBe('BG');
    expect(getInitials(testUsers.userWithoutName)).toBe('QU');
    expect(getInitials(testUsers.userWithOnlyUsername)).toBe('CY');
    expect(getInitials(null)).toBe('CL');
    expect(getInitials('')).toBe('CL');
    expect(getInitials(undefined)).toBe('CL');
  });
});

describe('Avatar Component', () => {
  it('renders correctly for each user type without crashing', () => {
    // 1. Email user
    const { rerender } = render(<Avatar name={testUsers.emailUserWithName} size={36} />);
    expect(screen.getByText('AH')).toBeTruthy();

    // 2. Google user with image
    rerender(<Avatar name={testUsers.googleUser} src={testUsers.googleUser.avatar} size={36} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe(testUsers.googleUser.avatar);

    // 3. User without name
    rerender(<Avatar name={testUsers.userWithoutName} size={36} />);
    expect(screen.getByText('QU')).toBeTruthy();

    // 4. User with only username
    rerender(<Avatar name={testUsers.userWithOnlyUsername} size={36} />);
    expect(screen.getByText('CY')).toBeTruthy();

    // 5. Guest
    rerender(<Avatar name={null} size={36} />);
    expect(screen.getByText('CL')).toBeTruthy();
  });
});

describe('UserMenu Component and Overlays', () => {
  const mockAuthContext = (user) => ({
    user,
    isAuthenticated: Boolean(user),
    signOut: vi.fn(),
    updateProfile: vi.fn().mockResolvedValue({ ...user, display_name: 'Updated Name' }),
    updatePassword: vi.fn().mockResolvedValue(true),
    removeAccount: vi.fn().mockResolvedValue(true),
  });

  const renderUserMenu = (user, onToast = vi.fn()) => {
    return render(
      <AuthContext.Provider value={mockAuthContext(user)}>
        <MemoryRouter>
          <UserMenu onToast={onToast} />
        </MemoryRouter>
      </AuthContext.Provider>
    );
  };

    it('renders null when user is guest or not authenticated', () => {
      const { container } = renderUserMenu(null);
      expect(container.firstChild).toBeNull();
    });

    Object.entries(testUsers).forEach(([userType, userObj]) => {
      if (!userObj) return;

      it(`renders menu button and opens dropdown menu for ${userType}`, async () => {
        renderUserMenu(userObj);

        const triggerBtn = screen.getByRole('button', { name: /user menu/i });
        expect(triggerBtn).toBeTruthy();

        // Open dropdown
        fireEvent.click(triggerBtn);

        // Verify dropdown content opens
        const profileItem = await screen.findByRole('menuitem', { name: /profile/i });
        expect(profileItem).toBeTruthy();

        // Open Edit Profile modal overlay
        fireEvent.click(profileItem);

        // Verify Edit Profile modal is rendered
        const saveBtn = await screen.findByRole('button', { name: /save changes/i });
        expect(saveBtn).toBeTruthy();

        // Verify display name input exists and is safe
        const displayNameInput = screen.getByLabelText(/display name/i);
        expect(displayNameInput).toBeTruthy();

        // Close modal
        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        fireEvent.click(cancelBtn);

        await waitFor(() => {
          expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
        });
      });
    });

    it('allows opening and closing the change password modal', async () => {
      renderUserMenu(testUsers.emailUserWithName);

      const triggerBtn = screen.getByRole('button', { name: /user menu/i });
      fireEvent.click(triggerBtn);

      const pwItem = await screen.findByRole('menuitem', { name: /change password/i });
      fireEvent.click(pwItem);

      const updatePwBtn = await screen.findByRole('button', { name: /update password/i });
      expect(updatePwBtn).toBeTruthy();

      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /update password/i })).toBeNull();
      });
    });

    it('allows opening and closing the delete account modal', async () => {
      renderUserMenu(testUsers.emailUserWithName);

      const triggerBtn = screen.getByRole('button', { name: /user menu/i });
      fireEvent.click(triggerBtn);

      const deleteItem = await screen.findByRole('menuitem', { name: /delete account/i });
      fireEvent.click(deleteItem);

      const deleteAccountBtn = await screen.findByRole('button', { name: /permanently delete/i });
      expect(deleteAccountBtn).toBeTruthy();

      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /permanently delete/i })).toBeNull();
      });
    });
  });

describe('ErrorBoundary Component', () => {
  const ThrowingComponent = ({ shouldThrow }) => {
    if (shouldThrow) {
      throw new Error('Simulated test runtime exception in ConceptLens');
    }
    return <div>Normal Content</div>;
  };

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Normal Content')).toBeTruthy();
  });

  it('catches runtime errors and renders the friendly notice card with copy details button', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock navigator.clipboard
    const mockWriteText = vi.fn().mockResolvedValue();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Verify Notice Card elements
    expect(screen.getByText('ConceptLens Notice')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload workspace/i })).toBeTruthy();

    const copyBtn = screen.getByRole('button', { name: /copy error details/i });
    expect(copyBtn).toBeTruthy();

    // Click copy button
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalled();
    });

    const copiedPayload = JSON.parse(mockWriteText.mock.calls[0][0]);
    expect(copiedPayload.error).toBe('Simulated test runtime exception in ConceptLens');
    expect(copiedPayload.name).toBe('Error');
    expect(copiedPayload.buildId).toBeDefined();
    expect(copiedPayload.timestamp).toBeDefined();

    consoleSpy.mockRestore();
  });
});
