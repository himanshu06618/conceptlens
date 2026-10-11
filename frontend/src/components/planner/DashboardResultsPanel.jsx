import React, { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { 
  GitBranch, 
  Waypoints, 
  Layers, 
  ChevronDown, 
  ChevronUp, 
  X, 
  Maximize2, 
  Minimize2, 
  Download, 
  Search, 
  Star, 
  BookOpen, 
  ExternalLink,
  Edit3,
  Check,
  Trash2,
  Sparkles,
  Link2
} from 'lucide-react';
import { getExportUrl } from '../../api/client';
import BookshelfLoader from '../ui/BookshelfLoader';
import '../../styles/results-panel.css';

const ConceptTree = lazy(() => import('../ConceptTree'));
const FlowchartView = lazy(() => import('../FlowchartView'));

export default function DashboardResultsPanel({
  documentData,
  concepts = [],
  topics = [],
  chapterCount = 0,
  isLoading = false,
  onClose,
  onDeleteDocument,
  onRenameDocument,
  onToast = () => {}
}) {
  const [activeTab, setActiveTab] = useState('tree'); // 'tree' | 'flowchart' | 'concepts'
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  // Rename state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [docTitle, setDocTitle] = useState(documentData?.filename || 'Document Results');

  // Search state for Concepts tab
  const [conceptSearch, setConceptSearch] = useState('');
  const [selectedConcept, setSelectedConcept] = useState(null);

  const panelRef = useRef(null);

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

  const handleSaveTitle = () => {
    setIsEditingTitle(false);
    if (docTitle.trim() && docTitle !== documentData?.filename && onRenameDocument) {
      onRenameDocument(documentData.id, docTitle.trim());
    }
  };

  // Group concepts by chapter / topic
  const groupedConcepts = useMemo(() => {
    const groups = {};
    const query = conceptSearch.trim().toLowerCase();

    concepts.forEach((concept) => {
      const name = String(concept.name || '').toLowerCase();
      const def = String(concept.definition || '').toLowerCase();
      const topic = String(concept.topic || 'General');

      if (query && !name.includes(query) && !def.includes(query) && !topic.toLowerCase().includes(query)) {
        return;
      }

      if (!groups[topic]) {
        groups[topic] = [];
      }
      groups[topic].push(concept);
    });

    return groups;
  }, [concepts, conceptSearch]);

  const totalConceptCount = concepts.length;
  const effectiveChapterCount = chapterCount || topics.length || Object.keys(groupedConcepts).length || 1;

  const handleConceptClick = (concept) => {
    setSelectedConcept(concept);
  };

  const handleJumpToConceptInDiagram = (concept, targetTab = 'tree') => {
    setSelectedConcept(concept);
    setActiveTab(targetTab);
    onToast({
      type: 'info',
      message: `Highlighted "${concept.name}" in ${targetTab === 'tree' ? 'Concept Tree' : 'Flowchart'}`
    });
  };

  if (!documentData) return null;

  return (
    <section 
      ref={panelRef}
      className={`dashboard-results-panel ${isFullscreen ? 'is-fullscreen' : ''} ${isCollapsed ? 'is-collapsed' : ''}`}
      aria-label="Extracted Document Results"
    >
      {/* 1. Header Bar: Document Title, Concept/Chapter counts, Actions */}
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
              <button
                type="button"
                onClick={() => setIsEditingTitle(true)}
                className="panel-edit-title-btn"
                title="Rename document"
                aria-label="Rename document"
              >
                <Edit3 size={14} />
              </button>
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

        {/* Header Action Controls */}
        <div className="results-panel-actions">
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
                    <strong>Study Guide</strong>
                    <span>Markdown format</span>
                  </a>
                  <a
                    href={getExportUrl(documentData.id, 'json')}
                    download
                    className="export-menu-item"
                    onClick={() => setIsExportMenuOpen(false)}
                    role="menuitem"
                  >
                    <strong>JSON Data</strong>
                    <span>Structured tree & flowchart</span>
                  </a>
                  <a
                    href={getExportUrl(documentData.id, 'csv')}
                    download
                    className="export-menu-item"
                    onClick={() => setIsExportMenuOpen(false)}
                    role="menuitem"
                  >
                    <strong>CSV Table</strong>
                    <span>Spreadsheet concepts list</span>
                  </a>
                </div>
              </>
            )}
          </div>

          {/* Delete document button */}
          {onDeleteDocument && (
            <button
              type="button"
              className="panel-action-btn panel-delete-btn"
              onClick={() => {
                if (window.confirm(`Are you sure you want to delete "${docTitle}" and all its extracted concepts?`)) {
                  onDeleteDocument(documentData.id);
                }
              }}
              title="Delete document"
              aria-label="Delete document"
            >
              <Trash2 size={15} />
            </button>
          )}

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

      {/* 2. Tabs Bar (visible when not collapsed) */}
      {!isCollapsed && (
        <div className="results-panel-tabs-bar" role="tablist" aria-label="Result Views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tree'}
            className={`panel-tab-btn ${activeTab === 'tree' ? 'active' : ''}`}
            onClick={() => setActiveTab('tree')}
          >
            <GitBranch size={16} />
            <span>Concept Tree</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'flowchart'}
            className={`panel-tab-btn ${activeTab === 'flowchart' ? 'active' : ''}`}
            onClick={() => setActiveTab('flowchart')}
          >
            <Waypoints size={16} />
            <span>Flowchart</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'concepts'}
            className={`panel-tab-btn ${activeTab === 'concepts' ? 'active' : ''}`}
            onClick={() => setActiveTab('concepts')}
          >
            <Layers size={16} />
            <span>Concepts</span>
            <span className="panel-tab-badge">{totalConceptCount}</span>
          </button>
        </div>
      )}

      {/* 3. Panel Body: Views */}
      {!isCollapsed && (
        <div className="results-panel-body">
          {isLoading ? (
            <div className="panel-loader-stage">
              <BookshelfLoader size="md" label="Loading extracted knowledge..." />
            </div>
          ) : (
            <>
              {/* TAB 1: Concept Tree */}
              {activeTab === 'tree' && (
                <div className="panel-canvas-wrap">
                  <Suspense fallback={<div className="panel-loader-stage"><BookshelfLoader size="md" /></div>}>
                    <ConceptTree
                      documentId={documentData.id}
                      documentTitle={docTitle}
                      fallbackConcepts={concepts}
                      onSelectConcept={setSelectedConcept}
                      searchQuery=""
                    />
                  </Suspense>
                </div>
              )}

              {/* TAB 2: Flowchart (prerequisite and related relations) */}
              {activeTab === 'flowchart' && (
                <div className="panel-canvas-wrap">
                  <Suspense fallback={<div className="panel-loader-stage"><BookshelfLoader size="md" /></div>}>
                    <FlowchartView
                      key={documentData.id}
                      documentId={documentData.id}
                      topics={topics}
                      concepts={concepts}
                      selectedConcept={selectedConcept}
                      onSelectConcept={setSelectedConcept}
                      onRedirectToDescription={(concept) => {
                        setSelectedConcept(concept);
                        setActiveTab('concepts');
                      }}
                      query=""
                      setQuery={() => {}}
                    />
                  </Suspense>
                </div>
              )}

              {/* TAB 3: Concepts List */}
              {activeTab === 'concepts' && (
                <div className="panel-concepts-list-view">
                  {/* Search concepts bar */}
                  <div className="panel-concepts-search-row">
                    <div className="panel-search-box">
                      <Search size={16} className="panel-search-icon" />
                      <input
                        type="search"
                        placeholder="Search concepts, definitions, chapters..."
                        value={conceptSearch}
                        onChange={(e) => setConceptSearch(e.target.value)}
                        className="panel-search-input"
                        aria-label="Search extracted concepts"
                      />
                      {conceptSearch && (
                        <button
                          type="button"
                          onClick={() => setConceptSearch('')}
                          className="panel-search-clear"
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Grouped concepts container */}
                  <div className="panel-concepts-groups-container">
                    {Object.keys(groupedConcepts).length === 0 ? (
                      <div className="panel-empty-state">
                        <BookOpen size={36} color="var(--planner-mint)" />
                        <p>No concepts matching "{conceptSearch}"</p>
                      </div>
                    ) : (
                      Object.entries(groupedConcepts).map(([topicName, topicConcepts]) => (
                        <div key={topicName} className="panel-topic-group">
                          <div className="panel-topic-group-header">
                            <span className="panel-topic-name">{topicName}</span>
                            <span className="panel-topic-count">
                              {topicConcepts.length} {topicConcepts.length === 1 ? 'concept' : 'concepts'}
                            </span>
                          </div>

                          <div className="panel-concepts-grid">
                            {topicConcepts.map((concept) => {
                              const isSelected = selectedConcept && selectedConcept.id === concept.id;
                              const importance = Math.max(1, Math.min(5, parseInt(concept.importance || 1, 10)));
                              const relatedConcepts = concept.related_concepts || [];

                              return (
                                <article
                                  key={concept.id}
                                  className={`panel-concept-card ${isSelected ? 'is-selected' : ''}`}
                                  onClick={() => handleConceptClick(concept)}
                                >
                                  <div className="concept-card-top">
                                    <h4 className="concept-card-title">{concept.name}</h4>
                                    <div className="concept-card-stars" title={`Importance: ${importance}/5`}>
                                      {[...Array(5)].map((_, i) => (
                                        <Star
                                          key={i}
                                          size={13}
                                          className={i < importance ? 'star-filled' : 'star-empty'}
                                        />
                                      ))}
                                    </div>
                                  </div>

                                  {concept.definition && (
                                    <p className="concept-card-def">{concept.definition}</p>
                                  )}

                                  {/* Prerequisite & Related concept badges */}
                                  {relatedConcepts.length > 0 && (
                                    <div className="concept-card-relations">
                                      <span className="relations-label">
                                        <Link2 size={12} />
                                        Related:
                                      </span>
                                      <div className="relations-tags-wrap">
                                        {relatedConcepts.map((rel, rIdx) => {
                                          const relName = typeof rel === 'object' ? rel.name : String(rel);
                                          const relType = typeof rel === 'object' ? (rel.type || 'related') : 'related';
                                          const isPrereq = relType === 'prerequisite';

                                          return (
                                            <span 
                                              key={rIdx} 
                                              className={`relation-chip ${isPrereq ? 'prereq' : 'related'}`}
                                              title={`${isPrereq ? 'Prerequisite' : 'Related'} concept`}
                                            >
                                              {relName}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Quick Actions to highlight in diagram */}
                                  <div className="concept-card-actions">
                                    <button
                                      type="button"
                                      className="concept-diagram-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleJumpToConceptInDiagram(concept, 'tree');
                                      }}
                                      title="Highlight in Concept Tree"
                                    >
                                      <GitBranch size={13} />
                                      <span>View in Tree</span>
                                    </button>

                                    <button
                                      type="button"
                                      className="concept-diagram-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleJumpToConceptInDiagram(concept, 'flowchart');
                                      }}
                                      title="Highlight in Flowchart"
                                    >
                                      <Waypoints size={13} />
                                      <span>View in Flowchart</span>
                                    </button>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
