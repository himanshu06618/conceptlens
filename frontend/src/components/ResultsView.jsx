import React from 'react';
import UnifiedResultsPanel from './results/UnifiedResultsPanel';

export default function ResultsView({
  documentData,
  concepts = [],
  topics = [],
  documents = [],
  onSelectDoc,
  isLoading = false,
  isAuthenticated = false,
  onRefresh,
  onNewUpload,
  onDeleteDoc,
  onToast
}) {
  return (
    <div className="results-view-outer-wrapper">
      <UnifiedResultsPanel
        documentData={documentData}
        concepts={concepts}
        topics={topics}
        documents={documents}
        onSelectDoc={onSelectDoc}
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        onDeleteDocument={onDeleteDoc}
        onClose={onNewUpload}
        onProgressChange={onRefresh}
        onToast={onToast}
      />
    </div>
  );
}
