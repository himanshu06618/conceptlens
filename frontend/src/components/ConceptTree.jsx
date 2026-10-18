import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  getBezierPath,
  BaseEdge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { toPng, toSvg } from 'html-to-image';
import {
  GitBranch,
  Maximize2,
  ZoomIn,
  ZoomOut,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowRightLeft,
  ArrowUpDown,
  Download,
  Search,
  X,
  List,
  Network,
  Share2,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  Info,
  Check
} from 'lucide-react';
import { nodeTypes, getBranchColor } from './tree/TreeNodeComponents';
import BookshelfLoader from './ui/BookshelfLoader';
import { getDocumentTree } from '../api/client';

const BRANCH_COLOR_MAP = [
  { name: 'mint', hex: '#397F69', tint: 'rgba(57, 127, 105, 0.14)', text: '#316F5B' },
  { name: 'sage', hex: '#6A8C78', tint: 'rgba(106, 140, 120, 0.16)', text: '#526D5D' },
  { name: 'olive', hex: '#7C9C83', tint: 'rgba(124, 156, 131, 0.16)', text: '#5F7A65' },
  { name: 'clay', hex: '#C17D55', tint: 'rgba(193, 125, 85, 0.14)', text: '#985A35' },
  { name: 'moss', hex: '#8A9A7A', tint: 'rgba(138, 154, 122, 0.16)', text: '#64724F' },
  { name: 'fern', hex: '#8BA99A', tint: 'rgba(139, 169, 154, 0.16)', text: '#5C7969' },
];

/**
 * Custom curved edge supporting branch colors, path highlighting, dimming, and dashed animations
 */
function CustomTreeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd
}) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY
  });

  const isRelated = data?.isRelated;
  const isHighlighted = data?.isHighlighted;
  const isDimmed = data?.isDimmed;
  const isSelected = data?.isSelected;
  const branchColor = data?.branchColor || '#397F69';

  const strokeColor = isRelated
    ? 'rgba(255, 255, 255, 0.45)'
    : isHighlighted || isSelected
    ? 'var(--gold-bright)'
    : branchColor;

  const strokeWidth = isHighlighted || isSelected ? 2.5 : isRelated ? 1.5 : 2;
  const opacity = isDimmed ? 0.35 : 1;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        ...style,
        stroke: strokeColor,
        strokeWidth,
        opacity,
        strokeDasharray: isRelated ? '5, 5' : isSelected ? '6, 6' : undefined,
        animation: isSelected ? 'dashflow 1s linear infinite' : undefined,
        filter: isHighlighted ? `drop-shadow(0 0 6px ${branchColor})` : undefined,
        transition: 'all 0.25s ease'
      }}
      markerEnd={markerEnd}
    />
  );
}

const edgeTypes = {
  custom: CustomTreeEdge
};

/**
 * Calculates hierarchical layout using @dagrejs/dagre
 */
function getLayoutedElements(nodes, edges, direction = 'LR') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({
    rankdir: direction,
    ranksep: isHorizontal ? 80 : 65,
    nodesep: isHorizontal ? 36 : 40,
    marginx: 40,
    marginy: 40
  });

  nodes.forEach((node) => {
    let width = 220;
    let height = 80;
    if (node.type === 'root') { width = 240; height = 90; }
    else if (node.type === 'topic') { width = 210; height = 64; }
    else if (node.type === 'concept') { width = 220; height = 80; }
    else if (node.type === 'subconcept') { width = 180; height = 48; }
    else if (node.type === 'more') { width = 140; height = 40; }

    dagreGraph.setNode(node.id, { width, height });
  });

  // Only layout with hierarchical tree edges (not cross-link relations)
  edges.filter((e) => !e.data?.isRelated).forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    let width = 220;
    let height = 80;
    if (node.type === 'root') { width = 240; height = 90; }
    else if (node.type === 'topic') { width = 210; height = 64; }
    else if (node.type === 'concept') { width = 220; height = 80; }
    else if (node.type === 'subconcept') { width = 180; height = 48; }
    else if (node.type === 'more') { width = 140; height = 40; }

    return {
      ...node,
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
      position: {
        x: nodeWithPosition ? nodeWithPosition.x - width / 2 : 0,
        y: nodeWithPosition ? nodeWithPosition.y - height / 2 : 0
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Inner component with access to ReactFlow hooks (fitView, zoomIn, zoomOut, etc.)
 */
function ConceptTreeCanvas({
  rawTreeData,
  documentTitle,
  onSelectConcept,
  stageRef,
  searchQuery: externalSearchQuery = ''
}) {
  const { fitView, zoomIn, zoomOut, setCenter } = useReactFlow();

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const [orientation, setOrientation] = useState(isMobile ? 'TB' : 'LR');
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const searchQuery = externalSearchQuery !== undefined && externalSearchQuery !== '' 
    ? externalSearchQuery 
    : internalSearchQuery;
  const setSearchQuery = setInternalSearchQuery;
  const [showRelations, setShowRelations] = useState(false);
  const [viewMode, setViewMode] = useState('tree'); // 'tree' or 'outline'
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // Set of collapsed node IDs. Default: level 2 concepts have their subconcepts collapsed
  const [collapsedNodeIds, setCollapsedNodeIds] = useState(() => {
    const initialCollapsed = new Set();
    if (rawTreeData?.nodes) {
      // Collapse all level 2 nodes that have children initially (depth 2 expanded)
      rawTreeData.nodes.forEach((n) => {
        if (n.level === 2 && n.child_count > 0) {
          initialCollapsed.add(n.id);
        }
      });
    }
    return initialCollapsed;
  });

  // Track overflow nodes that have been expanded
  const [expandedMoreNodeIds, setExpandedMoreNodeIds] = useState(new Set());

  // Toggle branch expand/collapse
  const handleToggleNode = useCallback((nodeId) => {
    setCollapsedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Expand "and N more" node
  const handleExpandMore = useCallback((nodeId) => {
    setExpandedMoreNodeIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsedNodeIds(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    if (!rawTreeData?.nodes) return;
    const all = new Set();
    rawTreeData.nodes.forEach((n) => {
      if (n.level >= 1 && n.child_count > 0) {
        all.add(n.id);
      }
    });
    setCollapsedNodeIds(all);
  }, [rawTreeData]);

  // Compute visible nodes & edges based on collapsed state and relations toggle
  const { visibleNodes, visibleEdges, nodeMap, parentMap, childrenMap } = useMemo(() => {
    if (!rawTreeData || !rawTreeData.nodes) {
      return { visibleNodes: [], visibleEdges: [], nodeMap: new Map(), parentMap: new Map(), childrenMap: new Map() };
    }

    const nMap = new Map();
    const pMap = new Map();
    const cMap = new Map();

    rawTreeData.nodes.forEach((n) => {
      nMap.set(n.id, n);
    });

    rawTreeData.edges.forEach((e) => {
      if (!e.is_related) {
        pMap.set(e.target, e.source);
        if (!cMap.has(e.source)) cMap.set(e.source, []);
        cMap.get(e.source).push(e.target);
      }
    });

    // Check if a node is visible by verifying none of its ancestors are collapsed
    const isNodeVisible = (nodeId) => {
      let current = nodeId;
      while (pMap.has(current)) {
        const parentId = pMap.get(current);
        if (collapsedNodeIds.has(parentId)) {
          return false;
        }
        current = parentId;
      }
      return true;
    };

    // Filter visible nodes
    const vNodes = rawTreeData.nodes.filter((n) => {
      if (n.level === 0) return true;
      return isNodeVisible(n.id);
    });

    const vNodeIds = new Set(vNodes.map((n) => n.id));

    // Filter visible edges
    const vEdges = rawTreeData.edges.filter((e) => {
      if (e.is_related && !showRelations) return false;
      return vNodeIds.has(e.source) && vNodeIds.has(e.target);
    });

    return { visibleNodes: vNodes, visibleEdges: vEdges, nodeMap: nMap, parentMap: pMap, childrenMap: cMap };
  }, [rawTreeData, collapsedNodeIds, showRelations]);

  // Compute active path (ancestors & descendants of hovered/selected node)
  const activePathNodeIds = useMemo(() => {
    const targetId = hoveredNodeId || selectedNodeId;
    if (!targetId) return null;

    const ids = new Set([targetId]);

    // Add ancestors up to root
    let curr = targetId;
    while (parentMap.has(curr)) {
      const p = parentMap.get(curr);
      ids.add(p);
      curr = p;
    }

    // Add immediate descendants
    const addDescendants = (id) => {
      const children = childrenMap.get(id) || [];
      children.forEach((c) => {
        ids.add(c);
        addDescendants(c);
      });
    };
    addDescendants(targetId);

    return ids;
  }, [hoveredNodeId, selectedNodeId, parentMap, childrenMap]);

  // Transform raw nodes to ReactFlow nodes
  const formattedFlowNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return visibleNodes.map((n) => {
      let type = 'concept';
      if (n.level === 0) type = 'root';
      else if (n.level === 1) type = 'topic';
      else if (n.is_more_node) type = 'more';
      else if (n.level >= 3) type = 'subconcept';

      const isCollapsed = collapsedNodeIds.has(n.id);
      const isMatchesSearch = query ? n.label.toLowerCase().includes(query) : false;
      const isHighlighted = isMatchesSearch || (activePathNodeIds && activePathNodeIds.has(n.id));
      const isDimmed = (query && !isMatchesSearch) || (activePathNodeIds && !activePathNodeIds.has(n.id));

      return {
        id: n.id,
        type,
        data: {
          id: n.id,
          label: n.label,
          level: n.level,
          topic: n.topic,
          importance: n.importance,
          shortDefinition: n.short_definition,
          definition: n.definition,
          sourceExcerpt: n.source_excerpt,
          page: n.page,
          score: n.score,
          branchColorIndex: n.branch_color_index,
          childCount: n.child_count,
          isCollapsed,
          isDimmed,
          isHighlighted,
          orientation,
          onToggle: handleToggleNode,
          onExpandMore: handleExpandMore
        },
        position: { x: 0, y: 0 }
      };
    });
  }, [visibleNodes, collapsedNodeIds, searchQuery, activePathNodeIds, orientation, handleToggleNode, handleExpandMore]);

  // Transform raw edges to ReactFlow edges
  const formattedFlowEdges = useMemo(() => {
    return visibleEdges.map((e) => {
      const branchColor = getBranchColor(e.branch_color_index || 0).hex;
      const isHighlighted = activePathNodeIds && activePathNodeIds.has(e.source) && activePathNodeIds.has(e.target);
      const isDimmed = activePathNodeIds && !isHighlighted;
      const isSelected = selectedNodeId && (e.source === selectedNodeId || e.target === selectedNodeId);

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'custom',
        data: {
          isRelated: e.is_related,
          branchColor,
          isHighlighted,
          isDimmed,
          isSelected
        }
      };
    });
  }, [visibleEdges, activePathNodeIds, selectedNodeId]);

  // Calculate Dagre Layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    if (formattedFlowNodes.length === 0) return { nodes: [], edges: [] };
    return getLayoutedElements(formattedFlowNodes, formattedFlowEdges, orientation);
  }, [formattedFlowNodes, formattedFlowEdges, orientation]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Sync state when layout changes
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Fit view on initial render or orientation change
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.2, duration: 400 });
    }, 150);
    return () => clearTimeout(timer);
  }, [orientation, fitView]);

  // Auto-pan to first matching node on search
  useEffect(() => {
    if (searchQuery.trim()) {
      const match = layoutedNodes.find((n) =>
        n.data.label.toLowerCase().includes(searchQuery.trim().toLowerCase())
      );
      if (match && match.position) {
        setCenter(match.position.x + 100, match.position.y + 40, { zoom: 1.1, duration: 500 });
      }
    }
  }, [searchQuery, layoutedNodes, setCenter]);

  // Handle node interactions
  const onNodeClick = useCallback(
    (_, node) => {
      setSelectedNodeId(node.id);
      if (node.type === 'concept' || node.type === 'subconcept') {
        const rawNode = nodeMap.get(node.id);
        if (rawNode && onSelectConcept) {
          onSelectConcept({
            id: rawNode.concept_id || rawNode.id,
            name: rawNode.label,
            definition: rawNode.definition || rawNode.short_definition,
            source_excerpt: rawNode.source_excerpt || '',
            importance: rawNode.importance || 3,
            topic: rawNode.topic || 'General',
            page: rawNode.page || 1,
            score: rawNode.score || 0.5
          });
        }
      }
    },
    [nodeMap, onSelectConcept]
  );

  const onNodeDoubleClick = useCallback(
    (_, node) => {
      if (node.type === 'topic' || (node.type === 'concept' && node.data.childCount > 0)) {
        handleToggleNode(node.id);
      }
    },
    [handleToggleNode]
  );

  const onNodeMouseEnter = useCallback((_, node) => {
    setHoveredNodeId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === '+' || e.key === '=') {
        zoomIn({ duration: 250 });
      } else if (e.key === '-' || e.key === '_') {
        zoomOut({ duration: 250 });
      } else if (e.key === '0') {
        fitView({ padding: 0.2, duration: 300 });
      } else if (e.key === 'Enter' && selectedNodeId) {
        const rawNode = nodeMap.get(selectedNodeId);
        if (rawNode && onSelectConcept) {
          onSelectConcept({
            id: rawNode.concept_id || rawNode.id,
            name: rawNode.label,
            definition: rawNode.definition || rawNode.short_definition,
            source_excerpt: rawNode.source_excerpt || '',
            importance: rawNode.importance || 3,
            topic: rawNode.topic || 'General',
            page: rawNode.page || 1,
            score: rawNode.score || 0.5
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut, fitView, selectedNodeId, nodeMap, onSelectConcept]);

  // Export handlers
  const handleExportPng = async () => {
    if (!stageRef.current) return;
    try {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const dataUrl = await toPng(stageRef.current, {
        backgroundColor: isDark ? '#121214' : '#E6E6E8',
        quality: 0.95,
        filter: (node) => !node.classList?.contains('tree-controls-bar')
      });
      const link = document.createElement('a');
      link.download = `${documentTitle || 'concept-tree'}.png`;
      link.href = dataUrl;
      link.click();
      setIsExportOpen(false);
    } catch (err) {
      console.error('PNG export failed:', err);
    }
  };

  const handleExportSvg = async () => {
    if (!stageRef.current) return;
    try {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const dataUrl = await toSvg(stageRef.current, {
        backgroundColor: isDark ? '#121214' : '#E6E6E8',
        filter: (node) => !node.classList?.contains('tree-controls-bar')
      });
      const link = document.createElement('a');
      link.download = `${documentTitle || 'concept-tree'}.svg`;
      link.href = dataUrl;
      link.click();
      setIsExportOpen(false);
    } catch (err) {
      console.error('SVG export failed:', err);
    }
  };

  const handleExportJson = () => {
    const jsonStr = JSON.stringify(rawTreeData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${documentTitle || 'concept-tree'}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setIsExportOpen(false);
  };

  // Render Accessible Outline View
  const renderOutlineView = () => {
    const topics = rawTreeData.nodes.filter((n) => n.level === 1);
    const rootNode = rawTreeData.nodes.find((n) => n.level === 0);

    return (
      <div
        className="tree-outline-container"
        style={{
          height: '100%',
          overflowY: 'auto',
          padding: '28px 24px',
          color: '#FFFFFF',
          maxWidth: 820,
          margin: '0 auto'
        }}
      >
        <div style={{ marginBottom: 24, borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gold-bright)', fontWeight: 600 }}>
              Structured Outline View
            </span>
          </div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', fontWeight: 600, color: '#FFFFFF', marginBottom: 6 }}>
            {rootNode?.label || documentTitle}
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--midnight-text-muted)' }}>
            {rawTreeData.nodes.length} nodes across {topics.length} topic branches. Click any concept to view its full definition and excerpt.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {topics.map((t, idx) => {
            const branch = getBranchColor(t.branch_color_index);
            const topicChildren = rawTreeData.nodes.filter(
              (n) => n.level === 2 && n.topic === t.label
            );

            return (
              <div
                key={t.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${branch.hex}44`,
                  borderLeft: `4px solid ${branch.hex}`,
                  borderRadius: 14,
                  padding: '16px 20px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Layers size={16} color={branch.hex} />
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#FFFFFF', margin: 0 }}>
                    {t.label}
                  </h3>
                  <span style={{ fontSize: 11, color: branch.text, marginLeft: 'auto' }}>
                    {topicChildren.length} concepts
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12 }}>
                  {topicChildren.map((c) => (
                    <div
                      key={c.id}
                      onClick={() =>
                        onSelectConcept &&
                        onSelectConcept({
                          id: c.concept_id || c.id,
                          name: c.label,
                          definition: c.definition || c.short_definition,
                          source_excerpt: c.source_excerpt || '',
                          importance: c.importance || 3,
                          topic: c.topic || 'General',
                          page: c.page || 1,
                          score: c.score || 0.5
                        })
                      }
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.92rem', color: '#FFFFFF' }}>{c.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--gold-bright)' }}>★ {c.importance}</span>
                      </div>
                      {c.short_definition && (
                        <p style={{ fontSize: 12, color: 'var(--midnight-text-muted)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                          {c.short_definition}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Floating Glass Controls Bar */}
      <div
        className="tree-controls-bar shadow-md"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(17, 23, 43, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          padding: '6px 8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
      >
        {/* Search input */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={14} color="var(--midnight-text-muted)" style={{ position: 'absolute', left: 8 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tree..."
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 10,
              padding: '6px 26px 6px 28px',
              color: '#FFFFFF',
              fontSize: '0.8rem',
              width: 130,
              outline: 'none',
              transition: 'width 0.2s ease'
            }}
            onFocus={(e) => (e.target.style.width = '170px')}
            onBlur={(e) => {
              if (!searchQuery) e.target.style.width = '130px';
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 6,
                background: 'none',
                border: 'none',
                color: 'var(--midnight-text-muted)',
                cursor: 'pointer',
                padding: 0
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

        {/* Zoom controls */}
        <button
          type="button"
          onClick={() => zoomIn({ duration: 200 })}
          title="Zoom in (+)"
          className="tree-control-btn"
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          onClick={() => zoomOut({ duration: 200 })}
          title="Zoom out (-)"
          className="tree-control-btn"
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.2, duration: 300 })}
          title="Fit view (0)"
          className="tree-control-btn"
        >
          <Maximize2 size={15} />
        </button>

        <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

        {/* Expand / Collapse All */}
        <button
          type="button"
          onClick={handleExpandAll}
          title="Expand all branches"
          className="tree-control-btn"
        >
          <ChevronsDownUp size={15} />
        </button>
        <button
          type="button"
          onClick={handleCollapseAll}
          title="Collapse to topics"
          className="tree-control-btn"
        >
          <ChevronsUpDown size={15} />
        </button>

        <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

        {/* Orientation toggle */}
        <button
          type="button"
          onClick={() => setOrientation((prev) => (prev === 'LR' ? 'TB' : 'LR'))}
          title={orientation === 'LR' ? 'Switch to Vertical tree' : 'Switch to Horizontal tree'}
          className="tree-control-btn"
          style={{ color: 'var(--gold-bright)' }}
        >
          {orientation === 'LR' ? <ArrowUpDown size={15} /> : <ArrowRightLeft size={15} />}
        </button>

        {/* Relations toggle */}
        <button
          type="button"
          onClick={() => setShowRelations((prev) => !prev)}
          title={showRelations ? 'Hide related links' : 'Show related cross-links'}
          className={`tree-control-btn ${showRelations ? 'is-active' : ''}`}
          style={{
            background: showRelations ? 'rgba(57, 127, 105, 0.14)' : undefined,
            color: showRelations ? 'var(--gold-bright)' : undefined
          }}
        >
          <Network size={15} />
        </button>

        {/* Outline View toggle */}
        <button
          type="button"
          onClick={() => setViewMode((prev) => (prev === 'tree' ? 'outline' : 'tree'))}
          title={viewMode === 'tree' ? 'Switch to Accessible Outline' : 'Switch to Canvas Tree'}
          className={`tree-control-btn ${viewMode === 'outline' ? 'is-active' : ''}`}
          style={{
            background: viewMode === 'outline' ? 'var(--brand-bg)' : undefined,
            color: viewMode === 'outline' ? 'var(--brand-text)' : undefined
          }}
        >
          <List size={15} />
        </button>

        <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

        {/* Export dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setIsExportOpen((prev) => !prev)}
            title="Export tree"
            className="tree-control-btn"
          >
            <Download size={15} />
          </button>

          {isExportOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 45 }}
                onClick={() => setIsExportOpen(false)}
              />
              <div
                className="shadow-md"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 6,
                  background: 'var(--surface-dark, #202D26)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 12,
                  padding: 4,
                  zIndex: 50,
                  minWidth: 150,
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)'
                }}
              >
                <button
                  type="button"
                  onClick={handleExportPng}
                  className="tree-dropdown-btn"
                >
                  Export as PNG
                </button>
                <button
                  type="button"
                  onClick={handleExportSvg}
                  className="tree-dropdown-btn"
                >
                  Export as SVG
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="tree-dropdown-btn"
                >
                  Export as JSON
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main View: Canvas or Outline */}
      {viewMode === 'outline' ? (
        renderOutlineView()
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          minZoom={0.2}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onlyRenderVisibleElements
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          {/* Subtle MiniMap on Desktop */}
          {!isMobile && (
            <MiniMap
              nodeStrokeColor="rgba(255, 255, 255, 0.2)"
              nodeColor={(n) => {
                if (n.type === 'root') return '#397F69';
                if (n.type === 'topic') return getBranchColor(n.data.branchColorIndex).hex;
                return '#68736D';
              }}
              nodeBorderRadius={4}
              maskColor="rgba(11, 16, 32, 0.75)"
              style={{
                background: 'rgba(17, 23, 43, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 14,
                width: 140,
                height: 90,
                right: 16,
                bottom: 16
              }}
            />
          )}
        </ReactFlow>
      )}

      {/* Compact Branch Legend at Bottom-Left */}
      {viewMode === 'tree' && rawTreeData?.topic_count > 0 && (
        <div
          className="tree-legend-bar"
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(17, 23, 43, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 20,
            padding: '6px 14px',
            fontSize: 11,
            color: 'var(--midnight-text-muted)'
          }}
        >
          <span style={{ fontWeight: 600, color: '#FFFFFF' }}>Branches:</span>
          {rawTreeData.nodes
            .filter((n) => n.level === 1)
            .slice(0, 6)
            .map((t) => {
              const b = getBranchColor(t.branch_color_index);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: b.hex,
                      display: 'inline-block'
                    }}
                  />
                  <span style={{ color: '#FFFFFF', maxWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.label}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/**
 * ConceptTree Component
 * Renders inside a midnight stage with soft radial glow and faint grid.
 * Fetches tree from /api/documents/:id/tree or builds client-side fallback.
 */
export default function ConceptTree({
  documentId,
  documentTitle,
  fallbackConcepts = [],
  onSelectConcept,
  searchQuery = ''
}) {
  const [treeData, setTreeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const stageRef = useRef(null);

  // Fetch tree data from API
  useEffect(() => {
    let isMounted = true;
    async function fetchTree() {
      if (!documentId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getDocumentTree(documentId);
        if (isMounted) {
          setTreeData(data);
          setLoading(false);
        }
      } catch (err) {
        console.warn('Could not fetch tree from server, generating client-side tree:', err);
        if (isMounted) {
          // Client-side fallback if network or older API
          const fallback = buildClientFallbackTree(documentId, documentTitle, fallbackConcepts);
          setTreeData(fallback);
          setLoading(false);
        }
      }
    }

    fetchTree();
    return () => {
      isMounted = false;
    };
  }, [documentId, documentTitle, fallbackConcepts]);

  return (
    <div className="concept-tree-stage" ref={stageRef}>
      <div className="tree-stage-glow" />
      <div className="tree-stage-grid" />

      {loading ? (
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 16
          }}
        >
          <BookshelfLoader size="lg" label="Assembling concept hierarchy..." />
        </div>
      ) : treeData && treeData.nodes && treeData.nodes.length > 0 ? (
        <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
          <ReactFlowProvider>
            <ConceptTreeCanvas
              rawTreeData={treeData}
              documentTitle={documentTitle}
              onSelectConcept={onSelectConcept}
              stageRef={stageRef}
              searchQuery={searchQuery}
            />
          </ReactFlowProvider>
        </div>
      ) : (
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 32,
            textAlign: 'center',
            color: 'var(--midnight-text)'
          }}
        >
          <GitBranch size={36} color="var(--gold-bright)" style={{ marginBottom: 12 }} />
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.3rem', color: '#FFFFFF', marginBottom: 6 }}>
            No Concept Map Available
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--midnight-text-muted)', maxWidth: 400 }}>
            Upload notes with clear headings or definitions to generate an interactive concept tree.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Client-side fallback tree generator if offline or API returns error
 */
function buildClientFallbackTree(docId, docTitle, concepts = []) {
  const cleanTitle = (docTitle || 'Untitled Note').replace(/\.[^/.]+$/, '');
  const nodes = [];
  const edges = [];

  const rootId = `root_${docId}`;
  nodes.push({
    id: rootId,
    label: cleanTitle,
    level: 0,
    topic: 'Overview',
    importance: 5,
    short_definition: `Tree containing ${concepts.length} concepts.`,
    branch_color_index: 0,
    child_count: concepts.length
  });

  // Group by topic
  const topicMap = {};
  concepts.forEach((c) => {
    const t = c.topic || 'General';
    if (!topicMap[t]) topicMap[t] = [];
    topicMap[t].push(c);
  });

  const topicEntries = Object.entries(topicMap);
  topicEntries.forEach(([tName, tConcepts], tIdx) => {
    const topicNodeId = `topic_${tIdx}`;
    const branchColorIndex = tIdx % BRANCH_COLOR_MAP.length;

    nodes.push({
      id: topicNodeId,
      label: tName,
      level: 1,
      topic: tName,
      importance: 4,
      short_definition: `${tConcepts.length} concepts in this branch`,
      branch_color_index: branchColorIndex,
      child_count: tConcepts.length
    });

    edges.push({
      id: `edge_${rootId}_${topicNodeId}`,
      source: rootId,
      target: topicNodeId,
      branch_color_index: branchColorIndex,
      is_related: false
    });

    tConcepts.forEach((c, cIdx) => {
      const cId = `concept_${c.id || cIdx}`;
      nodes.push({
        id: cId,
        concept_id: c.id,
        label: c.name,
        level: 2,
        topic: tName,
        importance: c.importance || 3,
        short_definition: c.definition || c.source_excerpt || '',
        definition: c.definition || '',
        source_excerpt: c.source_excerpt || '',
        page: c.page || 1,
        score: c.score || 0.5,
        branch_color_index: branchColorIndex,
        child_count: 0
      });

      edges.push({
        id: `edge_${topicNodeId}_${cId}`,
        source: topicNodeId,
        target: cId,
        branch_color_index: branchColorIndex,
        is_related: false
      });
    });
  });

  return {
    document_id: docId,
    title: cleanTitle,
    node_count: nodes.length,
    edge_count: edges.length,
    topic_count: topicEntries.length,
    nodes,
    edges
  };
}
