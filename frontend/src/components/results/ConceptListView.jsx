import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Filter,
  Star,
  CheckCircle2,
  Circle,
  Clock,
  ArrowRight,
  BookOpen,
  Layers,
  Sparkles,
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink
} from 'lucide-react';

export default function ConceptListView({
  concepts = [],
  documentId,
  selectedConcept,
  onSelectConcept,
  onToggleStudied,
  isAuthenticated = false,
  onJumpToTab
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('ALL');
  const [minImportance, setMinImportance] = useState(0);
  
  // Sort preference: 'page' (default) | 'importance' | 'study' | 'alpha'
  const [sortBy, setSortBy] = useState(() => {
    try {
      return localStorage.getItem('conceptlens_concepts_sort_pref') || 'page';
    } catch (_) {
      return 'page';
    }
  });

  const handleSortChange = (newSort) => {
    setSortBy(newSort);
    try {
      localStorage.setItem('conceptlens_concepts_sort_pref', newSort);
    } catch (_) {}
  };

  // Page range filter state
  const [pageFrom, setPageFrom] = useState('');
  const [pageTo, setPageTo] = useState('');

  // Active page for jump control
  const [jumpPage, setJumpPage] = useState('');

  // Distinct topics/chapters
  const topics = useMemo(() => {
    const set = new Set();
    concepts.forEach(c => set.add(c.chapter || c.topic || 'General'));
    return Array.from(set);
  }, [concepts]);

  // Compute topological study order for all concepts (deterministic tie-breaking)
  const studyOrderMap = useMemo(() => {
    const map = new Map();
    const nameMap = new Map();
    concepts.forEach(c => {
      if (c && c.name) {
        nameMap.set(String(c.name).toLowerCase().trim(), c);
      }
    });

    const inDegree = new Map();
    const adj = new Map();
    concepts.forEach(c => {
      inDegree.set(c.id, 0);
      adj.set(c.id, []);
    });

    concepts.forEach(c => {
      const prereqs = Array.isArray(c.prerequisites) ? c.prerequisites : [];
      prereqs.forEach(pName => {
        const pStr = typeof pName === 'string' ? pName : (pName?.name || pName?.concept || '');
        if (!pStr) return;
        const pObj = nameMap.get(pStr.toLowerCase().trim());
        if (pObj && pObj.id !== c.id && inDegree.has(c.id)) {
          inDegree.set(c.id, inDegree.get(c.id) + 1);
          adj.get(pObj.id).push(c.id);
        }
      });
    });

    const queue = [];
    concepts.forEach(c => {
      if (inDegree.get(c.id) === 0) {
        queue.push(c);
      }
    });

    const sortFn = (a, b) => {
      const pA = a.source_page || a.page || 99999;
      const pB = b.source_page || b.page || 99999;
      if (pA !== pB) return pA - pB;
      const impA = Number(a.importance) || 1;
      const impB = Number(b.importance) || 1;
      if (impB !== impA) return impB - impA;
      return String(a.name || '').localeCompare(String(b.name || ''));
    };

    queue.sort(sortFn);

    let order = 1;
    const visited = new Set();

    while (queue.length > 0) {
      queue.sort(sortFn);
      const curr = queue.shift();
      if (visited.has(curr.id)) continue;
      visited.add(curr.id);
      map.set(curr.id, order++);

      const neighbors = adj.get(curr.id) || [];
      neighbors.forEach(nId => {
        inDegree.set(nId, inDegree.get(nId) - 1);
        if (inDegree.get(nId) === 0) {
          const nObj = concepts.find(c => c.id === nId);
          if (nObj && !visited.has(nId)) queue.push(nObj);
        }
      });
    }

    // Unresolved (cycles or disconnected)
    concepts.forEach(c => {
      if (!visited.has(c.id)) {
        map.set(c.id, order++);
      }
    });

    return map;
  }, [concepts]);

  // Filtered concepts
  const filteredConcepts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const fromNum = pageFrom !== '' ? Number(pageFrom) : null;
    const toNum = pageTo !== '' ? Number(pageTo) : null;

    return concepts
      .filter((c) => {
        // Search match
        if (q) {
          const name = String(c.name || '').toLowerCase();
          const def = String(c.definition || '').toLowerCase();
          const topic = String(c.chapter || c.topic || '').toLowerCase();
          if (!name.includes(q) && !def.includes(q) && !topic.includes(q)) {
            return false;
          }
        }
        // Chapter match
        if (selectedTopic !== 'ALL') {
          if ((c.chapter || c.topic || 'General') !== selectedTopic) {
            return false;
          }
        }
        // Importance match
        if (minImportance > 0 && (Number(c.importance) || 1) < minImportance) {
          return false;
        }
        // Page range match
        const primaryPage = c.source_page || c.page || (Array.isArray(c.pages) && c.pages[0]) || null;
        if (fromNum !== null) {
          if (primaryPage === null || primaryPage < fromNum) return false;
        }
        if (toNum !== null) {
          if (primaryPage === null || primaryPage > toNum) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'importance') {
          return (Number(b.importance) || 1) - (Number(a.importance) || 1);
        }
        if (sortBy === 'alpha') {
          return String(a.name || '').localeCompare(String(b.name || ''));
        }
        if (sortBy === 'study') {
          return (studyOrderMap.get(a.id) || 9999) - (studyOrderMap.get(b.id) || 9999);
        }
        // Sort by page order
        const pA = a.source_page || a.page || (Array.isArray(a.pages) && a.pages[0]) || 999999;
        const pB = b.source_page || b.page || (Array.isArray(b.pages) && b.pages[0]) || 999999;
        if (pA !== pB) return pA - pB;
        return (Number(b.importance) || 1) - (Number(a.importance) || 1);
      });
  }, [concepts, searchQuery, selectedTopic, minImportance, pageFrom, pageTo, sortBy, studyOrderMap]);

  // Unique available pages for page jump
  const availablePages = useMemo(() => {
    const set = new Set();
    concepts.forEach(c => {
      const p = c.source_page || c.page || (Array.isArray(c.pages) && c.pages[0]);
      if (p !== null && p !== undefined) set.add(Number(p));
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [concepts]);

  // Grouped concepts by page when sortBy === 'page'
  const pageGroups = useMemo(() => {
    if (sortBy !== 'page') return null;

    const groups = new Map();
    filteredConcepts.forEach(c => {
      const p = c.source_page || c.page || (Array.isArray(c.pages) && c.pages[0]) || null;
      const key = p !== null ? String(p) : 'unknown';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(c);
    });

    // Sort group keys: numeric ascending, then 'unknown' at end
    const keys = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return Number(a) - Number(b);
    });

    return keys.map(k => ({
      pageKey: k,
      displayTitle: k === 'unknown' ? 'Page unknown' : `Page ${k}`,
      pageNumber: k === 'unknown' ? null : Number(k),
      concepts: groups.get(k)
    }));
  }, [filteredConcepts, sortBy]);

  // Page jump handlers
  const handleJumpToPage = (targetPage) => {
    if (!targetPage) return;
    setJumpPage(String(targetPage));
    const elementId = `page-group-${targetPage}`;
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleJumpPrev = () => {
    if (availablePages.length === 0) return;
    const current = Number(jumpPage) || availablePages[0];
    const currentIndex = availablePages.indexOf(current);
    if (currentIndex > 0) {
      handleJumpToPage(availablePages[currentIndex - 1]);
    } else {
      handleJumpToPage(availablePages[0]);
    }
  };

  const handleJumpNext = () => {
    if (availablePages.length === 0) return;
    const current = Number(jumpPage) || availablePages[0];
    const currentIndex = availablePages.indexOf(current);
    if (currentIndex >= 0 && currentIndex < availablePages.length - 1) {
      handleJumpToPage(availablePages[currentIndex + 1]);
    } else if (currentIndex < 0) {
      handleJumpToPage(availablePages[0]);
    }
  };

  // Helper to render individual concept card
  const renderConceptCard = (concept) => {
    const isSelected = selectedConcept && String(selectedConcept.id) === String(concept.id);
    const isStudied = concept.status === 'studied';
    const importance = Math.max(1, Math.min(3, Number(concept.importance) || 1));
    const primaryPage = concept.source_page || concept.page || (Array.isArray(concept.pages) && concept.pages[0]) || null;
    
    // Multi-page display: "also p. 5, 9"
    const allPages = Array.isArray(concept.pages) ? concept.pages : (primaryPage ? [primaryPage] : []);
    const otherPages = allPages.filter(p => Number(p) !== Number(primaryPage));

    return (
      <article
        key={concept.id}
        className={`concept-list-card ${isSelected ? 'is-selected' : ''} ${isStudied ? 'is-studied' : ''}`}
        onClick={() => onSelectConcept && onSelectConcept(concept)}
        tabIndex={0}
        role="article"
        aria-selected={isSelected}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectConcept && onSelectConcept(concept);
          }
        }}
      >
        <div className="card-top-row">
          <span className="card-chapter-chip">
            <BookOpen size={11} />
            {concept.chapter || concept.topic || 'General'}
          </span>

          <div className="card-page-chips-wrap">
            {primaryPage && (
              <button
                type="button"
                className="card-page-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  const q = encodeURIComponent(concept.source_quote || concept.name);
                  const docId = concept.document_id || documentId;
                  if (docId) {
                    navigate(`/viewer?doc=${docId}&page=${primaryPage}&q=${q}`);
                  } else {
                    onSelectConcept && onSelectConcept(concept);
                  }
                }}
                title={`Open page ${primaryPage} in PDF viewer`}
              >
                p. {primaryPage}
              </button>
            )}

            {otherPages.length > 0 && (
              <span 
                className="card-also-pages"
                title={`Also appears on page ${otherPages.join(', ')}`}
              >
                also p. {otherPages.join(', ')}
              </span>
            )}
          </div>

          <div className="card-importance-dots" aria-label={`Importance: ${importance} of 3`}>
            {[1, 2, 3].map((dot) => (
              <span
                key={dot}
                className={`importance-dot ${dot <= importance ? 'active' : ''}`}
              />
            ))}
          </div>
        </div>

        <h3 className="card-concept-title">{concept.name}</h3>

        <p className="card-definition-text">
          {concept.definition || 'No definition available for this concept.'}
        </p>

        <div className="card-bottom-row">
          <div className="card-time-wrap">
            <Clock size={12} />
            <span>{concept.estimated_minutes || 5} min</span>
            {sortBy === 'study' && (
              <span className="card-study-seq-badge" title="Recommended study sequence rank">
                #{studyOrderMap.get(concept.id) || 1}
              </span>
            )}
          </div>

          <div className="card-actions-wrap">
            {isAuthenticated && (
              <button
                type="button"
                className={`card-studied-btn ${isStudied ? 'is-studied' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleStudied) onToggleStudied(concept);
                }}
                title={isStudied ? 'Mark not started' : 'Mark studied'}
                aria-label={isStudied ? 'Mark concept not started' : 'Mark concept studied'}
              >
                {isStudied ? (
                  <>
                    <CheckCircle2 size={14} />
                    <span>Studied</span>
                  </>
                ) : (
                  <>
                    <Circle size={14} />
                    <span>Mark Studied</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              className="card-locate-btn"
              onClick={(e) => {
                e.stopPropagation();
                onSelectConcept && onSelectConcept(concept);
                onJumpToTab && onJumpToTab('tree');
              }}
              title="View in Tree"
              aria-label={`View ${concept.name} in Tree`}
            >
              <span>View in Tree</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="concept-list-view-container" role="region" aria-label="Concepts Searchable List">
      {/* Search and Filters Toolbar */}
      <div className="concept-list-toolbar">
        <div className="list-search-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            placeholder="Search concepts by name, definition, or chapter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="list-search-input"
            aria-label="Search concepts"
          />
          {searchQuery && (
            <button
              type="button"
              className="list-search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="list-filters-row">
          {/* Chapter Filter */}
          <div className="filter-select-group">
            <label htmlFor="topic-filter" className="filter-label">Chapter:</label>
            <select
              id="topic-filter"
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="list-select"
            >
              <option value="ALL">All Chapters ({concepts.length})</option>
              {topics.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Importance Filter */}
          <div className="filter-select-group">
            <label htmlFor="importance-filter" className="filter-label">Importance:</label>
            <select
              id="importance-filter"
              value={minImportance}
              onChange={(e) => setMinImportance(Number(e.target.value))}
              className="list-select"
            >
              <option value={0}>All Levels</option>
              <option value={2}>Medium (2+)</option>
              <option value={3}>High (3)</option>
            </select>
          </div>

          {/* Sort By Control (Page default, Importance, Study order, A-Z) */}
          <div className="filter-select-group sort-select-group">
            <label htmlFor="sort-filter" className="filter-label">Sort by:</label>
            <select
              id="sort-filter"
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              className="list-select"
              aria-label="Sort concepts by"
            >
              <option value="page">Page (Default)</option>
              <option value="importance">Importance</option>
              <option value="study">Study order</option>
              <option value="alpha">A-Z</option>
            </select>
          </div>

          {/* Page Range Filter */}
          <div className="filter-select-group page-range-group">
            <label className="filter-label">Pages:</label>
            <input
              type="number"
              min="1"
              placeholder="From"
              value={pageFrom}
              onChange={(e) => setPageFrom(e.target.value)}
              className="page-range-input"
              aria-label="From page number"
            />
            <span className="page-range-sep">-</span>
            <input
              type="number"
              min="1"
              placeholder="To"
              value={pageTo}
              onChange={(e) => setPageTo(e.target.value)}
              className="page-range-input"
              aria-label="To page number"
            />
            {(pageFrom !== '' || pageTo !== '') && (
              <button
                type="button"
                className="page-range-clear-btn"
                onClick={() => { setPageFrom(''); setPageTo(''); }}
                title="Clear page range"
                aria-label="Clear page range filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Page Jump Control (when sorted by Page or when available pages exist) */}
        {sortBy === 'page' && availablePages.length > 0 && (
          <div className="concept-page-jump-bar" role="navigation" aria-label="Page jump control">
            <span className="jump-label">Jump to:</span>
            <div className="jump-control-stepper">
              <button
                type="button"
                className="jump-step-btn"
                onClick={handleJumpPrev}
                title="Previous page"
                aria-label="Jump to previous page"
              >
                <ChevronLeft size={16} />
              </button>

              <select
                value={jumpPage}
                onChange={(e) => handleJumpToPage(e.target.value)}
                className="jump-page-select"
                aria-label="Select page to jump to"
              >
                <option value="">Select page...</option>
                {availablePages.map((p) => (
                  <option key={p} value={p}>Page {p}</option>
                ))}
              </select>

              <button
                type="button"
                className="jump-step-btn"
                onClick={handleJumpNext}
                title="Next page"
                aria-label="Jump to next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Concept Cards Display: Page-Wise Grouped or Flat Grid */}
      {sortBy === 'page' && pageGroups ? (
        <div className="concept-page-groups-container">
          {pageGroups.map((group) => (
            <section
              key={group.pageKey}
              id={`page-group-${group.pageKey}`}
              className="concept-page-group-section"
              aria-label={group.displayTitle}
            >
              {/* Sticky Page Header */}
              <div className="concept-page-group-header">
                <div className="page-header-info">
                  <span className="page-group-title">{group.displayTitle}</span>
                  <span className="page-group-count-badge">
                    {group.concepts.length} {group.concepts.length === 1 ? 'concept' : 'concepts'}
                  </span>
                </div>

                {group.pageNumber && (documentId || concepts[0]?.document_id) && (
                  <button
                    type="button"
                    className="page-group-open-pdf-btn"
                    onClick={() => {
                      const dId = documentId || concepts[0]?.document_id;
                      navigate(`/viewer?doc=${dId}&page=${group.pageNumber}`);
                    }}
                    title={`Open page ${group.pageNumber} in PDF viewer`}
                    aria-label={`Open page ${group.pageNumber} in PDF viewer`}
                  >
                    <FileText size={13} />
                    <span>View in PDF</span>
                  </button>
                )}
              </div>

              {/* Cards Grid for this page */}
              <div className="concept-cards-grid" role="feed">
                {group.concepts.map(renderConceptCard)}
              </div>
            </section>
          ))}

          {filteredConcepts.length === 0 && (
            <div className="concepts-empty-state">
              <p>No concepts found matching your search or filters.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="concept-cards-grid" role="feed" aria-label="Concept Cards">
          {filteredConcepts.map(renderConceptCard)}

          {filteredConcepts.length === 0 && (
            <div className="concepts-empty-state">
              <p>No concepts found matching your search or filters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

