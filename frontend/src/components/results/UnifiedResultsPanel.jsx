import React, { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import {
  List,
  GitBranch,
  Compass,
  Waypoints,
  ArrowRight,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  Download,
  Search,
  Check,
  Edit3,
  Trash2,
  RotateCw,
  X,
  BookOpen,
  Sparkles,
  Layers
} from 'lucide-react';
import { 
  getExportUrl, 
  setConceptProgress, 
  reanalyzeDocument, 
  getDocumentProgress 
} from '../../api/client';
import ConceptListView from './ConceptListView';
import ConceptDetailPanel from './ConceptDetailPanel';
import BookshelfLoader from '../ui/BookshelfLoader';
import '../../styles/results-panel.css';

// Lazy-load heavier diagram views to keep dashboard initial load fast
const ConceptTreeView = lazy(() => import('./ConceptTreeView'));
const MindMapView = lazy(() => import('./MindMapView'));
const FlowchartLearningView = lazy(() => import('./FlowchartLearningView'));
const StudyRoadmapView = lazy(() => import('./StudyRoadmapView'));

export default function UnifiedResultsPanel({
  documentData,
  concepts: initialConcepts = [],
  topics = [],
  chapterCount = 0,
  isLoading = false,
  isAuthenticated = true,
  onClose,
  onDeleteDocument,
  onRenameDocument,
  onProgressChange = () => {},
  onToast = () => {}
}) {
  // Tabs: 'concepts' | 'tree' | 'mindmap' | 'flowchart' | 'roadmap'
  const [activeTab, setActiveTab] = useState('tree');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  // Rename state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [docTitle, setDocTitle] = useState(documentData?.filename || 'Document Results');

  // Shared search & selected concept state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [learningPath, setLearningPath] = useState(null);

  // Local concepts state for optimistic updates
  const [concepts, setConcepts] = useState(initialConcepts);

  useEffect(() => {
    setConcepts(initialConcepts);
  }, [initialConcepts]);

  useEffect(() => {
    setDocTitle(documentData?.filename || 'Document Results');
  }, [documentData?.filename]);

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Rename handler
  const handleSaveTitle = () => {
    setIsEditingTitle(false);
    if (docTitle.trim() && docTitle !== documentData?.filename && onRenameDocument) {
      onRenameDocument(documentData.id, docTitle.trim());
    }
  };

  // Re-analyse document handler
  const handleReanalyze = async () => {
    if (!documentData?.id || isReanalyzing) return;
    setIsReanalyzing(true);
    onToast({
      type: 'info',
      message: 'Re-analysing document with improved Gemini extraction...'
    });

    try {
      const result = await reanalyzeDocument(documentData.id);
      if (result?.concepts) {
        setConcepts(result.concepts);
      }
      onToast({
        type: 'success',
        message: 'Re-analysis completed! High-precision concepts extracted.'
      });
      onProgressChange();
    } catch (err) {
      const msg = err.message || 'Re-analysis failed';
      if (err.status === 429 || msg.includes('quota')) {
        onToast({
          type: 'warning',
          message: 'Gemini API quota currently reached. Cached clean concepts retained.'
        });
      } else {
        onToast({
          type: 'error',
          message: msg
        });
      }
    } finally {
      setIsReanalyzing(false);
    }
  };

  // Studied toggle handler (optimistic update + server call)
  const handleToggleStudied = async (concept) => {
    if (!isAuthenticated) return;
    const currentStatus = concept.status === 'studied' ? 'studied' : 'not_started';
    const nextStatus = currentStatus === 'studied' ? 'not_started' : 'studied';

    // Optimistic UI update
    setConcepts((prev) =>
      prev.map((c) => (String(c.id) === String(concept.id) ? { ...c, status: nextStatus } : c))
    );
    if (selectedConcept && String(selectedConcept.id) === String(concept.id)) {
      setSelectedConcept((prev) => ({ ...prev, status: nextStatus }));
    }

    try {
      await setConceptProgress(concept.id, nextStatus);
      onProgressChange();
    } catch (err) {
      // Revert on error
      setConcepts((prev) =>
        prev.map((c) => (String(c.id) === String(concept.id) ? { ...c, status: currentStatus } : c))
      );
      if (selectedConcept && String(selectedConcept.id) === String(concept.id)) {
        setSelectedConcept((prev) => ({ ...prev, status: currentStatus }));
      }
      onToast({
        type: 'error',
        message: 'Could not update concept progress. Please try again.'
      });
    }
  };

  // Tab jump handler
  const handleJumpToTab = (targetTab) => {
    setActiveTab(targetTab);
  };

  const totalConceptCount = concepts.length;
  const effectiveChapterCount = chapterCount || topics.length || 1;

  if (!documentData) return null;

  return (
    <section
      className={`dashboard-results-panel unified-results-panel ${isFullscreen ? 'is-fullscreen' : ''} ${isCollapsed ? 'is-collapsed' : ''}`}
      aria-label="Extracted Course Notes Results Panel"
    >
      {/* 1. Header Bar */}
      <div className="results-panel-header">
        <div className="results-panel-title-group">
          {isEditingTitle ? (
            <div className="panel-title-edit-wrap">
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                className="panel-title-input"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveTitle}
                className="panel-title-save-btn"
                aria-label="Save document title"
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="panel-title-display-wrap">
              <h2 className="panel-doc-title" title={docTitle}>
                {docTitle}
              </h2>
              {onRenameDocument && (
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  className="panel-edit-title-btn"
                  title="Rename document"
                  aria-label="Rename document"
                >
                  <Edit3 size={14} />
                </button>
              )}
            </div>
          )}

          <div className="panel-meta-chips">
            <span className="panel-badge-lime">
              {totalConceptCount} {totalConceptCount === 1 ? 'concept' : 'concepts'}
            </span>
            <span className="panel-badge-glass">
              {effectiveChapterCount} {effectiveChapterCount === 1 ? 'chapter' : 'chapters'}
            </span>
            {documentData.file_type && (
              <span className="panel-badge-muted">
                {documentData.file_type.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Header Actions Controls */}
        <div className="results-panel-actions">
          {/* Re-analyse Action */}
          <button
            type="button"
            className="panel-action-btn reanalyze-btn"
            onClick={handleReanalyze}
            disabled={isReanalyzing}
            title="Re-analyse document (bypasses cache once)"
            aria-label="Re-analyse document with improved extraction"
          >
            <RotateCw size={14} className={isReanalyzing ? 'is-spinning' : ''} />
            <span className="hide-on-mobile">Re-analyse</span>
          </button>

          {/* Export Dropdown */}
          <div className="panel-export-wrap">
            <button
              type="button"
              className="panel-action-btn"
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              aria-expanded={isExportMenuOpen}
              title="Export document results"
            >
              <Download size={15} />
              <span className="hide-on-mobile">Export</span>
              <ChevronDown size={13} />
            </button>

            {isExportMenuOpen && (
              <>
                <div
                  className="dropdown-scrim"
                  onClick={() => setIsExportMenuOpen(false)}
                />
                <div className="panel-export-menu" role="menu">
                  <a
                    href={getExportUrl(documentData.id, 'markdown')}
                    download
                    className="export-menu-item"
                    onClick={() => setIsExportMenuOpen(false)}
                    role="menuitem"
                  >
                    <strong>Study Guide (Markdown)</strong>
                    <span>Full notes & prerequisites</span>
                  </a>
                  <a
                    href={getExportUrl(documentData.id, 'json')}
                    download
                    className="export-menu-item"
                    onClick={() => setIsExportMenuOpen(false)}
                    role="menuitem"
                  >
                    <strong>JSON Data</strong>
                    <span>Cleaned concepts, DAG relations</span>
                  </a>
                  <a
                    href={getExportUrl(documentData.id, 'csv')}
                    download
                    className="export-menu-item"
                    onClick={() => setIsExportMenuOpen(false)}
                    role="menuitem"
                  >
                    <strong>CSV Spreadsheet</strong>
                    <span>Tabular concept list & times</span>
                  </a>
                  <div className="export-menu-divider" />
                  <div className="export-menu-notice">
                    Diagram views can also be printed or captured using browser fullscreen.
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="panel-action-btn"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? 'Exit fullscreen' : 'View diagram in fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'View diagram in fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* Collapse Toggle */}
          <button
            type="button"
            className="panel-action-btn"
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? 'Expand results panel' : 'Collapse results panel'}
            aria-label={isCollapsed ? 'Expand results panel' : 'Collapse results panel'}
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>

          {/* Delete Document Button */}
          {onDeleteDocument && (
            <button
              type="button"
              className="panel-action-btn panel-delete-btn"
              onClick={() => {
                if (window.confirm(`Are you sure you want to delete "${documentData.filename}"?`)) {
                  onDeleteDocument(documentData.id);
                }
              }}
              title="Delete document"
              aria-label="Delete document"
            >
              <Trash2 size={15} />
            </button>
          )}

          {/* Close Panel Button */}
          {onClose && (
            <button
              type="button"
              className="panel-action-btn panel-close-btn"
              onClick={onClose}
              title="Close results panel"
              aria-label="Close results panel"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Tab Bar & Shared Search Box (visible when not collapsed) */}
      {!isCollapsed && (
        <div className="results-panel-nav-row">
          <div className="results-panel-tabs-bar" role="tablist" aria-label="Result Views">
            {/* Tab 1: Concepts (Searchable list) */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'concepts'}
              className={`panel-tab-btn ${activeTab === 'concepts' ? 'active' : ''}`}
              onClick={() => setActiveTab('concepts')}
            >
              <List size={15} />
              <span>Concepts</span>
            </button>

            {/* Tab 2: Concept Tree */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'tree'}
              className={`panel-tab-btn ${activeTab === 'tree' ? 'active' : ''}`}
              onClick={() => setActiveTab('tree')}
            >
              <GitBranch size={15} />
              <span>Concept Tree</span>
            </button>

            {/* Tab 3: Mind Map */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'mindmap'}
              className={`panel-tab-btn ${activeTab === 'mindmap' ? 'active' : ''}`}
              onClick={() => setActiveTab('mindmap')}
            >
              <Compass size={15} />
              <span>Mind Map</span>
            </button>

            {/* Tab 4: Flowchart */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'flowchart'}
              className={`panel-tab-btn ${activeTab === 'flowchart' ? 'active' : ''}`}
              onClick={() => setActiveTab('flowchart')}
            >
              <Waypoints size={15} />
              <span>Flowchart</span>
            </button>

            {/* Tab 5: Roadmap */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'roadmap'}
              className={`panel-tab-btn ${activeTab === 'roadmap' ? 'active' : ''}`}
              onClick={() => setActiveTab('roadmap')}
            >
              <ArrowRight size={15} />
              <span>Roadmap</span>
            </button>
          </div>

          {/* Shared Search Box */}
          <div className="panel-shared-search">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search concepts across views..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="shared-search-input"
              aria-label="Filter concepts across diagrams"
            />
          </div>
        </div>
      )}

      {/* 3. Panel Main View Area with Detail Side Panel */}
      {!isCollapsed && (
        <div className="results-panel-content-layout">
          <div className="results-view-workspace">
            {isLoading ? (
              <div className="panel-loader-wrap">
                <BookshelfLoader message="Rendering knowledge graph..." />
              </div>
            ) : (
              <Suspense fallback={<div className="panel-loader-wrap"><BookshelfLoader message="Loading view..." /></div>}>
                {activeTab === 'concepts' && (
                  <ConceptListView
                    concepts={concepts}
                    selectedConcept={selectedConcept}
                    onSelectConcept={setSelectedConcept}
                    onToggleStudied={handleToggleStudied}
                    isAuthenticated={isAuthenticated}
                    onJumpToTab={handleJumpToTab}
                  />
                )}

                {activeTab === 'tree' && (
                  <ConceptTreeView
                    documentData={documentData}
                    concepts={concepts}
                    selectedConcept={selectedConcept}
                    onSelectConcept={setSelectedConcept}
                    searchQuery={searchQuery}
                  />
                )}

                {activeTab === 'mindmap' && (
                  <MindMapView
                    documentData={documentData}
                    concepts={concepts}
                    selectedConcept={selectedConcept}
                    onSelectConcept={setSelectedConcept}
                    searchQuery={searchQuery}
                  />
                )}

                {activeTab === 'flowchart' && (
                  <FlowchartLearningView
                    concepts={concepts}
                    selectedConcept={selectedConcept}
                    onSelectConcept={setSelectedConcept}
                    onLearningPathChange={setLearningPath}
                    searchQuery={searchQuery}
                  />
                )}

                {activeTab === 'roadmap' && (
                  <StudyRoadmapView
                    concepts={concepts}
                    selectedConcept={selectedConcept}
                    onSelectConcept={setSelectedConcept}
                    onToggleStudied={handleToggleStudied}
                    isAuthenticated={isAuthenticated}
                  />
                )}
              </Suspense>
            )}
          </div>

          {/* Shared Detail Panel (Desktop Right Panel / Mobile Bottom Sheet) */}
          {selectedConcept && (
            <ConceptDetailPanel
              concept={selectedConcept}
              allConcepts={concepts}
              isAuthenticated={isAuthenticated}
              onClose={() => setSelectedConcept(null)}
              onSelectConcept={setSelectedConcept}
              onToggleStudied={handleToggleStudied}
              onJumpToTab={handleJumpToTab}
              learningPath={activeTab === 'flowchart' ? learningPath : null}
            />
          )}
        </div>
      )}
    </section>
  );
}
