import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  List,
  GitFork,
  BookOpen,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Filter,
  Sparkles,
  Layers,
  AlertCircle,
  Split,
  Check,
  X
} from 'lucide-react';
import {
  fetchKnowledgeGraph,
  fetchEntityDetail,
  fetchMergeSuggestions,
  acceptMergeSuggestion,
  rejectMergeSuggestion,
  unmergeEntity
} from '../../api/client';
import BookshelfLoader from '../ui/BookshelfLoader';

// Curated lecture palette (distinct fill per lecture + text tag)
const LECTURE_COLORS = [
  { fill: 'rgba(154, 230, 46, 0.22)', border: '#6FC21A', text: '#2E5E04' },
  { fill: 'rgba(56, 189, 248, 0.22)', border: '#0284C7', text: '#0369A1' },
  { fill: 'rgba(244, 114, 182, 0.22)', border: '#DB2777', text: '#BE185D' },
  { fill: 'rgba(251, 191, 36, 0.22)', border: '#D97706', text: '#B45309' },
  { fill: 'rgba(167, 139, 250, 0.22)', border: '#7C3AED', text: '#6D28D9' },
  { fill: 'rgba(52, 211, 153, 0.22)', border: '#059669', text: '#047857' },
];

export default function KnowledgeGraphView({
  documentId = null,
  initialSelectedId = null,
  onSelectConcept = () => {},
  onOpenViewer = null,
  onAskAboutConcept = () => {},
  isAuthenticated = true
}) {
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], total_nodes: 0, total_edges: 0, truncated: false, merge_suggestions_count: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [linkFilter, setLinkFilter] = useState('all'); // 'all' | 'notes' | 'suggested'
  const [selectedLecture, setSelectedLecture] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('canvas'); // 'canvas' | 'list'

  // Focus & Selection State
  const [selectedEntityId, setSelectedEntityId] = useState(initialSelectedId);
  const [entityDetail, setEntityDetail] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [mergeSuggestions, setMergeSuggestions] = useState([]);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  // Mobile breadcrumb navigation
  const [focusHistory, setFocusHistory] = useState([]);

  // Canvas pan & zoom state
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const svgRef = useRef(null);

  // Load knowledge graph data
  const loadGraph = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchKnowledgeGraph({
        scope: documentId ? 'document' : 'all',
        documentId: documentId,
        origin: linkFilter,
        search: searchQuery,
        limit: 80
      });
      setGraphData(data);
    } catch (err) {
      setError(err.message || 'Failed to load knowledge graph.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, linkFilter, searchQuery]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Load merge suggestions count
  useEffect(() => {
    if (isAuthenticated) {
      fetchMergeSuggestions()
        .then(setMergeSuggestions)
        .catch(() => {});
    }
  }, [isAuthenticated]);

  // Load detailed entity info on selection
  useEffect(() => {
    if (!selectedEntityId) {
      setEntityDetail(null);
      return;
    }
    let isCurrent = true;
    setIsDetailLoading(true);
    fetchEntityDetail(selectedEntityId)
      .then((detail) => {
        if (isCurrent) setEntityDetail(detail);
      })
      .catch(() => {
        if (isCurrent) setEntityDetail(null);
      })
      .finally(() => {
        if (isCurrent) setIsDetailLoading(false);
      });
    return () => { isCurrent = false; };
  }, [selectedEntityId]);

  // Available lecture tags for filter
  const lectureOptions = useMemo(() => {
    const set = new Set();
    graphData.nodes.forEach(n => {
      (n.lecture_tags || []).forEach(t => set.add(t));
    });
    return Array.from(set).sort();
  }, [graphData.nodes]);

  // Color mapping per lecture
  const lectureColorMap = useMemo(() => {
    const map = {};
    lectureOptions.forEach((lec, idx) => {
      map[lec] = LECTURE_COLORS[idx % LECTURE_COLORS.length];
    });
    return map;
  }, [lectureOptions]);

  // Filtered nodes & edges
  const filteredNodes = useMemo(() => {
    return graphData.nodes.filter(n => {
      if (selectedLecture !== 'all') {
        const tags = n.lecture_tags || [];
        if (!tags.includes(selectedLecture)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return n.name.toLowerCase().includes(q) || (n.definition || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [graphData.nodes, selectedLecture, searchQuery]);

  const filteredEdges = useMemo(() => {
    const validNodeIds = new Set(filteredNodes.map(n => n.id));
    return graphData.edges.filter(e => {
      if (!validNodeIds.has(e.source) || !validNodeIds.has(e.target)) return false;
      if (linkFilter === 'notes' && e.origin !== 'notes') return false;
      if (linkFilter === 'suggested' && e.origin !== 'suggested') return false;
      return true;
    });
  }, [graphData.edges, filteredNodes, linkFilter]);

  // Focus mode neighborhood calculation (1-hop & 2-hop connected nodes)
  const neighborhood = useMemo(() => {
    if (!selectedEntityId) return null;
    const directNeighbors = new Set();
    const twoHopNeighbors = new Set();
    const connectedEdges = new Set();

    filteredEdges.forEach(e => {
      if (e.source === selectedEntityId) {
        directNeighbors.add(e.target);
        connectedEdges.add(e.id);
      }
      if (e.target === selectedEntityId) {
        directNeighbors.add(e.source);
        connectedEdges.add(e.id);
      }
    });

    filteredEdges.forEach(e => {
      if (directNeighbors.has(e.source) && !twoHopNeighbors.has(e.target)) {
        twoHopNeighbors.add(e.target);
        connectedEdges.add(e.id);
      }
      if (directNeighbors.has(e.target) && !twoHopNeighbors.has(e.source)) {
        twoHopNeighbors.add(e.source);
        connectedEdges.add(e.id);
      }
    });

    return {
      selectedId: selectedEntityId,
      direct: directNeighbors,
      twoHop: twoHopNeighbors,
      edges: connectedEdges
    };
  }, [selectedEntityId, filteredEdges]);

  // Layout node coordinates (grid / radial stage layout)
  const nodePositions = useMemo(() => {
    const pos = {};
    const count = filteredNodes.length;
    if (count === 0) return pos;

    // Group nodes by stage_index or lecture
    const stages = {};
    filteredNodes.forEach(n => {
      const s = n.stage_index || 0;
      if (!stages[s]) stages[s] = [];
      stages[s].push(n);
    });

    const stageKeys = Object.keys(stages).map(Number).sort((a, b) => a - b);
    const colWidth = 260;
    const rowHeight = 110;

    stageKeys.forEach((sKey, colIdx) => {
      const colNodes = stages[sKey];
      const startY = -(colNodes.length * rowHeight) / 2 + 100;
      colNodes.forEach((node, rowIdx) => {
        pos[node.id] = {
          x: colIdx * colWidth + 120,
          y: startY + rowIdx * rowHeight + 120
        };
      });
    });

    return pos;
  }, [filteredNodes]);

  // Handle Pan & Zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    setTransform(prev => ({
      ...prev,
      k: Math.max(0.35, Math.min(2.8, prev.k * zoomFactor))
    }));
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    }));
  };

  const handleMouseUp = () => setIsDragging(false);

  // Zoom controls
  const handleZoomIn = () => setTransform(t => ({ ...t, k: Math.min(2.8, t.k * 1.25) }));
  const handleZoomOut = () => setTransform(t => ({ ...t, k: Math.max(0.35, t.k * 0.8) }));
  const handleResetZoom = () => setTransform({ x: 0, y: 0, k: 1 });

  // Node selection handler
  const handleSelectNode = (nodeId) => {
    if (selectedEntityId && selectedEntityId !== nodeId) {
      setFocusHistory(prev => [...prev, selectedEntityId]);
    }
    setSelectedEntityId(nodeId);
    onSelectConcept({ id: nodeId, name: graphData.nodes.find(n => n.id === nodeId)?.name });
  };

  const handleBackBreadcrumb = () => {
    if (focusHistory.length === 0) return;
    const prevId = focusHistory[focusHistory.length - 1];
    setFocusHistory(h => h.slice(0, -1));
    setSelectedEntityId(prevId);
  };

  // Keyboard navigation between connected nodes
  const handleKeyDown = (e) => {
    if (!selectedEntityId || !neighborhood) return;
    const directList = Array.from(neighborhood.direct);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (directList.length > 0) handleSelectNode(directList[0]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (focusHistory.length > 0) handleBackBreadcrumb();
    } else if (e.key === 'Escape') {
      setSelectedEntityId(null);
    }
  };

  // Merge suggestions actions
  const handleAcceptMerge = async (suggId) => {
    try {
      await acceptMergeSuggestion(suggId);
      setActionMessage('Merge accepted! Entities consolidated.');
      loadGraph();
      const updated = await fetchMergeSuggestions();
      setMergeSuggestions(updated);
    } catch (err) {
      setActionMessage(`Could not merge: ${err.message}`);
    }
  };

  const handleRejectMerge = async (suggId) => {
    try {
      await rejectMergeSuggestion(suggId);
      setActionMessage('Suggestion marked as not the same.');
      const updated = await fetchMergeSuggestions();
      setMergeSuggestions(updated);
    } catch (err) {
      setActionMessage(`Error: ${err.message}`);
    }
  };

  const handleUnmerge = async (entId) => {
    try {
      await unmergeEntity(entId);
      setActionMessage('Entity unmerged into separate concepts.');
      loadGraph();
      setSelectedEntityId(null);
    } catch (err) {
      setActionMessage(`Could not unmerge: ${err.message}`);
    }
  };

  if (isLoading && graphData.nodes.length === 0) {
    return (
      <div className="kg-loader-wrap" style={{ minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BookshelfLoader message="Synthesizing per-student concept graph..." />
      </div>
    );
  }

  return (
    <div className={`kg-container ${isFullscreen ? 'is-fullscreen' : ''}`} onKeyDown={handleKeyDown} tabIndex={0}>
      {/* 1. Toolbar */}
      <div className="kg-toolbar" role="toolbar" aria-label="Knowledge Graph Controls">
        <div className="kg-toolbar-left">
          {/* Link origin filters */}
          <div className="kg-filter-group" role="radiogroup" aria-label="Edge origin filter">
            <button
              type="button"
              className={`kg-pill-btn ${linkFilter === 'all' ? 'active' : ''}`}
              onClick={() => setLinkFilter('all')}
            >
              All links
            </button>
            <button
              type="button"
              className={`kg-pill-btn ${linkFilter === 'notes' ? 'active' : ''}`}
              onClick={() => setLinkFilter('notes')}
              title="Only links with direct citations found on PDF pages"
            >
              From your notes
            </button>
            <button
              type="button"
              className={`kg-pill-btn ${linkFilter === 'suggested' ? 'active' : ''}`}
              onClick={() => setLinkFilter('suggested')}
              title="Algorithmic prerequisite suggestions"
            >
              Suggested
            </button>
          </div>

          {/* Lecture dropdown */}
          {lectureOptions.length > 0 && (
            <div className="kg-lecture-select-wrap">
              <Filter size={13} className="kg-select-icon" />
              <select
                value={selectedLecture}
                onChange={(e) => setSelectedLecture(e.target.value)}
                className="kg-lecture-select"
                aria-label="Filter graph by lecture"
              >
                <option value="all">All Lectures ({lectureOptions.length})</option>
                {lectureOptions.map(lec => (
                  <option key={lec} value={lec}>{lec}</option>
                ))}
              </select>
            </div>
          )}

          {/* Search */}
          <div className="kg-search-wrap">
            <Search size={13} className="kg-search-icon" />
            <input
              type="text"
              placeholder="Search concepts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="kg-search-input"
              aria-label="Search concepts in knowledge graph"
            />
          </div>
        </div>

        <div className="kg-toolbar-right">
          {/* Merge suggestions badge */}
          {mergeSuggestions.length > 0 && (
            <button
              type="button"
              className="kg-merge-badge-btn"
              onClick={() => setIsMergeModalOpen(true)}
              aria-label={`Review ${mergeSuggestions.length} concept merge suggestions`}
            >
              <Split size={14} />
              <span>Merge suggestions: {mergeSuggestions.length}</span>
            </button>
          )}

          {/* List View Toggle */}
          <button
            type="button"
            className={`kg-action-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode(m => m === 'canvas' ? 'list' : 'canvas')}
            title="Toggle between graphical canvas and accessible list view"
            aria-label="View as list"
          >
            <List size={14} />
            <span className="hide-on-mobile">{viewMode === 'list' ? 'Graph View' : 'View as list'}</span>
          </button>

          {/* Zoom controls */}
          <div className="kg-zoom-group">
            <button type="button" onClick={handleZoomIn} className="kg-zoom-btn" title="Zoom in" aria-label="Zoom in">
              <ZoomIn size={14} />
            </button>
            <button type="button" onClick={handleZoomOut} className="kg-zoom-btn" title="Zoom out" aria-label="Zoom out">
              <ZoomOut size={14} />
            </button>
            <button type="button" onClick={handleResetZoom} className="kg-zoom-btn" title="Reset view" aria-label="Reset view">
              <RotateCcw size={13} />
            </button>
          </div>

          {/* Fullscreen */}
          <button
            type="button"
            className="kg-action-btn"
            onClick={() => setIsFullscreen(f => !f)}
            title="Toggle fullscreen canvas"
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Action Notification Toast Banner */}
      {actionMessage && (
        <div className="kg-action-banner" role="status">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage('')} aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Workspace Layout (Canvas or List View + Side Panel) */}
      <div className="kg-workspace">
        {viewMode === 'canvas' ? (
          <div
            className="kg-canvas-viewport"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            {/* Mobile Focus Breadcrumb Trail */}
            {focusHistory.length > 0 && (
              <div className="kg-mobile-breadcrumb">
                <button type="button" onClick={handleBackBreadcrumb} className="kg-breadcrumb-back-btn">
                  &larr; Back
                </button>
                <span className="kg-breadcrumb-text">Focus mode active</span>
              </div>
            )}

            <svg
              ref={svgRef}
              className="kg-svg-stage"
              width="100%"
              height="100%"
              aria-label="Concept Knowledge Graph Interactive Canvas"
            >
              <defs>
                {/* Arrow markers for edges */}
                <marker id="arrow-solid" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#6FC21A" />
                </marker>
                <marker id="arrow-dashed" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#D97706" />
                </marker>
              </defs>

              <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                {/* Edges */}
                {filteredEdges.map(edge => {
                  const sPos = nodePositions[edge.source];
                  const tPos = nodePositions[edge.target];
                  if (!sPos || !tPos) return null;

                  const isEmphasized = neighborhood ? neighborhood.edges.has(edge.id) : true;
                  const isDimmed = neighborhood && !isEmphasized;

                  let strokeStyle = '#6FC21A';
                  let strokeDash = 'none';
                  let markerEnd = 'url(#arrow-solid)';

                  if (edge.origin === 'suggested') {
                    strokeStyle = '#D97706';
                    strokeDash = '5,4';
                    markerEnd = 'url(#arrow-dashed)';
                  } else if (edge.type === 'related') {
                    strokeStyle = '#94A3B8';
                    strokeDash = '2,3';
                    markerEnd = 'none';
                  }

                  // Curve control point
                  const midX = (sPos.x + tPos.x) / 2;
                  const midY = (sPos.y + tPos.y) / 2 - 20;

                  return (
                    <path
                      key={edge.id}
                      d={`M ${sPos.x} ${sPos.y} Q ${midX} ${midY} ${tPos.x} ${tPos.y}`}
                      fill="none"
                      stroke={strokeStyle}
                      strokeWidth={isEmphasized && selectedEntityId ? 2.5 : 1.5}
                      strokeDasharray={strokeDash}
                      markerEnd={markerEnd}
                      opacity={isDimmed ? 0.15 : 0.85}
                      style={{ transition: 'opacity 0.2s ease' }}
                    />
                  );
                })}

                {/* Nodes */}
                {filteredNodes.map(node => {
                  const pos = nodePositions[node.id];
                  if (!pos) return null;

                  const isSelected = selectedEntityId === node.id;
                  const isDirect = neighborhood?.direct.has(node.id);
                  const isTwoHop = neighborhood?.twoHop.has(node.id);
                  const isDimmed = neighborhood && !isSelected && !isDirect && !isTwoHop;

                  const primaryLecture = (node.lecture_tags && node.lecture_tags[0]) || 'General';
                  const colorScheme = lectureColorMap[primaryLecture] || LECTURE_COLORS[0];

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => handleSelectNode(node.id)}
                      style={{ cursor: 'pointer', opacity: isDimmed ? 0.18 : 1, transition: 'all 0.2s ease' }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-label={`${node.name}, ${node.lecture_tag}, ${node.studied ? 'studied' : 'not studied'}`}
                    >
                      {/* Node Capsule Pill */}
                      <rect
                        x="-100"
                        y="-30"
                        width="200"
                        height="60"
                        rx="16"
                        fill={isSelected ? '#9AE62E' : colorScheme.fill}
                        stroke={isSelected ? '#10140C' : colorScheme.border}
                        strokeWidth={isSelected ? 3 : 1.5}
                        className="kg-node-rect"
                        filter="drop-shadow(0 4px 12px rgba(16, 20, 12, 0.08))"
                      />

                      {/* Studied badge */}
                      {node.studied && (
                        <circle cx="85" cy="-20" r="8" fill="#6FC21A" />
                      )}

                      {/* Text Tag: Lecture Badge (color is never the only cue) */}
                      <text
                        x="-90"
                        y="-12"
                        fontSize="10"
                        fontWeight="700"
                        fill={isSelected ? '#10140C' : colorScheme.text}
                        letterSpacing="0.04em"
                      >
                        {node.lecture_tag.toUpperCase()}
                      </text>

                      {/* Concept Name */}
                      <text
                        x="-90"
                        y="12"
                        fontSize="13"
                        fontWeight="700"
                        fill="#10140C"
                        clipPath="inset(0 0 0 0)"
                      >
                        {node.name.length > 20 ? `${node.name.slice(0, 18)}…` : node.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Truncation warning if dataset > 80 nodes */}
            {graphData.truncated && (
              <div className="kg-truncation-pill">
                Showing top 80 of {graphData.total_nodes} concepts. Use search or lecture filter to drill down.
              </div>
            )}

            {/* Canvas Legend */}
            <div className="kg-legend-card" role="region" aria-label="Graph edge legend">
              <div className="kg-legend-title">LEGEND</div>
              <div className="kg-legend-item">
                <span className="kg-legend-line solid" />
                <span>Prerequisite (from notes)</span>
              </div>
              <div className="kg-legend-item">
                <span className="kg-legend-line dashed" />
                <span>Prerequisite (suggested)</span>
              </div>
              <div className="kg-legend-item">
                <span className="kg-legend-line dotted" />
                <span>Related across lectures</span>
              </div>
            </div>
          </div>
        ) : (
          /* Accessible Semantic List View */
          <div className="kg-list-view" role="region" aria-label="Concepts and Knowledge Links Table">
            <table className="kg-table">
              <thead>
                <tr>
                  <th>Concept Name</th>
                  <th>Appears In</th>
                  <th>Prerequisites (Depends On)</th>
                  <th>Required For</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredNodes.map(node => (
                  <tr key={node.id} className={selectedEntityId === node.id ? 'is-selected-row' : ''}>
                    <td>
                      <strong>{node.name}</strong>
                      {node.definition && <p className="kg-table-def">{node.definition}</p>}
                    </td>
                    <td>
                      <span className="kg-lecture-tag">{node.lecture_tag}</span>
                    </td>
                    <td>
                      {filteredEdges.filter(e => e.source === node.id).map(e => (
                        <span key={e.id} className={`kg-edge-pill ${e.origin}`}>
                          {graphData.nodes.find(n => n.id === e.target)?.name || 'Concept'}
                        </span>
                      ))}
                    </td>
                    <td>
                      {filteredEdges.filter(e => e.target === node.id).map(e => (
                        <span key={e.id} className={`kg-edge-pill ${e.origin}`}>
                          {graphData.nodes.find(n => n.id === e.source)?.name || 'Concept'}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={`kg-status-chip ${node.studied ? 'studied' : 'unstudied'}`}>
                        {node.studied ? 'Studied' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleSelectNode(node.id)}
                        className="kg-inspect-btn"
                        aria-label={`Inspect ${node.name}`}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 2. Side Panel / Bottom Sheet */}
        {selectedEntityId && (
          <aside className="kg-side-panel" aria-label="Selected Concept Knowledge Detail">
            <div className="kg-panel-header">
              <div className="kg-panel-title-wrap">
                <span className="kg-panel-eyebrow">SELECTED CONCEPT</span>
                <h3 className="kg-panel-title">{entityDetail?.name || 'Loading concept…'}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntityId(null)}
                className="kg-close-btn"
                aria-label="Close concept details"
              >
                <X size={16} />
              </button>
            </div>

            {isDetailLoading ? (
              <div className="kg-panel-loading">
                <BookshelfLoader message="Fetching citations & connections…" />
              </div>
            ) : entityDetail ? (
              <div className="kg-panel-body">
                {/* Definition */}
                {entityDetail.definition && (
                  <div className="kg-panel-section">
                    <label className="kg-section-label">DEFINITION</label>
                    <p className="kg-definition-text">{entityDetail.definition}</p>
                  </div>
                )}

                {/* Where it appears (Lecture & Page chips that open PDF Viewer) */}
                <div className="kg-panel-section">
                  <label className="kg-section-label">APPEARS IN YOUR NOTES</label>
                  <div className="kg-mentions-list">
                    {entityDetail.mentions?.map((m, idx) => (
                      <div key={idx} className="kg-mention-card">
                        <div className="kg-mention-top">
                          <BookOpen size={13} className="kg-doc-icon" />
                          <span className="kg-doc-filename" title={m.filename}>{m.filename}</span>
                          <span className="kg-page-badge">p. {m.page}</span>
                        </div>
                        {m.quote && <blockquote className="kg-mention-quote">"{m.quote}"</blockquote>}
                        {onOpenViewer && (
                          <button
                            type="button"
                            className="kg-open-pdf-btn"
                            onClick={() => onOpenViewer(m.document_id, m.page, m.quote)}
                            aria-label={`Open ${m.filename} at page ${m.page}`}
                          >
                            <ExternalLink size={12} />
                            <span>Open in PDF viewer (p. {m.page})</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Depends on (Prerequisites with evidence badges) */}
                <div className="kg-panel-section">
                  <label className="kg-section-label">DEPENDS ON (PREREQUISITES)</label>
                  {entityDetail.depends_on?.length > 0 ? (
                    <div className="kg-relations-list">
                      {entityDetail.depends_on.map((dep, idx) => (
                        <div key={idx} className="kg-relation-item">
                          <button
                            type="button"
                            className="kg-rel-name-btn"
                            onClick={() => handleSelectNode(dep.entity_id)}
                          >
                            {dep.name}
                          </button>
                          <span className={`kg-evidence-badge ${dep.origin}`}>
                            {dep.origin === 'notes' ? 'From your notes' : 'Suggested link'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="kg-empty-note">Foundational concept with no prior prerequisites.</p>
                  )}
                </div>

                {/* Needed for (Dependents) */}
                <div className="kg-panel-section">
                  <label className="kg-section-label">NEEDED FOR (UNLOCKS)</label>
                  {entityDetail.needed_for?.length > 0 ? (
                    <div className="kg-relations-list">
                      {entityDetail.needed_for.map((dep, idx) => (
                        <div key={idx} className="kg-relation-item">
                          <button
                            type="button"
                            className="kg-rel-name-btn"
                            onClick={() => handleSelectNode(dep.entity_id)}
                          >
                            {dep.name}
                          </button>
                          <span className={`kg-evidence-badge ${dep.origin}`}>
                            {dep.origin === 'notes' ? 'From your notes' : 'Suggested link'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="kg-empty-note">Advanced concept or endpoint of current path.</p>
                  )}
                </div>

                {/* Ask about concept action */}
                <div className="kg-panel-actions">
                  <button
                    type="button"
                    className="kg-ask-btn"
                    onClick={() => onAskAboutConcept(entityDetail.name)}
                    aria-label={`Ask your notes about ${entityDetail.name}`}
                  >
                    <Sparkles size={14} />
                    <span>Ask your notes about {entityDetail.name}</span>
                  </button>

                  {/* Unmerge button if concept has multiple mentions */}
                  {entityDetail.mentions?.length > 1 && (
                    <button
                      type="button"
                      className="kg-unmerge-btn"
                      onClick={() => handleUnmerge(entityDetail.id)}
                      title="Split this entity back into distinct concepts per lecture"
                      aria-label="Unmerge concept"
                    >
                      <Split size={14} />
                      <span>Unmerge into separate concepts</span>
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </aside>
        )}
      </div>

      {/* 3. Concept Links to Review Modal */}
      {isMergeModalOpen && (
        <div className="kg-modal-scrim" onClick={() => setIsMergeModalOpen(false)}>
          <div className="kg-merge-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Review Concept Merge Suggestions">
            <div className="kg-modal-header">
              <div className="kg-modal-title-group">
                <Split size={18} className="kg-brand-icon" />
                <h3>Concept Links to Review</h3>
              </div>
              <button type="button" onClick={() => setIsMergeModalOpen(false)} aria-label="Close review dialog">
                <X size={16} />
              </button>
            </div>
            <p className="kg-modal-desc">
              ConceptLens detected similar concepts across your uploaded lectures. Confirm whether they represent the same academic idea or distinct topics.
            </p>
            <div className="kg-suggestions-list">
              {mergeSuggestions.map(s => (
                <div key={s.id} className="kg-sugg-card">
                  <div className="kg-sugg-comparison">
                    <div className="kg-sugg-side">
                      <span className="kg-sugg-tag">CONCEPT A</span>
                      <strong>{s.entity_a.name}</strong>
                      <p>{s.entity_a.definition || 'No definition recorded'}</p>
                    </div>
                    <div className="kg-sugg-vs">
                      <ArrowRight size={16} />
                      <span className="kg-score-badge">{(s.score * 100).toFixed(0)}% match</span>
                    </div>
                    <div className="kg-sugg-side">
                      <span className="kg-sugg-tag">CONCEPT B</span>
                      <strong>{s.entity_b.name}</strong>
                      <p>{s.entity_b.definition || 'No definition recorded'}</p>
                    </div>
                  </div>
                  <div className="kg-sugg-actions">
                    <button
                      type="button"
                      className="kg-btn-accept"
                      onClick={() => handleAcceptMerge(s.id)}
                    >
                      <Check size={14} />
                      <span>Merge as same concept</span>
                    </button>
                    <button
                      type="button"
                      className="kg-btn-reject"
                      onClick={() => handleRejectMerge(s.id)}
                    >
                      <X size={14} />
                      <span>Not the same</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
