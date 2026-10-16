import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NavSidebar from '../components/NavSidebar';

// Mock AuthContext
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Himanshu', role: 'student' },
    isAuthenticated: true,
    openAuthModal: vi.fn(),
    signOut: vi.fn()
  })
}));

// Mock API client
vi.mock('../api/client', () => ({
  getReminders: vi.fn().mockResolvedValue({ reminders: [] }),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn()
}));

describe('NavSidebar Navigation and Study Space', () => {
  it('renders Dashboard, Study Route Planner, and Personal Notes navigation items', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavSidebar isOpen={true} onClose={() => {}} onToast={() => {}} />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to study route planner/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to personal notes/i })).toBeTruthy();
  });

  it('renders the Study Routine & Study Reminder section within the sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavSidebar isOpen={true} onClose={() => {}} onToast={() => {}} />
      </MemoryRouter>
    );

    expect(screen.getByText('Study Routine')).toBeTruthy();
    expect(screen.getByText('Study Reminder')).toBeTruthy();
    expect(screen.getByText('Set Study Reminder')).toBeTruthy();
  });
});
