import React from 'react';
import UnifiedResultsPanel from '../results/UnifiedResultsPanel';

export default function DashboardResultsPanel(props) {
  return (
    <UnifiedResultsPanel
      {...props}
      isAuthenticated={true}
    />
  );
}
