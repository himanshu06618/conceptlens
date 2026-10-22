import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import {
  Search,
  Maximize2,
  ZoomIn,
  ZoomOut,
  ChevronsDownUp,
  ChevronsUpDown,
  CheckCircle2,
  Circle,
  Clock,
  BookOpen,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles
} from 'lucide-react';

/**
 * Custom Root Node (Document)
 */
function DocumentRootNode({ data }) {
  return (
    <div className="tree-node tree-root-node" tabIndex={0} role="treeitem" aria-label={`Document: ${data.label}`}>
      <div className="node-icon-wrap">
        <BookOpen size={16} />
      </div>
      <div className="node-content">
        <span className="node-meta">DOCUMENT</span>
        <strong className="node-title" title={data.label}>{data.label}</strong>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

/**
 * Custom Chapter Node (Group Header, Collapsible)
 */
function ChapterGroupNode({ data }) {
  const isExpanded = data.isExpanded;
  const count = data.conceptCount || 0;

  return (
    <div 
      className={`tree-node tree-chapter-node ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
      tabIndex={0}
      role="treeitem"
      aria-expanded={isExpanded}
      onClick={data.onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onToggle();
        }
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="chapter-node-inner">
        <button 
          type="button" 
          className="chapter-expand-icon"
          aria-label={isExpanded ? 'Collapse chapter' : 'Expand chapter'}
        >
          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div className="chapter-info">
          <strong className="chapter-title" title={data.label}>{data.label}</strong>
          <span className="chapter-count-badge">
            {isExpanded ? `${count} concepts` : `+${count}`}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

/**
 * Custom Concept Node
 */
function ConceptLeafNode({ data }) {
  const isSelected = data.isSelected;
  const isStudied = data.status === 'studied';
  const importance = Math.max(1, Math.min(3, Number(data.importance) || 1));
  const concept = data.concept || {};
  const hasDefinition = Boolean(concept.definition);

  return (
    <div
      className={`tree-node tree-concept-node ${isSelected ? 'is-selected' : ''} ${isStudied ? 'is-studied' : ''}`}
      tabIndex={0}
      role="treeitem"
      aria-selected={isSelected}
      onClick={() => data.onSelect(data.concept)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelect(data.concept);
        }
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="concept-node-header">
        <div className="concept-status-indicator">
          {isStudied ? (
            <CheckCircle2 size={13} className="status-icon studied" />
          ) : (
            <Circle size={13} className="status-icon not-started" />
          )}
          <span className="concept-node-time">
            <Clock size={10} />
            {data.estimated_minutes || 5}m
          </span>
        </div>
        <div className="concept-importance-dots" aria-label={`Importance ${importance} of 3`}>
          {[1, 2, 3].map((dot) => (
            <span
              key={dot}
              className={`importance-dot ${dot <= importance ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
      <strong className="concept-node-title" title={data.label}>
        {data.label}
      </strong>
      {hasDefinition && (
        <div 
          className="concept-node-definition"
          style={{
            fontSize: '0.70rem',
            color: 'var(--text-secondary, #9ca3af)',
            marginTop: '3px',
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 1,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
          title={concept.definition}
        >
          {concept.definition_cue && (
            <span 
              style={{
                fontSize: '0.62rem',
                padding: '1px 4px',
                borderRadius: '3px',
                background: 'rgba(212, 248, 40, 0.16)',
                color: 'var(--accent-lime, #d4f828)',
                fontWeight: 600,
                marginRight: '4px',
                textTransform: 'lowercase'
              }}
            >
              {concept.definition_cue.replace(/_/g, ' ')}
            </span>
          )}
          <span>{concept.definition}</span>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  documentRoot: DocumentRootNode,
  chapterGroup: ChapterGroupNode,
  conceptLeaf: ConceptLeafNode,
};

function TreeInner({
  documentData,
  concepts = [],
  selectedConcept,
  onSelectConcept,
  searchQuery = ''
}) {
  const { fitView } = useReactFlow();
  const [localSearch, setLocalSearch] = useState(searchQuery);

  // Group concepts by chapter
  const chaptersMap = useMemo(() => {
    const map = new Map();
    concepts.forEach((c) => {
      const ch = c.chapter || c.topic || 'General';
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch).push(c);
    });
    return map;
  }, [concepts]);

  // Determine active chapter (contains selectedConcept or first chapter)
  const initialExpandedChapters = useMemo(() => {
    const set = new Set();
    const allChapters = Array.from(chaptersMap.keys());
    if (selectedConcept) {
      const targetCh = selectedConcept.chapter || selectedConcept.topic || 'General';
      set.add(targetCh);
    } else if (allChapters.length > 0) {
      set.add(allChapters[0]);
    }
    return set;
  }, [selectedConcept, chaptersMap]);

  const [expandedChapters, setExpandedChapters] = useState(initialExpandedChapters);

  // Auto-expand chapter when selectedConcept changes
  useEffect(() => {
    if (selectedConcept) {
      const targetCh = selectedConcept.chapter || selectedConcept.topic || 'General';
      setExpandedChapters((prev) => {
        const next = new Set(prev);
        next.add(targetCh);
        return next;
      });
    }
  }, [selectedConcept]);

  const toggleChapter = useCallback((chapterName) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterName)) {
        next.delete(chapterName);
      } else {
        next.add(chapterName);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedChapters(new Set(chaptersMap.keys()));
  }, [chaptersMap]);

  const collapseAll = useCallback(() => {
    setExpandedChapters(new Set());
  }, []);

  // Build nodes and edges based on expanded state and search
  const { nodes: rawNodes, edges: rawEdges } = useMemo(() => {
    const nodesList = [];
    const edgesList = [];
    const query = localSearch.trim().toLowerCase();

    // 1. Root Document Node
    const rootId = 'root_doc';
    nodesList.push({
      id: rootId,
      type: 'documentRoot',
      position: { x: 0, y: 0 },
      data: { label: documentData?.filename || 'Document' },
    });

    // 2. Chapter Nodes
    Array.from(chaptersMap.entries()).forEach(([chapterName, chConcepts]) => {
      const chId = `ch_${chapterName}`;
      const isExpanded = expandedChapters.has(chapterName);

      nodesList.push({
        id: chId,
        type: 'chapterGroup',
        position: { x: 0, y: 0 },
        data: {
          label: chapterName,
          conceptCount: chConcepts.length,
          isExpanded,
          onToggle: () => toggleChapter(chapterName),
        },
      });

      edgesList.push({
        id: `e_${rootId}_${chId}`,
        source: rootId,
        target: chId,
        type: 'smoothstep',
        style: { stroke: 'rgba(154, 230, 46, 0.45)', strokeWidth: 2 },
      });

      // 3. Concepts if expanded
      if (isExpanded) {
        chConcepts.forEach((c) => {
          const cId = `concept_${c.id}`;
          const isSelected = selectedConcept && String(selectedConcept.id) === String(c.id);
          const isMatch = !query || String(c.name).toLowerCase().includes(query) || String(c.definition).toLowerCase().includes(query);

          if (!query || isMatch) {
            nodesList.push({
              id: cId,
              type: 'conceptLeaf',
              position: { x: 0, y: 0 },
              data: {
                label: c.name,
                importance: c.importance,
                status: c.status,
                estimated_minutes: c.estimated_minutes,
                concept: c,
                isSelected,
                onSelect: onSelectConcept,
              },
            });

            edgesList.push({
              id: `e_${chId}_${cId}`,
              source: chId,
              target: cId,
              type: 'smoothstep',
              style: {
                stroke: isSelected ? '#D7F25C' : '#B7A9F2',
                strokeWidth: isSelected ? 2.5 : 1.8,
              },
            });
          }
        });
      }
    });

    return { nodes: nodesList, edges: edgesList };
  }, [documentData, chaptersMap, expandedChapters, selectedConcept, onSelectConcept, localSearch, toggleChapter]);

  // Dagre Left-to-Right Layout
  const layoutedNodes = useMemo(() => {
    if (!rawNodes.length) return [];
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: 'LR',
      nodesep: 24,
      ranksep: 90,
      marginx: 40,
      marginy: 40,
    });

    rawNodes.forEach((node) => {
      let width = 210;
      let height = 68;
      if (node.type === 'documentRoot') {
        width = 240;
        height = 76;
      } else if (node.type === 'chapterGroup') {
        width = 230;
        height = 64;
      } else if (node.type === 'conceptLeaf' && node.data?.concept?.definition) {
        height = 84;
      }
      g.setNode(node.id, { width, height });
    });

    rawEdges.forEach((edge) => {
      g.setEdge(edge.source, edge.target);
    });

    dagre.layout(g);

    return rawNodes.map((node) => {
      const nodeWithPosition = g.node(node.id);
      const isDefNode = node.type === 'conceptLeaf' && node.data?.concept?.definition;
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - (node.type === 'documentRoot' ? 120 : 110),
          y: nodeWithPosition.y - (isDefNode ? 42 : 32),
        },
      };
    });
  }, [rawNodes, rawEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(rawEdges);
  }, [layoutedNodes, rawEdges, setNodes, setEdges]);

  // Fit View with readable minimum zoom constraint
  const handleFitView = useCallback(() => {
    fitView({ padding: 0.25, duration: 400, minZoom: 0.5, maxZoom: 1.2 });
  }, [fitView]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleFitView();
    }, 100);
    return () => clearTimeout(timer);
  }, [expandedChapters.size, handleFitView]);

  return (
    <div className="concept-tree-container" role="region" aria-label="Hierarchical Concept Tree View">
      {/* View Toolbar */}
      <div className="tree-view-toolbar">
        <div className="tree-toolbar-search">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Search concepts in tree..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="tree-search-input"
            aria-label="Filter concepts in tree"
          />
        </div>
        <div className="tree-toolbar-actions">
          <button
            type="button"
            onClick={expandAll}
            className="tree-tool-btn"
            title="Expand all chapters"
            aria-label="Expand all chapters"
          >
            <ChevronsUpDown size={14} />
            <span>Expand all</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="tree-tool-btn"
            title="Collapse all chapters"
            aria-label="Collapse all chapters"
          >
            <ChevronsDownUp size={14} />
            <span>Collapse all</span>
          </button>
          <button
            type="button"
            onClick={handleFitView}
            className="tree-tool-btn"
            title="Fit view"
            aria-label="Fit view"
          >
            <Maximize2 size={14} />
            <span>Fit view</span>
          </button>
        </div>
      </div>

      {/* React Flow Canvas */}
      <div className="tree-flow-canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          aria-label="Concept tree diagram"
        >
          <Controls showInteractive={false} />
          <MiniMap 
            nodeColor={(n) => {
              if (n.type === 'documentRoot') return '#4C8F0F';
              if (n.type === 'chapterGroup') return '#6FB41A';
              return '#C4F560';
            }}
            maskColor="rgba(16, 20, 12, 0.15)"
            style={{ borderRadius: 12 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function ConceptTreeView(props) {
  return (
    <ReactFlowProvider>
      <TreeInner {...props} />
    </ReactFlowProvider>
  );
}
