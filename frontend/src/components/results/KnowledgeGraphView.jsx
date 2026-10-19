import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  List,
  BookOpen,
  Sparkles,
  Layers,
  X,
  ExternalLink,
  Compass,
  Cpu,
  Brain,
  Database,
  Sliders,
  Code2,
  Workflow
} from 'lucide-react';
import {
  fetchKnowledgeGraph,
  fetchEntityDetail,
  fetchMergeSuggestions
} from '../../api/client';
import BookshelfLoader from '../ui/BookshelfLoader';

// Dynamic concept icons based on name/topic keywords
function getConceptIcon(name = '', type = 'concept') {
  const n = (name || '').toLowerCase();
  if (type === 'root') return BookOpen;
  if (type === 'topic') return Layers;
  if (n.includes('model') || n.includes('train') || n.includes('learn')) return Cpu;
  if (n.includes('data') || n.includes('dataset') || n.includes('corpus')) return Database;
  if (n.includes('algorithm') || n.includes('code') || n.includes('function')) return Code2;
  if (n.includes('parameter') || n.includes('weight') || n.includes('eval')) return Sliders;
  if (n.includes('process') || n.includes('pipeline') || n.includes('flow')) return Workflow;
  return Brain;
}

// Generate deterministic relationship label for leaf connector
function getRelationshipLabel(conceptName = '', topicName = '', index = 0) {
  const n = (conceptName || '').toLowerCase();
  if (n.includes('type') || n.includes('supervised') || n.includes('unsupervised')) return 'type-of';
  if (n.includes('train') || n.includes('process') || n.includes('build')) return 'built-with';
  if (n.includes('eval') || n.includes('loss') || n.includes('metric')) return 'measures';
  if (n.includes('prereq') || n.includes('foundat') || n.includes('require')) return 'requires';
  if (n.includes('use') || n.includes('data') || n.includes('vector')) return 'uses';
  if (n.includes('is a') || n.includes('class')) return 'is-a';
  const defaults = ['part-of', 'uses', 'built-with', 'type-of', 'requires'];
  return defaults[index % defaults.length];
}

export default function KnowledgeGraphView({
  documentId = null,
  documentTitle = 'Course Notes',
  initialSelectedId = null,
  concepts = [],
  onSelectConcept = () => {},
  onOpenViewer = null,
  onAskAboutConcept = () => {},
  isAuthenticated = true
}) {
  // Graph API data
  const [graphData, setGraphData] = useState({
    nodes: [],
    edges: [],
    total_nodes: 0,
    total_edges: 0,
    truncated: false,
    merge_suggestions_count: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  // Link edge toggles
  const [showNotesLinks, setShowNotesLinks] = useState(false);
  const [showSuggestedLinks, setShowSuggestedLinks] = useState(false);
  const [showCrossTopicLinks, setShowCrossTopicLinks] = useState(false);

  // Layout & View modes
  const [viewMode, setViewMode] = useState('canvas'); // 'canvas' | 'list'
  const [isOverviewMode, setIsOverviewMode] = useState(false); // topics only
  const [expandedTopics, setExpandedTopics] = useState(new Set());
  const [isIndexOpen, setIsIndexOpen] = useState(false); // "All topics" sliding panel
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Focus & Selection
  const [selectedNodeId, setSelectedNodeId] = useState(initialSelectedId);
  const [entityDetail, setEntityDetail] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Canvas pan & zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.95 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const touchStartRef = useRef(null);

  // 1. Fetch graph data from backend
  const loadGraph = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchKnowledgeGraph({
        scope: documentId ? 'document' : 'all',
        documentId: documentId,
        origin: 'all',
        limit: 120
      });
      setGraphData(data);
    } catch (err) {
      console.warn('KnowledgeGraphView: fetchKnowledgeGraph failed, falling back to local concepts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Load merge suggestions if authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchMergeSuggestions().catch(() => {});
    }
  }, [isAuthenticated]);

  // 2. Harmonize data into Topics and Concepts
  const { allTopicList, allConceptNodes, rootNode } = useMemo(() => {
    // If backend nodes exist, create a lookup map
    const backendNodeMap = new Map();
    (graphData.nodes || []).forEach(n => backendNodeMap.set(n.id, n));

    // Consolidate concepts from displayConcepts prop + backend nodes
    const conceptPool = new Map();

    // From displayConcepts prop
    (concepts || []).forEach((c, idx) => {
      const id = c.id || `c-${idx}`;
      conceptPool.set(id, {
        id,
        name: c.name,
        definition: c.definition || '',
        page: c.page || 1,
        pages: c.pages || (c.page ? [c.page] : [1]),
        chapter: c.chapter || 'Core Concepts',
        importance: c.importance || 2,
        studied: !!c.studied,
        quote: c.source_quote || c.quote || '',
        prerequisites: c.prerequisites || [],
        related: c.related || []
      });
    });

    // Augment with backend graph nodes if present
    (graphData.nodes || []).forEach(n => {
      const existing = conceptPool.get(n.id);
      const primaryDoc = n.documents && n.documents[0];
      const page = primaryDoc?.page || 1;
      const pages = n.documents ? [...new Set(n.documents.map(d => d.page))].filter(Boolean) : [page];
      const chapter = (n.lecture_tags && n.lecture_tags[0]) || n.lecture_tag || 'Core Concepts';

      if (existing) {
        if (!existing.definition && n.definition) existing.definition = n.definition;
        if (n.studied) existing.studied = true;
        if (pages.length > existing.pages.length) existing.pages = pages;
      } else {
        conceptPool.set(n.id, {
          id: n.id,
          name: n.name,
          definition: n.definition || '',
          page: page,
          pages: pages.length ? pages : [1],
          chapter: chapter,
          importance: 2,
          studied: !!n.studied,
          quote: primaryDoc?.quote || '',
          prerequisites: [],
          related: []
        });
      }
    });

    // Group into Topics
    const groups = new Map();
    conceptPool.forEach(c => {
      const topicKey = c.chapter || 'Core Concepts';
      if (!groups.has(topicKey)) {
        groups.set(topicKey, []);
      }
      groups.get(topicKey).push(c);
    });

    // Build topics array
    const topics = Array.from(groups.entries()).map(([topicName, cList], idx) => {
      const topicId = `topic-${idx}-${topicName.replace(/[^a-zA-Z0-9]/g, '_')}`;
      // Sort concepts stably by page then importance
      const sortedConcepts = [...cList].sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        return (b.importance || 2) - (a.importance || 2);
      });
      return {
        id: topicId,
        name: topicName,
        concepts: sortedConcepts,
        count: sortedConcepts.length
      };
    });

    // If no topics exist, create a fallback
    if (topics.length === 0) {
      topics.push({
        id: 'topic-default',
        name: 'General Concepts',
        concepts: [],
        count: 0
      });
    }

    const cleanTitle = documentTitle ? documentTitle.replace(/\.pdf$/i, '') : 'Course Notes';
    const root = {
      id: '__doc_root__',
      name: cleanTitle,
      type: 'root'
    };

    return {
      topicMap: groups,
      allTopicList: topics,
      allConceptNodes: Array.from(conceptPool.values()),
      rootNode: root
    };
  }, [concepts, graphData.nodes, documentTitle]);

  // Initial topic expansion: expand all topics if total concepts <= 80, else top 3
  useEffect(() => {
    if (allTopicList.length > 0 && expandedTopics.size === 0) {
      const initial = new Set();
      if (allConceptNodes.length <= 80) {
        allTopicList.forEach(t => initial.add(t.id));
      } else {
        allTopicList.slice(0, 3).forEach(t => initial.add(t.id));
      }
      setExpandedTopics(initial);
    }
  }, [allTopicList, allConceptNodes.length]);

  // Toggle individual topic expansion
  const toggleTopicExpand = (topicId) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const next = new Set(allTopicList.map(t => t.id));
    setExpandedTopics(next);
    setIsOverviewMode(false);
  };

  const handleCollapseAll = () => {
    setExpandedTopics(new Set());
    setIsOverviewMode(true);
  };

  // 3. Compute Deterministic Layout Coordinates (Stable, 0 collisions, Math-based)
  const layout = useMemo(() => {
    const nodes = {};
    const structuralEdges = [];
    const N_topics = allTopicList.length;

    // Center root node at (0, 0)
    nodes[rootNode.id] = {
      id: rootNode.id,
      name: rootNode.name,
      type: 'root',
      x: 0,
      y: 0,
      width: 220,
      height: 64
    };

    if (N_topics === 0) {
      return { nodes, structuralEdges, minX: -200, maxX: 200, minY: -100, maxY: 100 };
    }

    // Radial distance for topic nodes from center: scales smoothly with topic count
    const R_topic = Math.max(280, 52 * N_topics);

    allTopicList.forEach((topic, tIdx) => {
      // Symmetrical angles starting from -PI/2 (top)
      const angle = (2 * Math.PI * tIdx) / N_topics - Math.PI / 2;
      const tx = Math.round(R_topic * Math.cos(angle));
      const ty = Math.round(R_topic * Math.sin(angle));

      const isExpanded = !isOverviewMode && expandedTopics.has(topic.id);

      nodes[topic.id] = {
        id: topic.id,
        name: topic.name,
        type: 'topic',
        x: tx,
        y: ty,
        width: 190,
        height: 52,
        count: topic.count,
        isExpanded,
        angle
      };

      // Root -> Topic structural branch
      structuralEdges.push({
        id: `branch-root-${topic.id}`,
        source: rootNode.id,
        target: topic.id,
        label: 'part-of',
        sx: 0,
        sy: 0,
        tx,
        ty
      });

      // If topic is expanded, position concept leaves branching outward
      if (isExpanded && topic.concepts.length > 0) {
        const K = topic.concepts.length;
        // Directional fan parameters
        const fanSpan = Math.min(1.4, 0.22 * K);

        topic.concepts.forEach((concept, cIdx) => {
          let leafAngle = angle;
          if (K > 1) {
            leafAngle = angle - fanSpan / 2 + (cIdx / (K - 1)) * fanSpan;
          }

          // Stagger distance alternately to prevent label overlap
          const R_leaf = R_topic + 210 + (cIdx % 2 === 0 ? 0 : 90);
          const cx = Math.round(R_leaf * Math.cos(leafAngle));
          const cy = Math.round(R_leaf * Math.sin(leafAngle));

          nodes[concept.id] = {
            id: concept.id,
            name: concept.name,
            definition: concept.definition,
            page: concept.page,
            pages: concept.pages,
            chapter: concept.chapter,
            importance: concept.importance,
            studied: concept.studied,
            quote: concept.quote,
            type: 'concept',
            topicId: topic.id,
            x: cx,
            y: cy,
            width: 175,
            height: 46
          };

          const relLabel = getRelationshipLabel(concept.name, topic.name, cIdx);

          structuralEdges.push({
            id: `branch-${topic.id}-${concept.id}`,
            source: topic.id,
            target: concept.id,
            label: relLabel,
            sx: tx,
            sy: ty,
            tx: cx,
            ty: cy
          });
        });
      }
    });

    // Compute bounding box for fitToView
    let minX = -300, maxX = 300, minY = -200, maxY = 200;
    Object.values(nodes).forEach(n => {
      minX = Math.min(minX, n.x - n.width / 2 - 40);
      maxX = Math.max(maxX, n.x + n.width / 2 + 40);
      minY = Math.min(minY, n.y - n.height / 2 - 40);
      maxY = Math.max(maxY, n.y + n.height / 2 + 40);
    });

    return { nodes, structuralEdges, minX, maxX, minY, maxY };
  }, [allTopicList, rootNode, expandedTopics, isOverviewMode]);

  // 4. Prerequisite & Cross-topic edges
  const prerequisiteEdges = useMemo(() => {
    const list = [];
    const nodeMap = layout.nodes;

    // Backend edges
    (graphData.edges || []).forEach(e => {
      const sNode = nodeMap[e.source];
      const tNode = nodeMap[e.target];
      if (sNode && tNode) {
        const isCrossTopic = sNode.topicId && tNode.topicId && sNode.topicId !== tNode.topicId;
        list.push({
          id: e.id,
          source: e.source,
          target: e.target,
          origin: e.origin,
          type: e.type,
          isCrossTopic,
          sx: sNode.x,
          sy: sNode.y,
          tx: tNode.x,
          ty: tNode.y
        });
      }
    });

    // Complement with local concept prerequisites if backend edges not yet available
    if (list.length === 0) {
      const nameToId = new Map();
      allConceptNodes.forEach(c => {
        const cName = typeof c?.name === 'string' ? c.name : (c?.name?.name || '');
        if (cName) {
          nameToId.set(cName.toLowerCase().trim(), c.id);
        }
      });

      allConceptNodes.forEach(c => {
        (c.prerequisites || []).forEach((pName, pIdx) => {
          const pStr = typeof pName === 'string' ? pName : (pName?.name || pName?.concept || '');
          if (!pStr) return;
          const targetId = nameToId.get(pStr.toLowerCase().trim());
          if (targetId && targetId !== c.id) {
            const sNode = nodeMap[c.id];
            const tNode = nodeMap[targetId];
            if (sNode && tNode) {
              const isCrossTopic = sNode.topicId && tNode.topicId && sNode.topicId !== tNode.topicId;
              list.push({
                id: `prereq-${c.id}-${targetId}-${pIdx}`,
                source: c.id,
                target: targetId,
                origin: 'notes',
                type: 'prerequisite',
                isCrossTopic,
                sx: sNode.x,
                sy: sNode.y,
                tx: tNode.x,
                ty: tNode.y
              });
            }
          }
        });
      });
    }

    return list;
  }, [graphData.edges, layout.nodes, allConceptNodes]);

  // Edges to display: structural branches + toggled prerequisite links + active selection links
  const visiblePrereqEdges = useMemo(() => {
    return prerequisiteEdges.filter(e => {
      // If connected to currently selected node, always visible!
      if (selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId)) {
        return true;
      }
      if (e.isCrossTopic && showCrossTopicLinks) return true;
      if (e.origin === 'notes' && showNotesLinks) return true;
      if (e.origin === 'suggested' && showSuggestedLinks) return true;
      return false;
    });
  }, [prerequisiteEdges, selectedNodeId, showNotesLinks, showSuggestedLinks, showCrossTopicLinks]);

  // Load detailed entity info when a node is selected
  useEffect(() => {
    if (!selectedNodeId || selectedNodeId === rootNode.id) {
      setEntityDetail(null);
      return;
    }

    const localConcept = allConceptNodes.find(c => c.id === selectedNodeId);
    let isCurrent = true;
    setIsDetailLoading(true);

    fetchEntityDetail(selectedNodeId)
      .then(detail => {
        if (isCurrent) setEntityDetail(detail);
      })
      .catch(() => {
        if (isCurrent && localConcept) {
          // Synthetic detail from local concept
          setEntityDetail({
            id: localConcept.id,
            name: localConcept.name,
            definition: localConcept.definition,
            chapter: localConcept.chapter,
            studied: localConcept.studied,
            mentions: (localConcept.pages || [localConcept.page]).map(p => ({
              document_id: documentId,
              filename: documentTitle,
              page: p,
              quote: localConcept.quote
            })),
            depends_on: (localConcept.prerequisites || []).map(p => ({
              name: p,
              origin: 'notes'
            })),
            needed_for: []
          });
        }
      })
      .finally(() => {
        if (isCurrent) setIsDetailLoading(false);
      });

    return () => { isCurrent = false; };
  }, [selectedNodeId, rootNode.id, allConceptNodes, documentId, documentTitle]);

  // Fit to view smoothly
  const handleFitToView = useCallback(() => {
    if (!canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;

    const spanX = layout.maxX - layout.minX;
    const spanY = layout.maxY - layout.minY;
    const scale = Math.max(0.3, Math.min(1.2, Math.min((w - 100) / spanX, (h - 100) / spanY)));
    const midX = (layout.minX + layout.maxX) / 2;
    const midY = (layout.minY + layout.maxY) / 2;

    setTransform({
      x: w / 2 - midX * scale,
      y: h / 2 - midY * scale,
      k: scale
    });
  }, [layout]);

  // Auto-fit on initial render once topics are ready
  useEffect(() => {
    const timer = setTimeout(() => {
      handleFitToView();
    }, 150);
    return () => clearTimeout(timer);
  }, [handleFitToView]);

  // Zoom controls
  const handleZoomIn = () => setTransform(t => ({ ...t, k: Math.min(2.5, t.k * 1.25) }));
  const handleZoomOut = () => setTransform(t => ({ ...t, k: Math.max(0.25, t.k * 0.8) }));

  // Mouse pan handlers
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

  // Wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    setTransform(prev => ({
      ...prev,
      k: Math.max(0.25, Math.min(2.5, prev.k * zoomFactor))
    }));
  };

  // Two-finger touch handlers for mobile to prevent scroll-trapping!
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      // 2 fingers: pinch or pan graph
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      touchStartRef.current = { dist, midX, midY, transform: { ...transform } };
    } else if (e.touches.length === 1) {
      // 1 finger: allow normal page scroll, show brief hint if dragged inside canvas
      touchStartRef.current = null;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchStartRef.current) {
      e.preventDefault(); // Only prevent default when 2 fingers are touching!
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const currentMidX = (t1.clientX + t2.clientX) / 2;
      const currentMidY = (t1.clientY + t2.clientY) / 2;

      const scaleChange = currentDist / touchStartRef.current.dist;
      const newK = Math.max(0.25, Math.min(2.5, touchStartRef.current.transform.k * scaleChange));
      const dx = currentMidX - touchStartRef.current.midX;
      const dy = currentMidY - touchStartRef.current.midY;

      setTransform({
        x: touchStartRef.current.transform.x + dx,
        y: touchStartRef.current.transform.y + dy,
        k: newK
      });
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // Select node handler
  const handleSelectNode = (nodeId) => {
    if (nodeId === rootNode.id) {
      setSelectedNodeId(null);
      return;
    }
    setSelectedNodeId(nodeId);
    const nodeObj = layout.nodes[nodeId];
    if (nodeObj && nodeObj.type === 'concept') {
      onSelectConcept({ id: nodeId, name: nodeObj.name });
    }
  };

  // Focus and center on a specific topic from index
  const handleFocusTopic = (topicId) => {
    const topicNode = layout.nodes[topicId];
    if (!topicNode) return;

    // Ensure expanded
    setExpandedTopics(prev => new Set(prev).add(topicId));
    setIsOverviewMode(false);
    setSelectedNodeId(topicId);

    if (canvasContainerRef.current) {
      const rect = canvasContainerRef.current.getBoundingClientRect();
      const targetScale = Math.max(0.85, transform.k);
      setTransform({
        x: (rect.width || 800) / 2 - topicNode.x * targetScale,
        y: (rect.height || 600) / 2 - topicNode.y * targetScale,
        k: targetScale
      });
    }
  };

  // Search filter
  const isSearchMatch = (node) => {
    if (!searchQuery.trim()) return false;
    const q = searchQuery.toLowerCase().trim();
    return (node.name || '').toLowerCase().includes(q) ||
           (node.definition || '').toLowerCase().includes(q);
  };

  if (isLoading && allConceptNodes.length === 0) {
    return (
      <div className="kg-loader-wrap" style={{ minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BookshelfLoader message="Synthesizing topic map and concept hierarchy..." />
      </div>
    );
  }

  // Count relationships breakdown for selected concept
  const selectedRelationsCount = useMemo(() => {
    if (!selectedNodeId) return null;
    const incoming = prerequisiteEdges.filter(e => e.target === selectedNodeId);
    const outgoing = prerequisiteEdges.filter(e => e.source === selectedNodeId);
    const total = incoming.length + outgoing.length;

    const breakdown = {
      'part-of': 1,
      'requires': incoming.length,
      'unlocks': outgoing.length,
      'cross-topic': incoming.filter(e => e.isCrossTopic).length + outgoing.filter(e => e.isCrossTopic).length
    };
    return { total, breakdown, incoming, outgoing };
  }, [selectedNodeId, prerequisiteEdges]);

  return (
    <div
      className={`kg-container ${isFullscreen ? 'is-fullscreen' : ''}`}
      tabIndex={0}
      role="region"
      aria-label="ConceptLens Interactive Topic Map"
    >
      {/* 1. Header Toolbar */}
      <div className="kg-toolbar" role="toolbar" aria-label="Topic map controls">
        <div className="kg-toolbar-left">
          {/* Index Toggle */}
          <button
            type="button"
            className={`kg-pill-btn ${isIndexOpen ? 'active' : ''}`}
            onClick={() => setIsIndexOpen(o => !o)}
            title="Open index of all chapters and topics"
            aria-label="All topics index"
          >
            <Layers size={14} />
            <span>All topics ({allTopicList.length})</span>
          </button>

          {/* Overview Mode Toggle */}
          <button
            type="button"
            className={`kg-pill-btn ${isOverviewMode ? 'active' : ''}`}
            onClick={() => {
              if (isOverviewMode) {
                handleExpandAll();
              } else {
                handleCollapseAll();
              }
            }}
            title="Toggle topics overview mode"
            aria-label="Toggle overview mode"
          >
            <Compass size={14} />
            <span>{isOverviewMode ? 'Expand all' : 'Overview (Topics only)'}</span>
          </button>

          {/* Search bar */}
          <div className="kg-search-wrap">
            <Search size={13} className="kg-search-icon" />
            <input
              type="text"
              placeholder="Search concepts or topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="kg-search-input"
              aria-label="Search concepts in topic map"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="kg-search-clear"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="kg-toolbar-right">
          {/* Edge Toggles */}
          <div className="kg-edge-toggles" role="group" aria-label="Link visibility toggles">
            <button
              type="button"
              className={`kg-filter-chip ${showNotesLinks ? 'active' : ''}`}
              onClick={() => setShowNotesLinks(v => !v)}
              title="Toggle prerequisite links cited in your notes"
            >
              Notes links
            </button>
            <button
              type="button"
              className={`kg-filter-chip ${showSuggestedLinks ? 'active' : ''}`}
              onClick={() => setShowSuggestedLinks(v => !v)}
              title="Toggle suggested prerequisite links"
            >
              Suggested
            </button>
            <button
              type="button"
              className={`kg-filter-chip ${showCrossTopicLinks ? 'active' : ''}`}
              onClick={() => setShowCrossTopicLinks(v => !v)}
              title="Toggle links that connect across different topics"
            >
              Cross-topic
            </button>
          </div>

          {/* View as list button */}
          <button
            type="button"
            className={`kg-action-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode(m => m === 'canvas' ? 'list' : 'canvas')}
            title="Toggle accessible list view"
            aria-label="View as list"
          >
            <List size={14} />
            <span className="hide-on-mobile">{viewMode === 'list' ? 'Topic Map' : 'View as list'}</span>
          </button>

          {/* Zoom controls & Fit to view */}
          <div className="kg-zoom-group">
            <button type="button" onClick={handleFitToView} className="kg-zoom-btn" title="Fit to view" aria-label="Fit to view">
              <RotateCcw size={13} />
            </button>
            <button type="button" onClick={handleZoomIn} className="kg-zoom-btn" title="Zoom in" aria-label="Zoom in">
              <ZoomIn size={14} />
            </button>
            <button type="button" onClick={handleZoomOut} className="kg-zoom-btn" title="Zoom out" aria-label="Zoom out">
              <ZoomOut size={14} />
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

      {/* Main Workspace Layout */}
      <div className="kg-workspace">
        {/* A. "All Topics" Index Sliding Panel */}
        {isIndexOpen && (
          <aside className="kg-all-topics-index-panel" aria-label="All topics index">
            <div className="index-panel-header">
              <div className="index-panel-title">
                <Layers size={15} className="index-panel-icon" />
                <span>All Topics</span>
              </div>
              <button
                type="button"
                onClick={() => setIsIndexOpen(false)}
                className="index-close-btn"
                aria-label="Close index"
              >
                <X size={15} />
              </button>
            </div>
            <div className="index-topics-list">
              {allTopicList.map((t, idx) => (
                <div
                  key={t.id}
                  className={`index-topic-row ${selectedNodeId === t.id ? 'is-active' : ''}`}
                  onClick={() => handleFocusTopic(t.id)}
                >
                  <div className="index-topic-info">
                    <span className="index-topic-number">{idx + 1}</span>
                    <span className="index-topic-name">{t.name}</span>
                  </div>
                  <span className="index-topic-count">{t.count}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* B. Canvas Viewport or Accessible List */}
        {viewMode === 'canvas' ? (
          <div
            ref={canvasContainerRef}
            className="kg-canvas-viewport"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <svg
              ref={svgRef}
              className="kg-svg-stage"
              width="100%"
              height="100%"
              aria-label="Interactive Topic Map Canvas"
            >
              <defs>
                {/* Arrow markers for prerequisite paths */}
                <marker
                  id="arrow-lime"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#9AE62E" />
                </marker>
                <marker
                  id="arrow-amber"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#F59E0B" />
                </marker>
                {/* Filter glow for active/selected nodes */}
                <filter id="lime-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                {/* 1. Structural Curved Branch Lines (Doc -> Topic, Topic -> Concept) */}
                {layout.structuralEdges.map(edge => {
                  const sNode = layout.nodes[edge.source];
                  const tNode = layout.nodes[edge.target];
                  if (!sNode || !tNode) return null;

                  // Smooth cubic Bézier control points
                  const midX = (edge.sx + edge.tx) / 2;
                  const midY = (edge.sy + edge.ty) / 2;
                  const cp1x = edge.sx + (edge.tx - edge.sx) * 0.45;
                  const cp1y = edge.sy + (edge.ty - edge.sy) * 0.1;
                  const cp2x = edge.sx + (edge.tx - edge.sx) * 0.55;
                  const cp2y = edge.ty - (edge.ty - edge.sy) * 0.1;

                  const isEdgeActive = selectedNodeId === edge.target || selectedNodeId === edge.source;

                  return (
                    <g key={edge.id} className="kg-structural-branch">
                      <path
                        d={`M ${edge.sx} ${edge.sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${edge.tx} ${edge.ty}`}
                        fill="none"
                        stroke={isEdgeActive ? '#9AE62E' : 'rgba(154, 230, 46, 0.45)'}
                        strokeWidth={isEdgeActive ? 2.5 : 1.6}
                        strokeLinecap="round"
                      />
                      {/* Relationship Pill Badge along the curved branch */}
                      {edge.label && (
                        <g transform={`translate(${midX}, ${midY})`}>
                          <rect
                            x="-32"
                            y="-10"
                            width="64"
                            height="20"
                            rx="10"
                            fill="#0E170C"
                            stroke={isEdgeActive ? '#9AE62E' : 'rgba(154, 230, 46, 0.35)'}
                            strokeWidth="1"
                          />
                          <text
                            x="0"
                            y="3"
                            textAnchor="middle"
                            fill="#9AE62E"
                            fontSize="9"
                            fontWeight="800"
                            letterSpacing="0.04em"
                          >
                            {edge.label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* 2. Prerequisite & Cross-topic Links */}
                {visiblePrereqEdges.map(edge => {
                  const sNode = layout.nodes[edge.source];
                  const tNode = layout.nodes[edge.target];
                  if (!sNode || !tNode) return null;

                  const isIncomingToSelected = selectedNodeId === edge.target;
                  const isOutgoingFromSelected = selectedNodeId === edge.source;
                  const isDirectlySelected = isIncomingToSelected || isOutgoingFromSelected;

                  const midX = (sNode.x + tNode.x) / 2;
                  const midY = (sNode.y + tNode.y) / 2 - 30;

                  let stroke = isIncomingToSelected ? '#F59E0B' : (isOutgoingFromSelected ? '#9AE62E' : 'rgba(154, 230, 46, 0.35)');
                  let marker = isIncomingToSelected ? 'url(#arrow-amber)' : 'url(#arrow-lime)';

                  return (
                    <g key={edge.id} className="kg-prereq-link">
                      <path
                        d={`M ${sNode.x} ${sNode.y} Q ${midX} ${midY} ${tNode.x} ${tNode.y}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isDirectlySelected ? 2.8 : 1.4}
                        strokeDasharray={edge.origin === 'suggested' ? '5,4' : 'none'}
                        markerEnd={marker}
                        opacity={isDirectlySelected ? 1 : 0.65}
                      />
                      {isDirectlySelected && (
                        <g transform={`translate(${midX}, ${midY})`}>
                          <rect
                            x="-38"
                            y="-9"
                            width="76"
                            height="18"
                            rx="9"
                            fill="#0E170C"
                            stroke={stroke}
                            strokeWidth="1"
                          />
                          <text
                            x="0"
                            y="3.5"
                            textAnchor="middle"
                            fill={stroke}
                            fontSize="9"
                            fontWeight="800"
                          >
                            {isIncomingToSelected ? 'depends on' : 'needed for'}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* 3. Render Nodes (Document Root, Topics, Concepts) */}
                {Object.values(layout.nodes).map(node => {
                  const isSelected = selectedNodeId === node.id;
                  const isSearched = isSearchMatch(node);
                  const isDimmed = searchQuery.trim() && !isSearched;
                  const IconComponent = getConceptIcon(node.name, node.type);

                  // A. Central Root Node
                  if (node.type === 'root') {
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={() => handleSelectNode(node.id)}
                        style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                        role="button"
                        aria-label={`Document: ${node.name}`}
                      >
                        <rect
                          x={-node.width / 2}
                          y={-node.height / 2}
                          width={node.width}
                          height={node.height}
                          rx="18"
                          fill="#101B0D"
                          stroke="#9AE62E"
                          strokeWidth="2.5"
                          filter="url(#lime-glow)"
                        />
                        {/* Book Icon circle */}
                        <circle cx={-node.width / 2 + 28} cy="0" r="16" fill="rgba(154, 230, 46, 0.18)" stroke="#9AE62E" strokeWidth="1.2" />
                        <BookOpen x={-node.width / 2 + 20} y={-8} size={16} color="#9AE62E" />
                        {/* Document Title */}
                        <text
                          x={-node.width / 2 + 52}
                          y="5"
                          fill="#FFFFFF"
                          fontSize="14"
                          fontWeight="800"
                          letterSpacing="0.02em"
                        >
                          {(node.name || 'Document').length > 18 ? `${(node.name || 'Document').slice(0, 16)}…` : (node.name || 'Document')}
                        </text>
                      </g>
                    );
                  }

                  // B. Topic Branch Nodes
                  if (node.type === 'topic') {
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={() => handleSelectNode(node.id)}
                        style={{
                          cursor: 'pointer',
                          opacity: isDimmed ? 0.25 : 1,
                          transition: 'all 0.2s ease'
                        }}
                        role="button"
                        aria-label={`Topic: ${node.name || 'Topic'}, ${node.count || 0} concepts`}
                      >
                        <rect
                          x={-node.width / 2}
                          y={-node.height / 2}
                          width={node.width}
                          height={node.height}
                          rx="14"
                          fill="#121F0F"
                          stroke={isSelected || isSearched ? '#9AE62E' : 'rgba(154, 230, 46, 0.45)'}
                          strokeWidth={isSelected ? 2.5 : 1.5}
                          filter={isSelected || isSearched ? 'url(#lime-glow)' : 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))'}
                        />
                        {/* Topic Icon */}
                        <Layers x={-node.width / 2 + 14} y={-8} size={16} color="#9AE62E" />
                        {/* Topic Name */}
                        <text
                          x={-node.width / 2 + 36}
                          y="4"
                          fill="#FFFFFF"
                          fontSize="13"
                          fontWeight="700"
                        >
                          {(node.name || 'Topic').length > 14 ? `${(node.name || 'Topic').slice(0, 13)}…` : (node.name || 'Topic')}
                        </text>
                        {/* Expand/Collapse count pill */}
                        <g
                          transform={`translate(${node.width / 2 - 24}, 0)`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTopicExpand(node.id);
                          }}
                        >
                          <circle cx="0" cy="0" r="11" fill="rgba(154, 230, 46, 0.2)" stroke="#9AE62E" strokeWidth="1" />
                          <text x="0" y="3.5" textAnchor="middle" fill="#9AE62E" fontSize="10" fontWeight="800">
                            {node.isExpanded ? '-' : `+${node.count || 0}`}
                          </text>
                        </g>
                      </g>
                    );
                  }

                  // C. Concept Leaf Nodes
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={() => handleSelectNode(node.id)}
                      style={{
                        cursor: 'pointer',
                        opacity: isDimmed ? 0.2 : 1,
                        transition: 'all 0.2s ease'
                      }}
                      role="button"
                      aria-label={`Concept: ${node.name || 'Concept'}, page ${node.page || 1}`}
                    >
                      <rect
                        x={-node.width / 2}
                        y={-node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx="12"
                        fill="#10190D"
                        stroke={isSelected || isSearched ? '#9AE62E' : 'rgba(154, 230, 46, 0.3)'}
                        strokeWidth={isSelected ? 2.4 : 1.2}
                        filter={isSelected || isSearched ? 'url(#lime-glow)' : 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))'}
                      />
                      {/* Dynamic Icon */}
                      <IconComponent x={-node.width / 2 + 12} y={-7} size={15} color="#9AE62E" />
                      {/* Concept Name */}
                      <text
                        x={-node.width / 2 + 34}
                        y="4"
                        fill="#FFFFFF"
                        fontSize="13"
                        fontWeight="600"
                      >
                        {(node.name || 'Concept').length > 15 ? `${(node.name || 'Concept').slice(0, 14)}…` : (node.name || 'Concept')}
                      </text>
                      {/* Studied mark */}
                      {node.studied && (
                        <circle cx={node.width / 2 - 12} cy="-10" r="5" fill="#6FC21A" />
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Minimap preview in corner */}
            <div className="kg-minimap-card" aria-hidden="true">
              <svg width="110" height="75" viewBox={`${layout.minX || -300} ${layout.minY || -200} ${Math.max(1, (layout.maxX || 300) - (layout.minX || -300))} ${Math.max(1, (layout.maxY || 200) - (layout.minY || -200))}`}>
                <rect x={layout.minX} y={layout.minY} width={layout.maxX - layout.minX} height={layout.maxY - layout.minY} fill="#090E08" />
                {Object.values(layout.nodes).map(n => (
                  <circle
                    key={n.id}
                    cx={n.x}
                    cy={n.y}
                    r={n.type === 'root' ? 12 : (n.type === 'topic' ? 8 : 4)}
                    fill={n.type === 'root' ? '#9AE62E' : (n.type === 'topic' ? '#6FC21A' : 'rgba(154, 230, 46, 0.6)')}
                  />
                ))}
              </svg>
            </div>

            {/* Topic Map Legend */}
            <div className="kg-legend-card" role="region" aria-label="Topic map legend">
              <div className="kg-legend-title">TOPIC MAP LEGEND</div>
              <div className="kg-legend-item">
                <span className="kg-legend-dot root" />
                <span>Document Core</span>
              </div>
              <div className="kg-legend-item">
                <span className="kg-legend-dot topic" />
                <span>Topic Branch</span>
              </div>
              <div className="kg-legend-item">
                <span className="kg-legend-dot concept" />
                <span>Concept Leaf</span>
              </div>
              <div className="kg-legend-item">
                <span className="kg-legend-line solid" />
                <span>Prerequisite (from notes)</span>
              </div>
            </div>
          </div>
        ) : (
          /* Accessible Semantic List Alternative */
          <div className="kg-list-view" role="region" aria-label="Topic hierarchy list">
            <div className="kg-list-header">
              <h2>Topic & Concept Hierarchy</h2>
              <p>Explore course concepts organized by chapter and prerequisite sequence.</p>
            </div>
            {allTopicList.map((topic, tIdx) => (
              <div key={topic.id} className="kg-topic-section">
                <div className="kg-topic-section-header">
                  <span className="kg-topic-badge">Chapter {tIdx + 1}</span>
                  <h3>{topic.name}</h3>
                  <span className="kg-topic-leaf-count">{topic.count} concepts</span>
                </div>
                <div className="kg-topic-cards-grid">
                  {topic.concepts.map(c => (
                    <div
                      key={c.id}
                      className={`kg-concept-row-card ${selectedNodeId === c.id ? 'is-selected' : ''}`}
                      onClick={() => handleSelectNode(c.id)}
                    >
                      <div className="kg-row-top">
                        <strong>{c.name}</strong>
                        <span className="kg-row-page">p. {c.page}</span>
                      </div>
                      {c.definition && <p className="kg-row-def">{c.definition}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* C. Right-Side Node Details Panel (Matching Reference Screenshot) */}
        {selectedNodeId && entityDetail && (
          <aside className="kg-side-panel" aria-label="Selected node details">
            {/* Header */}
            <div className="kg-panel-header">
              <div className="kg-panel-title-wrap">
                <div className="kg-panel-icon-circle">
                  <Brain size={18} color="#9AE62E" />
                </div>
                <h3 className="kg-panel-title">{entityDetail.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="kg-close-btn"
                aria-label="Close details"
              >
                <X size={16} />
              </button>
            </div>

            {/* Definition / Description paragraph */}
            {isDetailLoading ? (
              <p className="kg-detail-summary">Fetching citations & details…</p>
            ) : entityDetail.definition ? (
              <p className="kg-detail-summary">{entityDetail.definition}</p>
            ) : (
              <p className="kg-detail-summary is-empty">No definition recorded in notes for this concept.</p>
            )}

            <div className="kg-panel-body">
              {/* Node Details Section */}
              <div className="kg-details-section">
                <h4 className="kg-details-section-title">Node details</h4>
                <div className="kg-details-grid">
                  <div className="kg-detail-row">
                    <span className="kg-detail-key">Type</span>
                    <span className="kg-type-badge">Concept</span>
                  </div>
                  <div className="kg-detail-row">
                    <span className="kg-detail-key">Domain</span>
                    <span className="kg-detail-value">{entityDetail.chapter || 'Core Concepts'}</span>
                  </div>
                  <div className="kg-detail-row">
                    <span className="kg-detail-key">Connections</span>
                    <span className="kg-detail-value">{selectedRelationsCount?.total || 0}</span>
                  </div>
                  <div className="kg-detail-row">
                    <span className="kg-detail-key">Page</span>
                    <span className="kg-detail-value">
                      {entityDetail.mentions?.map((m, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="kg-page-chip"
                          onClick={() => onOpenViewer && onOpenViewer(m.document_id, m.page, m.quote)}
                        >
                          p. {m.page}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Relationship Types Breakdown (Matching Reference Image) */}
              <div className="kg-details-section">
                <h4 className="kg-details-section-title">Relationship types</h4>
                <div className="kg-rel-types-list">
                  <div className="rel-type-row">
                    <span className="rel-dot part-of" />
                    <span className="rel-name">part-of</span>
                    <span className="rel-count">{selectedRelationsCount?.breakdown['part-of'] || 1}</span>
                  </div>
                  <div className="rel-type-row">
                    <span className="rel-dot requires" />
                    <span className="rel-name">requires</span>
                    <span className="rel-count">{selectedRelationsCount?.breakdown['requires'] || 0}</span>
                  </div>
                  <div className="rel-type-row">
                    <span className="rel-dot unlocks" />
                    <span className="rel-name">unlocks</span>
                    <span className="rel-count">{selectedRelationsCount?.breakdown['unlocks'] || 0}</span>
                  </div>
                  <div className="rel-type-row">
                    <span className="rel-dot cross" />
                    <span className="rel-name">cross-topic</span>
                    <span className="rel-count">{selectedRelationsCount?.breakdown['cross-topic'] || 0}</span>
                  </div>
                </div>
              </div>

              {/* Citations & Quotes from student notes */}
              {entityDetail.mentions && entityDetail.mentions.length > 0 && (
                <div className="kg-details-section">
                  <h4 className="kg-details-section-title">Source in your notes</h4>
                  {entityDetail.mentions.map((m, idx) => (
                    <div key={idx} className="kg-citation-box">
                      <div className="kg-citation-top">
                        <BookOpen size={12} />
                        <span>Page {m.page}</span>
                      </div>
                      {m.quote && <blockquote>"{m.quote}"</blockquote>}
                      {onOpenViewer && (
                        <button
                          type="button"
                          className="kg-citation-view-btn"
                          onClick={() => onOpenViewer(m.document_id, m.page, m.quote)}
                        >
                          <ExternalLink size={12} />
                          <span>Open in PDF viewer (p. {m.page})</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="kg-panel-actions">
                <button
                  type="button"
                  className="kg-ask-btn"
                  onClick={() => onAskAboutConcept(entityDetail.name)}
                >
                  <Sparkles size={14} />
                  <span>Ask about {entityDetail.name}</span>
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
