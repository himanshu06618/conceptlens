import React, { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import {
  List,
  GitBranch,
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
import { OverlayPortal, DropdownPortal, lockBodyScroll, unlockBodyScroll } from '../ui/Overlay';
import {
  downloadBlob,
  generateStudyGuideMarkdown,
  generateConceptsJson,
  generateConceptsCsv,
  getCleanExportFilename,
  printStudyGuide
} from '../../utils/exportUtils';
import ViewErrorBoundary from './ViewErrorBoundary';
import BookshelfLoader from '../ui/BookshelfLoader';
import '../../styles/results-panel.css';

// Lazy-load view components to keep initial dashboard bundle lightweight
const ConceptListView = lazy(() => import('./ConceptListView'));
const ConceptDetailPanel = lazy(() => import('./ConceptDetailPanel'));
const ConceptTreeView = lazy(() => import('./ConceptTreeView'));
const StudyRoadmapView = lazy(() => import('./StudyRoadmapView'));

const VALID_TABS = ['concepts', 'tree', 'roadmap'];

function resolveInitialTab() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      // 1. Check URL query parameters (?view=... or ?tab=...)
      const params = new URLSearchParams(window.location.search);
      const urlView = (params.get('view') || params.get('tab') || '').toLowerCase().trim();
      if (urlView) {
        if (VALID_TABS.includes(urlView)) return urlView;
        if (urlView === 'flowchart' || urlView === 'mindmap' || urlView === 'mind-map') return 'tree';
      }

      // 2. Check URL hash (#flowchart, #mindmap, etc.)
      const hash = (window.location.hash || '').replace('#', '').toLowerCase().trim();
      if (hash) {
        if (VALID_TABS.includes(hash)) return hash;
        if (hash === 'flowchart' || hash === 'mindmap' || hash === 'mind-map') return 'tree';
      }

      // 3. Check persistent stored last view
      const stored = (localStorage.getItem('conceptlens_last_view') || sessionStorage.getItem('conceptlens_last_view') || '').toLowerCase().trim();
      if (stored) {
        if (VALID_TABS.includes(stored)) return stored;
        if (stored === 'flowchart' || stored === 'mindmap' || stored === 'mind-map') {
          try {
            localStorage.setItem('conceptlens_last_view', 'tree');
          } catch (_) {}
          return 'tree';
        }
      }
    }
  } catch (_) {
    // Safe fallback
  }
  return 'tree';
}

export default function UnifiedResultsPanel({
  documentData,
  concepts: initialConcepts = [],
  topics = [],
  chapterCount = 0,
  isLoading = false,
  isAuthenticated = true,
  selectedConceptName = null,
  onClose,
  onDeleteDocument,
  onRenameDocument,
  onProgressChange = () => {},
  onToast = () => {}
}) {
  // Tabs: 'concepts' | 'tree' | 'roadmap' (default is 'tree')
  const [activeTab, setActiveTab] = useState(resolveInitialTab);
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

  // Local concepts state for optimistic updates
  const [concepts, setConcepts] = useState(() =>
    (initialConcepts || []).map((c) => ({
      ...c,
      document_id: c.document_id || documentData?.id
    }))
  );

  useEffect(() => {
    setConcepts(
      (initialConcepts || []).map((c) => ({
        ...c,
        document_id: c.document_id || documentData?.id
      }))
    );
  }, [initialConcepts, documentData?.id]);

  useEffect(() => {
    setDocTitle(documentData?.filename || 'Document Results');
  }, [documentData?.filename]);

  // When selectedConceptName is requested from external action (e.g. Related Topics card)
  useEffect(() => {
    if (selectedConceptName && concepts.length > 0) {
      const trimmedTarget = selectedConceptName.toLowerCase().trim();
      const match =
        concepts.find((c) => c.name?.toLowerCase().trim() === trimmedTarget) ||
        concepts.find(
          (c) =>
            c.name?.toLowerCase().includes(trimmedTarget) ||
            trimmedTarget.includes(c.name?.toLowerCase())
        );
      if (match) {
        setSelectedConcept(match);
        setActiveTab('tree');
        setIsCollapsed(false);
      }
    }
  }, [selectedConceptName, concepts]);

  // Handle escape key to exit fullscreen and scroll lock
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    if (isFullscreen) {
      lockBodyScroll();
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      if (isFullscreen) unlockBodyScroll();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  const exportBtnRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format) => {
    setIsExportMenuOpen(false);
    if (!documentData || concepts.length === 0) {
      if (onToast) onToast({ type: 'warning', message: 'No concepts available to export.' });
      return;
    }

    if (format === 'print') {
      printStudyGuide(documentData, concepts, topics);
      return;
    }

    setIsExporting(true);
    try {
      const docTitle = documentData.title || documentData.filename || 'course-notes';
      let blob = null;
      let filename = '';

      if (format === 'markdown') {
        blob = generateStudyGuideMarkdown(documentData, concepts, topics);
        filename = getCleanExportFilename(docTitle, 'study-guide.md');
      } else if (format === 'json') {
        blob = generateConceptsJson(documentData, concepts, topics);
        filename = getCleanExportFilename(docTitle, 'concepts.json');
      } else if (format === 'csv') {
        blob = generateConceptsCsv(documentData, concepts);
        filename = getCleanExportFilename(docTitle, 'concepts.csv');
      }

      if (blob) {
        await downloadBlob(blob, filename);
        if (onToast) {
          onToast({
            type: 'success',
            message: `Exported ${filename} successfully!`
          });
        }
      }
    } catch (err) {
      console.error('Export error:', err);
      if (onToast) {
        onToast({
          type: 'error',
          message: `Export failed: ${err.message || 'Please try again.'}`
        });
      }
    } finally {
      setIsExporting(false);
    }
  };

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

  // Tab change & jump handler with persistence
  const handleTabChange = (targetTab) => {
    const next = VALID_TABS.includes(targetTab) ? targetTab : 'tree';
    setActiveTab(next);
    try {
      localStorage.setItem('conceptlens_last_view', next);
    } catch (_) {}
  };

  const handleJumpToTab = (targetTab) => {
    handleTabChange(targetTab);
  };

  const totalConceptCount = concepts.length;
  const effectiveChapterCount = chapterCount || topics.length || 1;

  if (!documentData) return null;

  const panel = (
    <>
      {isFullscreen && (
        <div
          className="panel-fullscreen-scrim"
          onClick={() => setIsFullscreen(false)}
          aria-hidden="true"
        />
      )}
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
              ref={exportBtnRef}
              type="button"
              className="panel-action-btn"
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              aria-expanded={isExportMenuOpen}
              aria-haspopup="true"
              disabled={loadingConcepts || isExporting}
              title="Export document results"
            >
              <Download size={15} />
              <span className="hide-on-mobile">{isExporting ? 'Exporting…' : 'Export'}</span>
              <ChevronDown size={13} />
            </button>

            <DropdownPortal
              isOpen={isExportMenuOpen}
              onClose={() => setIsExportMenuOpen(false)}
              triggerRef={exportBtnRef}
              placement="bottom-end"
            >
              <div className="panel-export-menu" role="menu" aria-label="Export options">
                <button
                  type="button"
                  className="export-menu-item"
                  onClick={() => handleExport('markdown')}
                  role="menuitem"
                >
                  <strong>Study Guide (Markdown)</strong>
                  <span>Full notes &amp; prerequisites</span>
                </button>
                <button
                  type="button"
                  className="export-menu-item"
                  onClick={() => handleExport('json')}
                  role="menuitem"
                >
                  <strong>JSON Data</strong>
                  <span>Cleaned concepts, DAG relations</span>
                </button>
                <button
                  type="button"
                  className="export-menu-item"
                  onClick={() => handleExport('csv')}
                  role="menuitem"
                >
                  <strong>CSV Spreadsheet</strong>
                  <span>Tabular concept list &amp; times</span>
                </button>
                <div className="export-menu-divider" />
                <button
                  type="button"
                  className="export-menu-item export-menu-print"
                  onClick={() => handleExport('print')}
                  role="menuitem"
                >
                  <strong>Print Study Guide</strong>
                  <span>Save as PDF or print clean notes</span>
                </button>
              </div>
            </DropdownPortal>
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
              onClick={() => handleTabChange('concepts')}
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
              onClick={() => handleTabChange('tree')}
            >
              <GitBranch size={15} />
              <span>Concept Tree</span>
            </button>

            {/* Tab 3: Roadmap */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'roadmap'}
              className={`panel-tab-btn ${activeTab === 'roadmap' ? 'active' : ''}`}
              onClick={() => handleTabChange('roadmap')}
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
                  <ViewErrorBoundary viewName="Concepts List">
                    <ConceptListView
                      documentId={documentData?.id}
                      concepts={concepts}
                      selectedConcept={selectedConcept}
                      onSelectConcept={setSelectedConcept}
                      onToggleStudied={handleToggleStudied}
                      isAuthenticated={isAuthenticated}
                      onJumpToTab={handleJumpToTab}
                    />
                  </ViewErrorBoundary>
                )}

                {activeTab === 'tree' && (
                  <ViewErrorBoundary viewName="Concept Tree">
                    <ConceptTreeView
                      documentData={documentData}
                      concepts={concepts}
                      selectedConcept={selectedConcept}
                      onSelectConcept={setSelectedConcept}
                      searchQuery={searchQuery}
                    />
                  </ViewErrorBoundary>
                )}



                {activeTab === 'roadmap' && (
                  <ViewErrorBoundary viewName="Study Roadmap">
                    <StudyRoadmapView
                      documentId={documentData?.id}
                      concepts={concepts}
                      selectedConcept={selectedConcept}
                      onSelectConcept={setSelectedConcept}
                      onToggleStudied={handleToggleStudied}
                      isAuthenticated={isAuthenticated}
                    />
                  </ViewErrorBoundary>
                )}
              </Suspense>
            )}
          </div>

          {/* Shared Detail Panel (Desktop Right Panel / Mobile Bottom Sheet) */}
          {selectedConcept && (
            <Suspense fallback={null}>
              <ConceptDetailPanel
                documentId={documentData?.id}
                concept={selectedConcept}
                allConcepts={concepts}
                isAuthenticated={isAuthenticated}
                onClose={() => setSelectedConcept(null)}
                onSelectConcept={setSelectedConcept}
                onToggleStudied={handleToggleStudied}
                onJumpToTab={handleJumpToTab}
              />
            </Suspense>
          )}
        </div>
      )}
    </section>
    </>
  );

  return isFullscreen ? <OverlayPortal>{panel}</OverlayPortal> : panel;
}
