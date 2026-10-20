import React, { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import {
  List,
  GitBranch,
  ArrowRight,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Check,
  Edit3,
  Trash2,
  RotateCw,
  X,
  BookOpen,
  Sparkles,
  ShieldCheck,
  FolderOpen,
  AlertTriangle,
  FileText,
  Filter,
  Layers,
  Menu
} from 'lucide-react';
import { 
  getExportUrl, 
  setConceptProgress, 
  reanalyzeDocument, 
  getDocumentProgress,
  getDocumentCoverage,
  rerunDocumentPage
} from '../../api/client';
import { OverlayPortal, DropdownPortal, lockBodyScroll, unlockBodyScroll } from '../ui/Overlay';
import {
  downloadBlob,
  generateConceptsTxt,
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
const KnowledgeGraphView = lazy(() => import('./KnowledgeGraphView'));
const AskAnswerCard = lazy(() => import('./AskAnswerCard'));

const VALID_TABS = ['concepts', 'tree', 'roadmap', 'graph'];

function resolveInitialTab() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      // 1. Check URL query parameters (?view=... or ?tab=...)
      const params = new URLSearchParams(window.location.search);
      const urlView = (params.get('view') || params.get('tab') || '').toLowerCase().trim();
      if (urlView) {
        if (VALID_TABS.includes(urlView)) return urlView;
        if (urlView === 'flowchart' || urlView === 'flow') return 'tree';
        if (urlView === 'mindmap' || urlView === 'mind-map') return 'tree';
      }

      // 2. Check URL hash (#flowchart, #mindmap, etc.)
      const hash = (window.location.hash || '').replace('#', '').toLowerCase().trim();
      if (hash) {
        if (VALID_TABS.includes(hash)) return hash;
        if (hash === 'flowchart' || hash === 'flow') return 'tree';
        if (hash === 'mindmap' || hash === 'mind-map') return 'tree';
      }

      // 3. Check persistent stored last view
      const stored = (localStorage.getItem('conceptlens_last_view') || sessionStorage.getItem('conceptlens_last_view') || '').toLowerCase().trim();
      if (stored) {
        if (VALID_TABS.includes(stored)) return stored;
        if (stored === 'flowchart' || stored === 'flow') return 'tree';
        if (stored === 'mindmap' || stored === 'mind-map') return 'tree';
      }
    }
  } catch (_) {
    // Safe fallback
  }
  return 'concepts';
}

export default function UnifiedResultsPanel({
  documentData,
  concepts: initialConcepts = [],
  topics = [],
  documents = [],
  onSelectDoc,
  chapterCount = 0,
  isLoading = false,
  isAuthenticated = true,
  selectedConceptName = null,
  initialTab,
  onClose,
  onDeleteDocument,
  onRenameDocument,
  onProgressChange = () => {},
  onToast = () => {}
}) {
  // Tabs: 'concepts' | 'tree' | 'roadmap' | 'graph'
  const [activeTab, setActiveTab] = useState(() => initialTab || resolveInitialTab());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  // My Chapters Sidebar & Document search state
  const [isDocListOpen, setIsDocListOpen] = useState(true);
  const [docSearchQuery, setDocSearchQuery] = useState('');

  // Chapter filter state with URL recovery
  const [selectedChapter, setSelectedChapter] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('chapter') || 'ALL';
    } catch (_) {
      return 'ALL';
    }
  });

  // Page coverage modal state
  const [isCoverageOpen, setIsCoverageOpen] = useState(false);
  const [coverageData, setCoverageData] = useState(null);
  const [isCoverageLoading, setIsCoverageLoading] = useState(false);
  const [rerunningPageNum, setRerunningPageNum] = useState(null);

  // Rename state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [docTitle, setDocTitle] = useState(documentData?.filename || 'Document Results');

  // Shared search & selected concept state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConcept, setSelectedConcept] = useState(null);

  // Ask Drawer state
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [askInitialQuestion, setAskInitialQuestion] = useState('');

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

  // Validate selected chapter against current concepts
  useEffect(() => {
    if (selectedChapter !== 'ALL' && concepts.length > 0) {
      const exists = concepts.some((c) => (c.chapter || c.topic || 'General') === selectedChapter);
      if (!exists) {
        setSelectedChapter('ALL');
      }
    }
  }, [concepts, selectedChapter]);

  // Sync current document, tab, and chapter to URL search parameters
  useEffect(() => {
    if (typeof window === 'undefined' || !documentData?.id) return;
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('doc', documentData.id);
      params.set('view', activeTab);
      if (selectedChapter && selectedChapter !== 'ALL') {
        params.set('chapter', selectedChapter);
      } else {
        params.delete('chapter');
      }
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({ doc: documentData.id, view: activeTab, chapter: selectedChapter }, '', newUrl);
    } catch (_) {}
  }, [documentData?.id, activeTab, selectedChapter]);

  // Compute chapter list with page ranges
  const chapterDetails = useMemo(() => {
    const map = new Map();
    concepts.forEach((c) => {
      const chName = c.chapter || c.topic || 'General';
      if (!map.has(chName)) {
        map.set(chName, { name: chName, count: 0, pages: [] });
      }
      const entry = map.get(chName);
      entry.count += 1;
      const p = c.source_page || c.page || (Array.isArray(c.pages) && c.pages[0]);
      if (p !== null && p !== undefined) entry.pages.push(Number(p));
    });

    return Array.from(map.values()).map((ch) => {
      ch.pages.sort((a, b) => a - b);
      const minPage = ch.pages.length > 0 ? ch.pages[0] : null;
      const maxPage = ch.pages.length > 0 ? ch.pages[ch.pages.length - 1] : null;
      const rangeStr = minPage ? (minPage === maxPage ? `p. ${minPage}` : `p. ${minPage}–${maxPage}`) : '';
      return {
        name: ch.name,
        count: ch.count,
        rangeStr,
        label: rangeStr ? `${ch.name} (${rangeStr})` : ch.name
      };
    });
  }, [concepts]);

  // Filtered concepts passed to all views based on Chapter filter
  const displayConcepts = useMemo(() => {
    if (selectedChapter === 'ALL') return concepts;
    return concepts.filter((c) => (c.chapter || c.topic || 'General') === selectedChapter);
  }, [concepts, selectedChapter]);

  // Filtered documents list for "My Chapters" switcher
  const filteredDocs = useMemo(() => {
    const q = docSearchQuery.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => {
      const title = (d.title || d.filename || '').toLowerCase();
      return title.includes(q);
    });
  }, [documents, docSearchQuery]);

  // Load coverage data
  const loadCoverage = async () => {
    if (!documentData?.id) return;
    setIsCoverageLoading(true);
    try {
      const data = await getDocumentCoverage(documentData.id);
      setCoverageData(data);
    } catch (err) {
      console.warn('Failed to load coverage:', err);
    } finally {
      setIsCoverageLoading(false);
    }
  };

  // Re-run single page
  const handleRerunPage = async (pageNumber) => {
    if (!documentData?.id || rerunningPageNum) return;
    setRerunningPageNum(pageNumber);
    if (onToast) {
      onToast({
        type: 'info',
        message: `Re-running extraction for page ${pageNumber}...`
      });
    }
    try {
      const res = await rerunDocumentPage(documentData.id, pageNumber);
      if (onToast) {
        onToast({
          type: 'success',
          message: `Page ${pageNumber} extraction updated!`
        });
      }
      await loadCoverage();
      if (onProgressChange) onProgressChange();
    } catch (err) {
      if (onToast) {
        onToast({
          type: 'error',
          message: `Re-run page ${pageNumber} failed: ${err.message}`
        });
      }
    } finally {
      setRerunningPageNum(null);
    }
  };


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

      if (format === 'txt') {
        blob = generateConceptsTxt(documentData, concepts, topics);
        filename = getCleanExportFilename(docTitle, 'concepts.txt');
      } else if (format === 'markdown') {
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
          {/* Ask Notes Action (Screen 3) */}
          <button
            type="button"
            className="panel-action-btn ask-notes-btn"
            onClick={() => {
              setAskInitialQuestion('');
              setIsAskOpen(true);
            }}
            title="Ask your notes with Graph RAG"
            aria-label="Ask your notes with Graph RAG"
          >
            <Sparkles size={14} />
            <span className="hide-on-mobile">Ask Notes</span>
          </button>

          {/* Coverage Audit Action (Item 5.G) */}
          <button
            type="button"
            className="panel-action-btn coverage-btn"
            onClick={() => {
              setIsCoverageOpen(true);
              loadCoverage();
            }}
            title="View page coverage audit"
            aria-label="View page coverage audit"
          >
            <ShieldCheck size={14} />
            <span className="hide-on-mobile">Coverage</span>
          </button>

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
              className="panel-action-btn export-btn"
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              aria-expanded={isExportMenuOpen}
              aria-haspopup="true"
              disabled={isLoading || isExporting}
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
                  onClick={() => handleExport('txt')}
                  role="menuitem"
                >
                  <strong>Plain Text (.txt)</strong>
                  <span>Organized study guide for any text editor</span>
                </button>
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

          <div className="panel-actions-divider" />

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="panel-icon-btn"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? 'Exit fullscreen' : 'View diagram in fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'View diagram in fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* Collapse Toggle */}
          <button
            type="button"
            className="panel-icon-btn"
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
              className="panel-icon-btn panel-delete-btn"
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
              className="panel-icon-btn panel-close-btn"
              onClick={onClose}
              title="Close results panel"
              aria-label="Close results panel"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Tab Bar, Chapter Filter & Shared Search Box (visible when not collapsed) */}
      {!isCollapsed && (
        <div className="results-panel-nav-row">
          <div className="results-panel-nav-left">
            {/* Toggle My Chapters sidebar */}
            {documents.length > 0 && (
              <button
                type="button"
                className={`panel-chapters-toggle-btn ${isDocListOpen ? 'is-active' : ''}`}
                onClick={() => setIsDocListOpen((prev) => !prev)}
                title={isDocListOpen ? 'Hide My chapters' : 'Show My chapters'}
                aria-label="Toggle My chapters list"
              >
                <FolderOpen size={14} />
                <span className="hide-on-mobile">My chapters</span>
                <span className="doc-count-tag">{documents.length}</span>
              </button>
            )}

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

              {/* Tab 4: Graph (Knowledge Graph) */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'graph'}
                className={`panel-tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
                onClick={() => handleTabChange('graph')}
              >
                <Sparkles size={15} />
                <span>Graph</span>
              </button>
            </div>
          </div>

          <div className="results-panel-nav-right">
            {/* Inside Document: Chapter Filter with page ranges */}
            {chapterDetails.length > 0 && (
              <div className="panel-chapter-filter-box">
                <Filter size={13} className="chapter-filter-icon" />
                <select
                  value={selectedChapter}
                  onChange={(e) => setSelectedChapter(e.target.value)}
                  className="panel-chapter-dropdown"
                  aria-label="Filter views by chapter"
                >
                  <option value="ALL">All chapters ({concepts.length})</option>
                  {chapterDetails.map((ch) => (
                    <option key={ch.name} value={ch.name}>
                      {ch.label} ({ch.count})
                    </option>
                  ))}
                </select>
              </div>
            )}

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
        </div>
      )}

      {/* 3. Panel Main View Area with My Chapters Sidebar & Detail Side Panel */}
      {!isCollapsed && (
        <div className="results-panel-content-layout">
          {/* Persistent My Chapters Sidebar */}
          {isDocListOpen && documents.length > 0 && (
            <aside className="my-chapters-sidebar" role="region" aria-label="Uploaded chapters and documents list">
              <div className="my-chapters-sidebar-header">
                <div className="my-chapters-title-wrap">
                  <FolderOpen size={16} />
                  <h3>My chapters</h3>
                  <span className="my-chapters-badge">{documents.length}</span>
                </div>
                <button
                  type="button"
                  className="my-chapters-collapse-btn"
                  onClick={() => setIsDocListOpen(false)}
                  title="Collapse My chapters list"
                  aria-label="Collapse My chapters list"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>

              {/* Search box for documents */}
              <div className="my-chapters-search-wrap">
                <Search size={13} className="search-icon" />
                <input
                  type="text"
                  placeholder="Filter documents..."
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  className="my-chapters-search-input"
                  aria-label="Filter uploaded documents"
                />
              </div>

              {/* Scrollable list of document items */}
              <div className="my-chapters-items-scroll">
                {filteredDocs.map((doc) => {
                  const isCurrent = String(doc.id) === String(documentData?.id);
                  const conceptCount = doc.concept_count || doc.total_concepts || 0;
                  const pageCount = doc.page_count || doc.total_pages || (doc.page_coverage?.total_pages || null);
                  const progress = doc.progress !== undefined 
                    ? doc.progress 
                    : (conceptCount > 0 ? Math.round(((doc.studied_count || 0) / conceptCount) * 100) : 0);
                  const status = doc.status || 'ready';

                  return (
                    <article
                      key={doc.id}
                      className={`my-chapters-card ${isCurrent ? 'is-active-doc' : ''}`}
                      onClick={() => onSelectDoc && onSelectDoc(doc.id)}
                      role="button"
                      tabIndex={0}
                      aria-selected={isCurrent}
                      aria-label={`${doc.title || doc.filename}, ${conceptCount} concepts, ${progress}% complete`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectDoc && onSelectDoc(doc.id);
                        }
                      }}
                    >
                      <div className="my-chapters-card-top">
                        <h4 className="my-chapters-doc-name" title={doc.title || doc.filename}>
                          {doc.title || doc.filename}
                        </h4>
                        {isCurrent && <span className="active-doc-tag">Active</span>}
                      </div>

                      <div className="my-chapters-card-meta">
                        <span>{conceptCount} concepts</span>
                        {pageCount && <span>&bull; {pageCount} pages</span>}
                        <span>&bull; {progress}%</span>
                      </div>

                      <div className="my-chapters-progress-track">
                        <div
                          className="my-chapters-progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </article>
                  );
                })}

                {filteredDocs.length === 0 && (
                  <div className="my-chapters-empty">
                    <p>No documents found matching "{docSearchQuery}".</p>
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* Main Views Workspace */}
          <div className="results-view-workspace">
            {/* Mobile document switcher (Phone full-width dropdown) */}
            {documents.length > 1 && (
              <div className="mobile-doc-switcher-bar">
                <label htmlFor="mobile-doc-select" className="mobile-doc-label">
                  <FolderOpen size={14} />
                  <span>Document:</span>
                </label>
                <select
                  id="mobile-doc-select"
                  value={documentData?.id || ''}
                  onChange={(e) => onSelectDoc && onSelectDoc(e.target.value)}
                  className="mobile-doc-select"
                  aria-label="Switch document"
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title || d.filename} ({d.concept_count || 0} concepts)
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                      concepts={displayConcepts}
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
                      concepts={displayConcepts}
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
                      concepts={displayConcepts}
                      selectedConcept={selectedConcept}
                      onSelectConcept={setSelectedConcept}
                      onToggleStudied={handleToggleStudied}
                      isAuthenticated={isAuthenticated}
                    />
                  </ViewErrorBoundary>
                )}

                {activeTab === 'graph' && (
                  <ViewErrorBoundary viewName="Knowledge Graph">
                    <KnowledgeGraphView
                      documentId={documentData?.id}
                      documentTitle={documentData?.filename || 'Course Document'}
                      initialSelectedId={selectedConcept?.id}
                      concepts={displayConcepts}
                      onSelectConcept={setSelectedConcept}
                      onAskAboutConcept={(cName) => {
                        setAskInitialQuestion(`What are the prerequisites and dependencies of ${cName}?`);
                        setIsAskOpen(true);
                      }}
                      onOpenViewer={(dId, pg, qt) => {
                        window.location.href = `/viewer?doc=${dId}&page=${pg}&q=${encodeURIComponent(qt || '')}`;
                      }}
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

      {/* Page Coverage Audit Modal (Item 5.G) */}
      {isCoverageOpen && (
        <div className="coverage-modal-scrim" onClick={() => setIsCoverageOpen(false)}>
          <div className="coverage-modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Page Coverage Audit">
            <div className="coverage-modal-header">
              <div className="coverage-modal-title">
                <ShieldCheck size={20} color="var(--brand-deep, #4C8F0F)" />
                <h3>Page Coverage &amp; Extraction Audit</h3>
              </div>
              <button
                type="button"
                className="coverage-modal-close"
                onClick={() => setIsCoverageOpen(false)}
                aria-label="Close coverage audit"
              >
                <X size={18} />
              </button>
            </div>

            <div className="coverage-modal-content">
              {isCoverageLoading ? (
                <div className="panel-loader-wrap">
                  <BookshelfLoader message="Loading page coverage audit..." />
                </div>
              ) : coverageData ? (
                <>
                  {/* Summary Metric Cards */}
                  <div className="coverage-summary-cards">
                    <div className="coverage-metric-card">
                      <span className="metric-num">
                        {coverageData.summary?.processed_pages || 0} / {coverageData.summary?.total_pages || 0}
                      </span>
                      <span className="metric-label">Pages Processed</span>
                    </div>
                    <div className="coverage-metric-card">
                      <span className="metric-num">{coverageData.summary?.done_pages || 0}</span>
                      <span className="metric-label">Pages with Concepts</span>
                    </div>
                    <div className="coverage-metric-card">
                      <span className="metric-num">{coverageData.summary?.empty_ok_pages || 0}</span>
                      <span className="metric-label">Skipped (Expected Non-Content)</span>
                    </div>
                    <div className="coverage-metric-card">
                      <span className="metric-num">
                        {Number(coverageData.summary?.low_text_pages || 0) + Number(coverageData.summary?.failed_pages || 0)}
                      </span>
                      <span className="metric-label">Needing Attention</span>
                    </div>
                  </div>

                  {/* Skipped with reasons list */}
                  {Array.isArray(coverageData.summary?.skipped_with_reasons) && coverageData.summary.skipped_with_reasons.length > 0 && (
                    <div className="coverage-skipped-banner">
                      <h4>Skipped Pages (Expected Non-Content):</h4>
                      <div className="coverage-skipped-chips">
                        {coverageData.summary.skipped_with_reasons.map((sk) => (
                          <span key={sk.page} className="coverage-skipped-chip">
                            p. {sk.page}: {sk.reason}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Per Page Breakdown Table */}
                  <div className="coverage-table-wrap">
                    <table className="coverage-table">
                      <thead>
                        <tr>
                          <th>Page</th>
                          <th>Type</th>
                          <th>Characters</th>
                          <th>Concepts</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(coverageData.pages || []).map((pg) => {
                          const isRerunning = rerunningPageNum === pg.page;
                          return (
                            <tr key={pg.page}>
                              <td><strong>p. {pg.page}</strong></td>
                              <td><span className="page-type-tag">{pg.page_type}</span></td>
                              <td>{pg.text_chars} chars</td>
                              <td>
                                <span className={`concept-count-pill ${pg.concepts_count > 0 ? 'has-concepts' : ''}`}>
                                  {pg.concepts_count} concepts
                                </span>
                              </td>
                              <td>
                                <span className={`page-status-badge status-${pg.status}`}>
                                  {pg.status}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="coverage-rerun-page-btn"
                                  onClick={() => handleRerunPage(pg.page)}
                                  disabled={isRerunning}
                                  title={`Re-run extraction for page ${pg.page}`}
                                >
                                  <RotateCw size={12} className={isRerunning ? 'is-spinning' : ''} />
                                  <span>{isRerunning ? 'Running…' : 'Re-run this page'}</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="coverage-empty-text">No coverage data recorded yet. Click Re-analyse to run pipeline v2 and generate coverage audit.</p>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Floating Ask Notes Drawer Modal (Screen 3) */}
      {isAskOpen && (
        <div className="floating-ask-drawer-scrim" onClick={() => setIsAskOpen(false)}>
          <div className="floating-ask-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ask Your Notes">
            <div className="floating-ask-header">
              <div className="floating-ask-title">
                <Sparkles size={20} color="var(--brand, #9AE62E)" />
                <h3>Ask your notes</h3>
              </div>
              <button
                type="button"
                className="floating-ask-close"
                onClick={() => setIsAskOpen(false)}
                aria-label="Close ask panel"
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '16px' }}>
              <Suspense fallback={<div className="panel-loader-wrap"><BookshelfLoader message="Loading ask agent..." /></div>}>
                <AskAnswerCard
                  documentId={documentData?.id}
                  initialQuestion={askInitialQuestion}
                  onOpenViewer={(dId, pg, qt) => {
                    window.location.href = `/viewer?doc=${dId}&page=${pg}&q=${encodeURIComponent(qt || '')}`;
                  }}
                  onSelectConcept={(c) => {
                    setSelectedConcept(c);
                    setIsAskOpen(false);
                  }}
                  isAuthenticated={isAuthenticated}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </section>
    </>
  );

  return isFullscreen ? <OverlayPortal>{panel}</OverlayPortal> : panel;
}
