import React, { useState, useMemo } from 'react';
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
  FileText
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
  const [sortBy, setSortBy] = useState('importance'); // 'importance' | 'alpha' | 'minutes'

  // Distinct topics/chapters
  const topics = useMemo(() => {
    const set = new Set();
    concepts.forEach(c => set.add(c.chapter || c.topic || 'General'));
    return Array.from(set);
  }, [concepts]);

  // Filtered and sorted concepts
  const filteredConcepts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return concepts
      .filter((c) => {
        // Query match
        if (q) {
          const name = String(c.name || '').toLowerCase();
          const def = String(c.definition || '').toLowerCase();
          const topic = String(c.chapter || c.topic || '').toLowerCase();
          if (!name.includes(q) && !def.includes(q) && !topic.includes(q)) {
            return false;
          }
        }
        // Topic match
        if (selectedTopic !== 'ALL') {
          if ((c.chapter || c.topic || 'General') !== selectedTopic) {
            return false;
          }
        }
        // Importance match
        if (minImportance > 0 && (Number(c.importance) || 1) < minImportance) {
          return false;
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
        if (sortBy === 'minutes') {
          return (Number(b.estimated_minutes) || 5) - (Number(a.estimated_minutes) || 5);
        }
        return 0;
      });
  }, [concepts, searchQuery, selectedTopic, minImportance, sortBy]);

  return (
    <div className="concept-list-view-container" role="region" aria-label="Concepts Searchable List">
      {/* Search and Filters Toolbar */}
      <div className="concept-list-toolbar">
        <div className="list-search-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            placeholder="Search concepts by name or definition..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="list-search-input"
            aria-label="Search concepts"
          />
        </div>

        <div className="list-filters-row">
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

          <div className="filter-select-group">
            <label htmlFor="importance-filter" className="filter-label">Min Importance:</label>
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

          <div className="filter-select-group">
            <label htmlFor="sort-filter" className="filter-label">Sort by:</label>
            <select
              id="sort-filter"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="list-select"
            >
              <option value="importance">Importance</option>
              <option value="alpha">Alphabetical</option>
              <option value="minutes">Study Time</option>
            </select>
          </div>
        </div>
      </div>

      {/* Concept Cards Grid */}
      <div className="concept-cards-grid" role="feed" aria-label="Concept Cards">
        {filteredConcepts.map((concept) => {
          const isSelected = selectedConcept && String(selectedConcept.id) === String(concept.id);
          const isStudied = concept.status === 'studied';
          const importance = Math.max(1, Math.min(3, Number(concept.importance) || 1));

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
                {(concept.source_page || concept.page) && (
                  <button
                    type="button"
                    className="card-page-chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      const p = concept.source_page || concept.page || 1;
                      const q = encodeURIComponent(concept.source_quote || concept.name);
                      const docId = concept.document_id || documentId;
                      if (docId) {
                        navigate(`/viewer?doc=${docId}&page=${p}&q=${q}`);
                      } else {
                        onSelectConcept && onSelectConcept(concept);
                      }
                    }}
                    title={`Open page ${concept.source_page || concept.page} in PDF viewer`}
                  >
                    p. {concept.source_page || concept.page}
                  </button>
                )}
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
        })}

        {filteredConcepts.length === 0 && (
          <div className="concepts-empty-state">
            <p>No concepts found matching your search or filters.</p>
          </div>
        )}
      </div>
    </div>
  );
}
