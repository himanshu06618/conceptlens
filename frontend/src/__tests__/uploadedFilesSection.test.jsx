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
    expect(screen.getByText('14')).toBeTruthy();
    expect(screen.getByText('22')).toBeTruthy();
    expect(screen.getByText('12p')).toBeTruthy();
    expect(screen.getByText('18p')).toBeTruthy();
  });

  it('marks active file with "Viewing" badge and allows 1-click switching by clicking file card', () => {
    const handleSelect = vi.fn();
    render(
      <UploadedFilesSection
        documents={mockDocs}
        activeDocId="doc-1"
        onSelectDoc={handleSelect}
      />
    );

    // Active document shows "Viewing" badge
    expect(screen.getByText('Viewing')).toBeTruthy();

    // Click on card for doc-2 to switch
    const card2 = screen.getByTitle(/click to switch to "database_normalization_notes\.pdf"/i);
    fireEvent.click(card2);
    expect(handleSelect).toHaveBeenCalledWith('doc-2');
  });

  it('shows compact inline confirmation prompt before deleting and calls onDeleteDoc on confirm', () => {
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

    // Inline confirmation box is shown with "Delete file?"
    expect(screen.getByText(/delete file\?/i)).toBeTruthy();

    // Clicking cancel dismisses confirmation without calling onDeleteDoc
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(handleDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete file\?/i)).toBeNull();

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
