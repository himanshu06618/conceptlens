import React, { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Download, 
  SlidersHorizontal, 
  BookOpen, 
  ChevronDown, 
  Network, 
  Layers, 
  Star, 
  Plus, 
  FileText, 
  Trash2, 
  Edit3, 
  Check, 
  Sparkles,
  BarChart3,
  GitBranch,
  Waypoints,
  Search,
  AlertCircle,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse from 'fuse.js';
import ConceptCard from './ConceptCard';
import ConceptSidePanel from './ConceptSidePanel';
import FilterWorkspaceModal from './FilterWorkspaceModal';
import { getExportUrl } from '../api/client';
import { 
  SegmentedTabs, 
  Button, 
  IconButton, 
  BottomSheet, 
  PaperSurface,
  Badge,
  BookshelfLoader
} from './ui';
import { cleanTopicHeading, normalizeConceptDisplayName } from '../utils/textCleaner';

// Lazy load Concept Tree for performance
const ConceptTree = lazy(() => import('./ConceptTree'));
const FlowchartView = lazy(() => import('./FlowchartView'));

// Smooth Count-Up Animation
function CountUp({ end, duration = 800 }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!end || end <= 0) {
      setCount(0);
      return;
    }
    const startTime = performance.now();
    let frameId;
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(ease * end));
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        setCount(end);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [end, duration]);

  return <span>{count}</span>;
}

export default function ResultsView({
  documentData,
  concepts = [],
  topics = [],
  isLoading = false,
  onRefresh,
  onNewUpload,
  onDeleteDoc
}) {
  // Sync search state with URL query ?q=
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';

  // Tab state keeps diagram selection and search state shared across views.
  const [activeTab, setActiveTab] = useState('tree');
  
  // Search & Filter state
  const [searchInput, setSearchInput] = useState(urlQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery);
  const [selectedTopic, setSelectedTopic] = useState('ALL');
  const [minImportance, setMinImportance] = useState(0);
  const [selectedPage, setSelectedPage] = useState('ALL');
  const [sortBy, setSortBy] = useState('importance'); // 'relevance', 'importance', 'alpha', 'page'

  const searchInputRef = useRef(null);

  // Editable Title State
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [docTitle, setDocTitle] = useState(documentData?.filename || 'Course Notes');

  useEffect(() => {
    setDocTitle(documentData?.filename || 'Course Notes');
  }, [documentData?.filename]);

  // Selected Concept for Side Panel / Drawer
  const [selectedConcept, setSelectedConcept] = useState(null);

  // Export dropdown
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // Debounce search by ~150ms and sync to URL query ?q=
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput.trim()) {
          next.set('q', searchInput.trim());
        } else {
          next.delete('q');
        }
        return next;
      }, { replace: true });
    }, 150);
    return () => clearTimeout(timer);
  }, [searchInput, setSearchParams]);

  // Synchronize with external URL change (e.g. browser back/forward or reload)
  useEffect(() => {
    if (urlQuery !== searchInput && urlQuery !== debouncedQuery) {
      setSearchInput(urlQuery);
      setDebouncedQuery(urlQuery);
    }
  }, [urlQuery]);

  // Silent keyboard shortcut: "/" focuses search, "Escape" clears it
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const isEditable = e.target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);

      if (e.key === '/' && !isEditable) {
        e.preventDefault();
        if (activeTab !== 'concepts') {
          setActiveTab('concepts');
        }
        setTimeout(() => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        }, 60);
      } else if (e.key === 'Escape') {
        if (searchInput) {
          e.preventDefault();
          setSearchInput('');
          setDebouncedQuery('');
          if (searchInputRef.current) searchInputRef.current.blur();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, searchInput]);

  // Setup Fuse.js for typo-tolerant matching across concept name, definition, source excerpt, topic
  const fuse = useMemo(() => {
    return new Fuse(concepts, {
      keys: [
        { name: 'name', weight: 0.5 },
        { name: 'definition', weight: 0.25 },
        { name: 'source_excerpt', weight: 0.15 },
        { name: 'topic', weight: 0.1 }
      ],
      threshold: 0.38,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 2
    });
  }, [concepts]);

  // Available pages for filter
  const availablePages = useMemo(() => {
    const pageSet = new Set();
    concepts.forEach((c) => {
      if (c.page) pageSet.add(Number(c.page));
    });
    return Array.from(pageSet).sort((a, b) => a - b);
  }, [concepts]);

  // Cleaned topic list
  const cleanedTopics = useMemo(() => {
    const set = new Set();
    concepts.forEach((c) => {
      if (c.topic && c.topic.trim()) {
        set.add(c.topic.trim());
      }
    });
    return Array.from(set);
  }, [concepts]);

  // Filtered & Sorted concepts
  const filteredConcepts = useMemo(() => {
    let list = concepts;

    // Apply typo-tolerant fuzzy search
    if (debouncedQuery.trim()) {
      const results = fuse.search(debouncedQuery.trim());
      list = results.map((res) => ({
        ...res.item,
        score: Math.max(0.05, Math.min(1, 1 - (res.score || 0)))
      }));
    }

    // Apply topic filter
    if (selectedTopic !== 'ALL') {
      list = list.filter((c) => cleanTopicHeading(c.topic) === cleanTopicHeading(selectedTopic));
    }

    // Apply importance filter
    if (minImportance > 0) {
      list = list.filter((c) => Number(c.importance || 1) >= minImportance);
    }

    // Apply page filter
    if (selectedPage !== 'ALL') {
      list = list.filter((c) => Number(c.page || 1) === Number(selectedPage));
    }

    // Sorting
    return [...list].sort((a, b) => {
      if (sortBy === 'relevance' && debouncedQuery.trim()) {
        return (Number(b.score) || 0) - (Number(a.score) || 0);
      }
      if (sortBy === 'importance') {
        return (Number(b.importance) || 0) - (Number(a.importance) || 0);
      }
      if (sortBy === 'alpha') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortBy === 'page') {
        const pageA = Number(a.page || 1);
        const pageB = Number(b.page || 1);
        if (pageA !== pageB) return pageA - pageB;
        return (Number(b.importance) || 0) - (Number(a.importance) || 0);
      }
      return (Number(b.importance) || 0) - (Number(a.importance) || 0);
    });
  }, [concepts, debouncedQuery, fuse, selectedTopic, minImportance, selectedPage, sortBy]);

  const activeFiltersCount = (selectedTopic !== 'ALL' ? 1 : 0) +
    (minImportance > 0 ? 1 : 0) +
    (selectedPage !== 'ALL' ? 1 : 0) +
    (debouncedQuery ? 1 : 0) +
    (sortBy !== 'importance' ? 1 : 0);

  const handleResetFilters = () => {
    setSelectedTopic('ALL');
    setMinImportance(0);
    setSelectedPage('ALL');
    setSortBy('importance');
  };

  const viewTabs = [
    { id: 'tree', label: 'Concept Tree', icon: GitBranch },
    { id: 'flowchart', label: 'Flowchart', icon: Waypoints },
    { id: 'concepts', label: 'All Concepts', count: concepts.length, icon: Layers },
    { id: 'summary', label: 'Summary', icon: BarChart3 }
  ];

  const handleNextConcept = () => {
    if (!selectedConcept) return;
    const currentIndex = filteredConcepts.findIndex((c) => c.id === selectedConcept.id);
    if (currentIndex >= 0 && currentIndex < filteredConcepts.length - 1) {
      setSelectedConcept(filteredConcepts[currentIndex + 1]);
    }
  };

  const handlePrevConcept = () => {
    if (!selectedConcept) return;
    const currentIndex = filteredConcepts.findIndex((c) => c.id === selectedConcept.id);
    if (currentIndex > 0) {
      setSelectedConcept(filteredConcepts[currentIndex - 1]);
    }
  };

  const handleRedirectToDescription = (concept) => {
    if (!concept) return;
    setSelectedConcept(concept);
    setActiveTab('concepts');
    if (concept.topic && selectedTopic !== 'ALL' && selectedTopic !== concept.topic) {
      setSelectedTopic(concept.topic);
    }
    if (debouncedQuery.trim() && !String(concept.name || '').toLowerCase().includes(debouncedQuery.toLowerCase())) {
      setSearchInput('');
      setDebouncedQuery('');
    }
    setTimeout(() => {
      const el = document.getElementById(`concept-card-${concept.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('concept-card-highlighted');
        setTimeout(() => el.classList.remove('concept-card-highlighted'), 2400);
      }
    }, 150);
  };

  return (
    <div className="results-view-wrap">
      {/* Top Document Header Bar: One Row (Title & Meta on Left, Export on Right) */}
      <div className="results-doc-header">
        <div className="doc-header-info">
          <div className="doc-title-row">
            {isEditingTitle ? (
              <div className="doc-title-edit-wrap">
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  onBlur={() => setIsEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setIsEditingTitle(false);
                  }}
                  autoFocus
                  className="doc-title-input"
                />
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(false)}
                  className="doc-title-confirm-btn"
                  aria-label="Confirm title"
                >
                  <Check size={18} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <>
                <h1 className="doc-header-filename" title={docTitle}>
                  {docTitle}
                </h1>
                <button
                  type="button"
                  className="edit-title-btn"
                  onClick={() => setIsEditingTitle(true)}
                  title="Rename document"
                  aria-label="Rename document"
                >
                  <Edit3 size={15} strokeWidth={1.8} />
                </button>
              </>
            )}
          </div>

          <div className="doc-header-meta">
            <Badge variant="amber" size="sm">
              {documentData.file_type?.toUpperCase() || 'NOTES'}
            </Badge>
            <span>•</span>
            <span className="doc-count-tag">
              <CountUp end={concepts.length} /> {concepts.length === 1 ? 'concept' : 'concepts'}
            </span>
            <span>•</span>
            <span>{topics.length} topics</span>
            {availablePages.length > 1 && (
              <>
                <span>•</span>
                <span>{availablePages.length} pages</span>
              </>
            )}
            {documentData.processing_time_sec > 0 && (
              <>
                <span>•</span>
                <Badge variant="neutral" size="sm" className="timing-chip">
                  Done in {Math.round(documentData.processing_time_sec)}s, {documentData.provider_used || 'on-device'}
                </Badge>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons: Export Menu on Right (same row) */}
        <div className="doc-header-actions">
          <div className="export-dropdown-wrapper" style={{ position: 'relative' }}>
            <Button
              variant="primary"
              size="sm"
              icon={Download}
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
            >
              Export <ChevronDown size={14} strokeWidth={2} style={{ marginLeft: 4 }} />
            </Button>

            {isExportMenuOpen && (
              <>
                <div 
                  className="dropdown-backdrop" 
                  style={{ position: 'fixed', inset: 0, zIndex: 45 }}
                  onClick={() => setIsExportMenuOpen(false)} 
                />
                <div 
                  className="glass-dropdown-menu shadow-md"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 8,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    padding: 6,
                    minWidth: 190,
                    zIndex: 50,
                    boxShadow: 'var(--shadow-lg)'
                  }}
                >
                  <a
                    href={getExportUrl(documentData.id, 'markdown')}
                    download
                    className="dropdown-item"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '8px 12px',
                      borderRadius: 8,
                      fontSize: '0.85rem',
                      color: 'var(--text)',
                      transition: 'background var(--transition-fast)'
                    }}
                    onClick={() => setIsExportMenuOpen(false)}
                  >
                    <span style={{ fontWeight: 600 }}>Study Guide</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Markdown format</span>
                  </a>

                  <a
                    href={getExportUrl(documentData.id, 'json')}
                    download
                    className="dropdown-item"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '8px 12px',
                      borderRadius: 8,
                      fontSize: '0.85rem',
                      color: 'var(--text)',
                      transition: 'background var(--transition-fast)'
                    }}
                    onClick={() => setIsExportMenuOpen(false)}
                  >
                    <span style={{ fontWeight: 600 }}>Raw Data</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>JSON structures</span>
                  </a>

                  <a
                    href={getExportUrl(documentData.id, 'csv')}
                    download
                    className="dropdown-item"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '8px 12px',
                      borderRadius: 8,
                      fontSize: '0.85rem',
                      color: 'var(--text)',
                      transition: 'background var(--transition-fast)'
                    }}
                    onClick={() => setIsExportMenuOpen(false)}
                  >
                    <span style={{ fontWeight: 600 }}>CSV Table</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Spreadsheet export</span>
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Notice for partially skipped pages */}
      {(() => {
        let skipped = [];
        if (documentData?.skipped_pages) {
          try {
            skipped = typeof documentData.skipped_pages === 'string'
              ? JSON.parse(documentData.skipped_pages)
              : documentData.skipped_pages;
          } catch {
            skipped = [];
          }
        }
        if (Array.isArray(skipped) && skipped.length > 0) {
          return (
            <div className="skipped-pages-banner" style={{
              margin: '8px 0 14px',
              padding: '8px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(57, 127, 105, 0.08)',
              border: '1px solid rgba(57, 127, 105, 0.28)',
              fontSize: '0.85rem',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={16} style={{ color: 'var(--gold-deep)', flexShrink: 0 }} />
              <span>Skipped pages {skipped.join(', ')}: could not be read or contained no legible text.</span>
            </div>
          );
        }
        return null;
      })()}

      {/* Navigation Bar: Segmented Tabs (Tree, Concepts, Summary) Directly Below Header */}
      <div className="results-nav-bar">
        <SegmentedTabs
          tabs={viewTabs}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* TAB 1: Concept Tree View (Default) */}
      {activeTab === 'tree' && (
        <Suspense fallback={
          <div className="concept-tree-stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BookshelfLoader size="lg" label="Loading concept tree..." />
          </div>
        }>
          <ConceptTree
            documentId={documentData.id}
            documentTitle={docTitle}
            fallbackConcepts={concepts}
            onSelectConcept={setSelectedConcept}
            searchQuery={debouncedQuery}
          />
        </Suspense>
      )}

      {activeTab === 'flowchart' && (
        <Suspense fallback={<div className="flowchart-status" role="status"><BookshelfLoader size="md" label="Loading flowchart..." /></div>}>
          <FlowchartView
            key={documentData.id}
            documentId={documentData.id}
            topics={cleanedTopics}
            concepts={concepts}
            selectedConcept={selectedConcept}
            onSelectConcept={setSelectedConcept}
            onRedirectToDescription={handleRedirectToDescription}
            query={searchInput}
            setQuery={setSearchInput}
          />
        </Suspense>
      )}

      {/* TAB 3: All Concepts Card Grid */}
      {activeTab === 'concepts' && (
        <div className="concepts-content-area">
          {/* Prominent Search Bar (Sticky below tabs) */}
          <div className="concepts-search-sticky-bar">
            <div className="concepts-search-row">
              <div className="search-field-container">
                <Search size={18} strokeWidth={1.8} className="search-icon" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search concepts, definitions, topics..."
                  className="concepts-search-input"
                  aria-label="Search concepts"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    className="search-clear-btn"
                    aria-label="Clear search query"
                  >
                    <X size={16} strokeWidth={2} />
                  </button>
                )}
              </div>

              {/* Sort Dropdown (Desktop) */}
              <div className="sort-menu-wrap desktop-only">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="glass-select"
                  aria-label="Sort concepts"
                >
                  {debouncedQuery.trim() && <option value="relevance">Sort: Relevance</option>}
                  <option value="importance">Sort: Importance</option>
                  <option value="alpha">Sort: A to Z</option>
                  <option value="page">Sort: Page number</option>
                </select>
              </div>

              {/* Filter Workspace Popup Trigger (Desktop & Mobile) */}
              <div className="filter-modal-trigger-wrap">
                <Button
                  variant={activeFiltersCount > 0 ? "primary" : "secondary"}
                  size="sm"
                  icon={SlidersHorizontal}
                  onClick={() => setIsFilterSheetOpen(true)}
                  className="filter-workspace-btn"
                >
                  Filters {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ''}
                </Button>
              </div>
            </div>

            {/* Filter Controls Row (Desktop) */}
            <div className="concepts-filters-row desktop-only">
              {/* Horizontally Scrollable Topic Chips */}
              <div className="topic-chips-scrollable">
                <button
                  type="button"
                  className={`filter-chip ${selectedTopic === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedTopic('ALL')}
                >
                  All Topics ({concepts.length})
                </button>
                {cleanedTopics.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`filter-chip ${selectedTopic === t ? 'active' : ''}`}
                    onClick={() => setSelectedTopic(t)}
                    title={t}
                  >
                    {cleanTopicHeading(t, 24)}
                  </button>
                ))}
              </div>

              {/* Importance Filter */}
              <div className="importance-filter-pills">
                <span className="filter-pill-label">Importance:</span>
                {[
                  { val: 0, label: 'All' },
                  { val: 3, label: '3+ ★' },
                  { val: 4, label: '4+ ★' },
                  { val: 5, label: '5 ★' }
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    className={`importance-pill ${minImportance === item.val ? 'active' : ''}`}
                    onClick={() => setMinImportance(item.val)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Result Count Bar */}
            <div className="results-count-bar">
              <span className="results-count-text">
                Showing <strong>{filteredConcepts.length}</strong> of <strong>{concepts.length}</strong> concepts
                {debouncedQuery && <> matching "<em>{debouncedQuery}</em>"</>}
                {selectedTopic !== 'ALL' && <> in topic <em>{cleanTopicHeading(selectedTopic, 20)}</em></>}
                {minImportance > 0 && <> ({minImportance}+ ★)</>}
              </span>
              {(debouncedQuery || selectedTopic !== 'ALL' || minImportance > 0) && (
                <button
                  type="button"
                  className="clear-filters-link"
                  onClick={() => {
                    setSearchInput('');
                    setSelectedTopic('ALL');
                    setMinImportance(0);
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {/* Concepts Grid / Empty State with Layout Animations */}
          {filteredConcepts.length === 0 ? (
            <div className="concepts-empty-state">
              <div className="empty-search-icon-wrap">
                <Search size={32} strokeWidth={1.5} />
              </div>
              <h3 className="empty-search-title">
                No concepts match "{debouncedQuery || selectedTopic}"
              </h3>
              <p className="empty-search-desc">
                Try refining your search keyword, clearing filters, or switching topics.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={X}
                onClick={() => {
                  setSearchInput('');
                  setSelectedTopic('ALL');
                  setMinImportance(0);
                }}
              >
                Clear search & filters
              </Button>
            </div>
          ) : (
            <div className="concepts-grid">
              {filteredConcepts.map((c) => (
                <motion.div
                  layout
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <ConceptCard
                    concept={c}
                    documentId={documentData?.id}
                    isSelected={selectedConcept?.id === c.id}
                    onSelect={setSelectedConcept}
                    searchQuery={debouncedQuery}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Summary View */}
      {activeTab === 'summary' && (
        <div className="summary-tab-wrap" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <div className="premium-card shadow-sm" style={{ padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', marginBottom: 16 }}>
              Document Overview
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Concepts</span>
                <span style={{ fontWeight: 600 }}>{concepts.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Topic Clusters</span>
                <span style={{ fontWeight: 600 }}>{topics.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Document Pages</span>
                <span style={{ fontWeight: 600 }}>{documentData.page_count || availablePages.length || 1}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>Completed</span>
              </div>
            </div>
          </div>

          <div className="premium-card shadow-sm" style={{ padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', marginBottom: 16 }}>
              Key Core Principles
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {concepts
                .filter((c) => Number(c.importance) >= 4)
                .slice(0, 5)
                .map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedConcept(c)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--surface-2)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{normalizeConceptDisplayName(c.name)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cleanTopicHeading(c.topic, 24)}</div>
                    </div>
                    <Badge variant="amber" size="sm">★ {c.importance}</Badge>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Concept Detail Right Drawer */}
      {selectedConcept && (
        <ConceptSidePanel
          concept={selectedConcept}
          documentId={documentData?.id}
          onClose={() => setSelectedConcept(null)}
          onSelectRelated={(relatedName) => {
            const found = concepts.find(
              (c) => c.name.toLowerCase() === relatedName.toLowerCase()
            );
            if (found) setSelectedConcept(found);
          }}
          currentIndex={filteredConcepts.findIndex((c) => c.id === selectedConcept.id)}
          totalConcepts={filteredConcepts.length}
          onNext={handleNextConcept}
          onPrev={handlePrevConcept}
        />
      )}

      {/* Luxury Filter Workspace Modal Popup */}
      <FilterWorkspaceModal
        isOpen={isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        sortBy={sortBy}
        setSortBy={setSortBy}
        selectedTopic={selectedTopic}
        setSelectedTopic={setSelectedTopic}
        minImportance={minImportance}
        setMinImportance={setMinImportance}
        cleanedTopics={cleanedTopics}
        totalConcepts={concepts.length}
        matchingCount={filteredConcepts.length}
        debouncedQuery={debouncedQuery}
        onResetFilters={handleResetFilters}
      />
    </div>
  );
}
