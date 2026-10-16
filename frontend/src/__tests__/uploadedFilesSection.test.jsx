import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UploadedFilesSection from '../components/planner/UploadedFilesSection';

const mockDocs = [
  {
    id: 'doc-1',
    filename: 'Operating_Systems_Chapter1.pdf',
    file_type: 'pdf',
    status: 'completed',
    concept_count: 14,
    page_count: 12,
    created_at: '2026-10-15T10:30:00Z'
  },
  {
    id: 'doc-2',
    filename: 'Database_Normalization_Notes.pdf',
    file_type: 'pdf',
    status: 'completed',
    concept_count: 22,
    page_count: 18,
    created_at: '2026-10-16T14:20:00Z'
  }
];

describe('UploadedFilesSection Component', () => {
  it('renders empty state when no files are uploaded', () => {
    render(<UploadedFilesSection documents={[]} />);
    expect(screen.getByText(/no files uploaded yet/i)).toBeTruthy();
    expect(screen.getByText(/0 files/i)).toBeTruthy();
  });

  it('renders all uploaded files with filenames, concepts count, and page count', () => {
    render(
      <UploadedFilesSection
        documents={mockDocs}
        activeDocId="doc-1"
      />
    );

    expect(screen.getByText('Operating_Systems_Chapter1.pdf')).toBeTruthy();
    expect(screen.getByText('Database_Normalization_Notes.pdf')).toBeTruthy();
    expect(screen.getByText(/14 concepts/i)).toBeTruthy();
    expect(screen.getByText(/22 concepts/i)).toBeTruthy();
    expect(screen.getByText(/12 pages/i)).toBeTruthy();
    expect(screen.getByText(/18 pages/i)).toBeTruthy();
  });

  it('displays the quick switcher bar when user has 2 or more uploaded files', () => {
    render(
      <UploadedFilesSection
        documents={mockDocs}
        activeDocId="doc-1"
      />
    );

    expect(screen.getByRole('toolbar', { name: /quick file switcher/i })).toBeTruthy();
    expect(screen.getByTitle(/switch to operating_systems_chapter1\.pdf/i)).toBeTruthy();
    expect(screen.getByTitle(/switch to database_normalization_notes\.pdf/i)).toBeTruthy();
  });

  it('marks active file with "Viewing Now" and allows switching via pill or button', () => {
    const handleSelect = vi.fn();
    render(
      <UploadedFilesSection
        documents={mockDocs}
        activeDocId="doc-1"
        onSelectDoc={handleSelect}
      />
    );

    // Active document shows "Viewing Now"
    expect(screen.getByText('Currently Viewing')).toBeTruthy();
    expect(screen.getByText('Viewing Now')).toBeTruthy();

    // Click quick switch pill for doc-2
    const switchPill2 = screen.getByTitle(/switch to database_normalization_notes\.pdf/i);
    fireEvent.click(switchPill2);
    expect(handleSelect).toHaveBeenCalledWith('doc-2');

    // Click "Switch to this file" card button for doc-2
    const switchCardBtn = screen.getByLabelText(/switch to database_normalization_notes\.pdf and view concepts/i);
    fireEvent.click(switchCardBtn);
    expect(handleSelect).toHaveBeenCalledWith('doc-2');
  });

  it('shows inline confirmation prompt before deleting and calls onDeleteDoc on confirm', () => {
    const handleDelete = vi.fn();
    render(
      <UploadedFilesSection
        documents={mockDocs}
        activeDocId="doc-1"
        onDeleteDoc={handleDelete}
      />
    );

    // Click delete button for doc-2
    const deleteBtn = screen.getByLabelText(/delete "database_normalization_notes\.pdf"/i);
    fireEvent.click(deleteBtn);

    // Inline confirmation box is shown
    expect(screen.getByText(/delete this file and all its extracted concepts\?/i)).toBeTruthy();

    // Clicking cancel dismisses confirmation without calling onDeleteDoc
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(handleDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete this file and all its extracted concepts\?/i)).toBeNull();

    // Click delete again, then click Confirm Delete
    const deleteBtnAgain = screen.getByLabelText(/delete "database_normalization_notes\.pdf"/i);
    fireEvent.click(deleteBtnAgain);
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(confirmBtn);

    expect(handleDelete).toHaveBeenCalledWith('doc-2');
  });

  it('filters uploaded files by search query', () => {
    const threeDocs = [
      ...mockDocs,
      {
        id: 'doc-3',
        filename: 'Compiler_Design_Lecture3.pdf',
        file_type: 'pdf',
        status: 'completed',
        concept_count: 8,
        page_count: 6,
        created_at: '2026-10-17T01:00:00Z'
      }
    ];

    render(<UploadedFilesSection documents={threeDocs} activeDocId="doc-1" />);

    const searchInput = screen.getByLabelText(/search uploaded files/i);
    fireEvent.change(searchInput, { target: { value: 'compiler' } });

    expect(screen.getByText('Compiler_Design_Lecture3.pdf')).toBeTruthy();
    expect(screen.queryByText('Operating_Systems_Chapter1.pdf')).toBeNull();
    expect(screen.queryByText('Database_Normalization_Notes.pdf')).toBeNull();
  });
});
