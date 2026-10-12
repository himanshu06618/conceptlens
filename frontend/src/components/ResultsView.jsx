import React from 'react';
import UnifiedResultsPanel from './results/UnifiedResultsPanel';

export default function ResultsView({
  documentData,
  concepts = [],
  topics = [],
  isLoading = false,
  isAuthenticated = false,
  onRefresh,
  onNewUpload,
  onDeleteDoc
}) {
  return (
    <div className="results-view-outer-wrapper">
      <UnifiedResultsPanel
        documentData={documentData}
        concepts={concepts}
        topics={topics}
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        onDeleteDocument={onDeleteDoc}
        onClose={onNewUpload}
        onProgressChange={onRefresh}
      />
    </div>
  );
}
