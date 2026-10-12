import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import {
  Maximize2,
  CheckCircle2,
  Circle,
  Clock,
  Filter,
  Sparkles,
  Link2,
  Layers,
  Search
} from 'lucide-react';

/**
 * Custom Concept Node for Flowchart
 */
function FlowConceptNode({ data }) {
  const isSelected = data.isSelected;
  const isAncestor = data.isAncestor;
  const isDimmed = data.isDimmed;
  const isStudied = data.status === 'studied';
  const importance = Math.max(1, Math.min(3, Number(data.importance) || 1));

  return (
    <div
      className={`flow-concept-node ${isSelected ? 'is-selected' : ''} ${isAncestor ? 'is-ancestor' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`Concept: ${data.label}, Step ${data.stageIndex + 1}`}
      onClick={() => data.onSelect(data.concept)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelect(data.concept);
        }
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flow-node-stage-badge">
        <span>Step {data.stageIndex + 1}</span>
      </div>
      <div className="flow-node-content">
        <strong className="flow-node-title" title={data.label}>{data.label}</strong>
        <div className="flow-node-meta">
          <div className="flow-node-status">
            {isStudied ? (
              <CheckCircle2 size={12} className="status-icon studied" />
            ) : (
              <Circle size={12} className="status-icon not-started" />
            )}
            <span>{data.estimated_minutes || 5}m</span>
          </div>
          <span className="flow-node-chapter-chip">{data.chapter}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = {
  flowConcept: FlowConceptNode,
};

function FlowchartInner({
  concepts = [],
  selectedConcept,
  onSelectConcept,
  onLearningPathChange,
  searchQuery = ''
}) {
  const { fitView } = useReactFlow();

  // All distinct chapters
  const allChapters = useMemo(() => {
    const set = new Set();
    concepts.forEach(c => set.add(c.chapter || c.topic || 'General'));
    return Array.from(set);
  }, [concepts]);

  // Large document check: default to first chapter if > 40 concepts
  const isLargeDocument = concepts.length > 40;
  const [selectedChapter, setSelectedChapter] = useState(
    isLargeDocument && allChapters.length > 0 ? allChapters[0] : 'ALL'
  );
  const [showRelated, setShowRelated] = useState(false);

  // Filter concepts based on chapter filter
  const filteredConcepts = useMemo(() => {
    if (selectedChapter === 'ALL') return concepts;
    return concepts.filter(c => (c.chapter || c.topic || 'General') === selectedChapter);
  }, [concepts, selectedChapter]);

  // Concept lookup maps
  const conceptMap = useMemo(() => {
    const map = new Map();
    concepts.forEach(c => {
      map.set(String(c.id), c);
      map.set(String(c.name).toLowerCase().trim(), c);
    });
    return map;
  }, [concepts]);

  // Compute full prerequisite ancestors path for selected concept
  const { ancestorIds, learningPathSteps } = useMemo(() => {
    if (!selectedConcept) return { ancestorIds: new Set(), learningPathSteps: [] };

    const ancestors = new Set();
    const queue = [String(selectedConcept.id)];
    ancestors.add(String(selectedConcept.id));

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentObj = conceptMap.get(currentId);
      if (!currentObj) continue;

      const prereqs = currentObj.prerequisites || [];
      prereqs.forEach(p => {
        const found = conceptMap.get(String(p).toLowerCase().trim());
        if (found && !ancestors.has(String(found.id))) {
          ancestors.add(String(found.id));
          queue.push(String(found.id));
        }
      });

      (currentObj.related_concepts || []).forEach(rel => {
        if (rel.relation_type === 'prerequisite' || rel.type === 'prerequisite') {
          const found = conceptMap.get(String(rel.concept_id || rel.name).toLowerCase().trim());
          if (found && !ancestors.has(String(found.id))) {
            ancestors.add(String(found.id));
            queue.push(String(found.id));
          }
        }
      });
    }

    // Sort learning path steps by stage_index ascending
    const steps = Array.from(ancestors)
      .map(id => conceptMap.get(id))
      .filter(Boolean)
      .sort((a, b) => (Number(a.stage_index) || 0) - (Number(b.stage_index) || 0));

    return { ancestorIds: ancestors, learningPathSteps: steps };
  }, [selectedConcept, conceptMap]);

  // Notify parent of learning path steps for detail panel
  useEffect(() => {
    if (onLearningPathChange) {
      onLearningPathChange(learningPathSteps);
    }
  }, [learningPathSteps, onLearningPathChange]);

  // Generate nodes and edges
  const { rawNodes, rawEdges } = useMemo(() => {
    const nodesList = [];
    const edgesList = [];
    const activeConceptIds = new Set(filteredConcepts.map(c => String(c.id)));

    // 1. Nodes
    filteredConcepts.forEach(c => {
      const cId = String(c.id);
      const isSelected = selectedConcept && String(selectedConcept.id) === cId;
      const isAncestor = ancestorIds.has(cId);
      const isDimmed = selectedConcept && !isAncestor;

      nodesList.push({
        id: cId,
        type: 'flowConcept',
        position: { x: 0, y: 0 },
        data: {
          label: c.name,
          chapter: c.chapter || c.topic || 'General',
          stageIndex: Number(c.stage_index) || 0,
          estimated_minutes: c.estimated_minutes,
          status: c.status,
          importance: c.importance,
          concept: c,
          isSelected,
          isAncestor,
          isDimmed,
          onSelect: onSelectConcept,
        },
      });
    });

    // 2. Edges: Prerequisites and optionally Related
    const edgeKeySet = new Set();

    filteredConcepts.forEach(c => {
      const targetId = String(c.id);

      // Prerequisite links (source -> target)
      const prereqs = c.prerequisites || [];
      prereqs.forEach(p => {
        const sourceConcept = conceptMap.get(String(p).toLowerCase().trim());
        if (sourceConcept && activeConceptIds.has(String(sourceConcept.id))) {
          const sourceId = String(sourceConcept.id);
          const edgeKey = `${sourceId}->${targetId}`;
          if (!edgeKeySet.has(edgeKey) && sourceId !== targetId) {
            edgeKeySet.add(edgeKey);
            const isPathEdge = ancestorIds.has(sourceId) && ancestorIds.has(targetId);

            edgesList.push({
              id: `edge_${edgeKey}`,
              source: sourceId,
              target: targetId,
              type: 'smoothstep',
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: isPathEdge ? '#9AE62E' : '#6FB41A',
                width: 14,
                height: 14,
              },
              style: {
                stroke: isPathEdge ? '#9AE62E' : 'rgba(111, 180, 26, 0.45)',
                strokeWidth: isPathEdge ? 3.5 : 2,
              },
            });
          }
        }
      });

      // Related links (dotted faint line, if enabled)
      if (showRelated) {
        (c.related || []).forEach(r => {
          const relConcept = conceptMap.get(String(r).toLowerCase().trim());
          if (relConcept && activeConceptIds.has(String(relConcept.id))) {
            const relId = String(relConcept.id);
            const edgeKey = `${Math.min(targetId, relId)}<->${Math.max(targetId, relId)}`;
            if (!edgeKeySet.has(edgeKey) && relId !== targetId) {
              edgeKeySet.add(edgeKey);
              edgesList.push({
                id: `rel_${edgeKey}`,
                source: targetId,
                target: relId,
                type: 'bezier',
                style: {
                  stroke: 'rgba(68, 80, 47, 0.28)',
                  strokeWidth: 1.5,
                  strokeDasharray: '4 4',
                },
              });
            }
          }
        });
      }
    });

    return { rawNodes: nodesList, rawEdges: edgesList };
  }, [filteredConcepts, selectedConcept, ancestorIds, onSelectConcept, showRelated, conceptMap]);

  // Dagre Left-to-Right Layered Layout
  const layoutedNodes = useMemo(() => {
    if (!rawNodes.length) return [];
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: 'LR',
      nodesep: 36,
      ranksep: 90,
      marginx: 40,
      marginy: 40,
    });

    rawNodes.forEach((node) => {
      g.setNode(node.id, { width: 220, height: 74 });
    });

    rawEdges.forEach((edge) => {
      g.setEdge(edge.source, edge.target);
    });

    dagre.layout(g);

    return rawNodes.map((node) => {
      const point = g.node(node.id);
      return {
        ...node,
        position: {
          x: (point?.x || 0) - 110,
          y: (point?.y || 0) - 37,
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

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 350 });
  }, [fitView]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleFitView();
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedChapter, handleFitView]);

  return (
    <div className="flowchart-view-container" role="region" aria-label="Prerequisite Flowchart Learning View">
      {/* View Toolbar & Chapter Filters */}
      <div className="flowchart-toolbar">
        <div className="flowchart-filter-row">
          <span className="filter-label">
            <Filter size={13} />
            Filter Chapter:
          </span>
          <div className="chapter-filter-chips" role="radiogroup" aria-label="Chapter Filter">
            <button
              type="button"
              className={`chapter-filter-chip ${selectedChapter === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedChapter('ALL')}
              aria-checked={selectedChapter === 'ALL'}
              role="radio"
            >
              All Chapters ({concepts.length})
            </button>
            {allChapters.map(ch => (
              <button
                key={ch}
                type="button"
                className={`chapter-filter-chip ${selectedChapter === ch ? 'active' : ''}`}
                onClick={() => setSelectedChapter(ch)}
                aria-checked={selectedChapter === ch}
                role="radio"
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="flowchart-actions-row">
          <label className="toggle-related-label">
            <input
              type="checkbox"
              checked={showRelated}
              onChange={(e) => setShowRelated(e.target.checked)}
            />
            <Link2 size={13} />
            <span>Show related links</span>
          </label>
          <button
            type="button"
            onClick={handleFitView}
            className="flow-tool-btn"
            title="Fit view"
            aria-label="Fit view"
          >
            <Maximize2 size={14} />
            <span>Fit view</span>
          </button>
        </div>
      </div>

      {/* Flow Canvas */}
      <div className="flowchart-canvas-wrap">
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
          aria-label="Flowchart diagram"
        >
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => n.data?.isSelected ? '#9AE62E' : '#6FB41A'}
            maskColor="rgba(16, 20, 12, 0.15)"
            style={{ borderRadius: 12 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function FlowchartLearningView(props) {
  return (
    <ReactFlowProvider>
      <FlowchartInner {...props} />
    </ReactFlowProvider>
  );
}
