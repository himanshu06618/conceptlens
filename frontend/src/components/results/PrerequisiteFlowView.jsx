import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  Lock,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Search,
  Filter,
  Clock,
  BookOpen,
  ChevronRight,
  ChevronDown,
  UserCheck,
  Maximize2,
  Minimize2,
  Layers,
  ArrowDown
} from 'lucide-react';
import { fetchFlowChart } from '../../api/client';
import BookshelfLoader from '../ui/BookshelfLoader';

export default function PrerequisiteFlowView({
  documentId = null,
  initialTargetConcept = null,
  onSelectConcept = () => {},
  onToggleStudied = () => {},
  onAskAboutConcept = () => {},
  isAuthenticated = true
}) {
  const [flowData, setFlowData] = useState({
    columns: [],
    nodes: [],
    edges: [],
    path: [],
    target: null,
    progress: { total_steps: 0, studied_steps: 0, estimated_minutes_left: 0 }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Target & Filters
  const [targetQuery, setTargetQuery] = useState(initialTargetConcept || '');
  const [selectedTarget, setSelectedTarget] = useState(initialTargetConcept);
  const [showRelated, setShowRelated] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState('all');

  // Canvas pan & zoom state
  const [transform, setTransform] = useState({ x: 40, y: 40, k: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Load flow data from server
  const loadFlow = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchFlowChart({
        target: selectedTarget,
        scope: documentId ? 'document' : 'all',
        documentId: documentId,
        chapter: selectedChapter !== 'all' ? selectedChapter : null
      });
      setFlowData(data);
      if (data.target && !selectedTarget) {
        setSelectedTarget(data.target.name || data.target.id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load prerequisite flow.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, selectedTarget, selectedChapter]);

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  // Handle pan & zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform(prev => ({
      ...prev,
      k: Math.max(0.4, Math.min(2.5, prev.k * factor))
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

  // Find next unstudied step to continue learning
  const nextUpNode = useMemo(() => {
    return flowData.nodes.find(n => n.state === 'next_up') ||
           flowData.nodes.find(n => n.state === 'locked');
  }, [flowData.nodes]);

  // Node position map for rendering edges on desktop
  const nodePositionMap = useMemo(() => {
    const map = {};
    const colWidth = 280;
    const rowHeight = 120;
    const colHeaderOffset = 80;

    flowData.columns.forEach((col, cIdx) => {
      const colNodes = flowData.nodes.filter(n => col.node_ids.includes(n.id));
      colNodes.forEach((node, rIdx) => {
        map[node.id] = {
          x: cIdx * colWidth + 60,
          y: rIdx * rowHeight + colHeaderOffset + 60
        };
      });
    });

    return map;
  }, [flowData]);

  // Edges filtered by "show related"
  const renderedEdges = useMemo(() => {
    return flowData.edges.filter(e => {
      if (e.type === 'related' && !showRelated) return false;
      return true;
    });
  }, [flowData.edges, showRelated]);

  if (isLoading && flowData.nodes.length === 0) {
    return (
      <div className="flow-loader-wrap" style={{ minHeight: 450, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BookshelfLoader message="Calculating prerequisite DAG sequence..." />
      </div>
    );
  }

  const { progress, target } = flowData;
  const progressPct = progress.total_steps > 0
    ? Math.round((progress.studied_steps / progress.total_steps) * 100)
    : 0;

  return (
    <div className={`flow-container ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* 1. Header & Controls */}
      <div className="flow-toolbar" role="toolbar" aria-label="Flowchart Controls">
        <div className="flow-toolbar-left">
          {/* Target Concept Search / Selector */}
          <div className="flow-target-wrap">
            <span className="flow-target-label">Path to:</span>
            <select
              value={selectedTarget || ''}
              onChange={(e) => setSelectedTarget(e.target.value)}
              className="flow-target-select"
              aria-label="Select target concept to trace prerequisites"
            >
              {target && <option value={target.id}>{target.name}</option>}
              {flowData.nodes.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>

          {/* Show related toggle */}
          <label className="flow-toggle-label">
            <input
              type="checkbox"
              checked={showRelated}
              onChange={(e) => setShowRelated(e.target.checked)}
              className="flow-checkbox"
            />
            <span>Show related links</span>
          </label>
        </div>

        <div className="flow-toolbar-right">
          {/* Zoom Controls */}
          <div className="flow-zoom-controls">
            <button
              type="button"
              onClick={() => setTransform(t => ({ ...t, k: Math.min(2.5, t.k * 1.2) }))}
              className="flow-btn-icon"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={() => setTransform(t => ({ ...t, k: Math.max(0.4, t.k * 0.8) }))}
              className="flow-btn-icon"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              onClick={() => setTransform({ x: 40, y: 40, k: 1 })}
              className="flow-btn-icon"
              title="Fit flowchart"
              aria-label="Fit view"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          {/* Fullscreen */}
          <button
            type="button"
            className="flow-btn-icon"
            onClick={() => setIsFullscreen(f => !f)}
            title="Toggle fullscreen"
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Guest Mode Banner */}
      {!isAuthenticated && (
        <div className="flow-guest-banner" role="status">
          <UserCheck size={16} />
          <span>Viewing prerequisite flow in guest mode. <strong>Sign in to track progress</strong> and unlock custom study sequences.</span>
        </div>
      )}

      {/* 2. Main Flow Workspace: Layered Columns Canvas & Side Progress Panel */}
      <div className="flow-workspace">
        {/* Desktop / Tablet Canvas Mode */}
        <div
          className="flow-canvas-viewport hide-on-phone"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          role="region"
          aria-label="Prerequisite Flowchart Diagram"
        >
          <svg className="flow-svg-stage" width="100%" height="100%">
            <defs>
              <marker id="flow-arrow-thick" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#6FC21A" />
              </marker>
              <marker id="flow-arrow-grey" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#94A3B8" />
              </marker>
            </defs>

            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* Step Column Header Banners */}
              {flowData.columns.map((col, idx) => (
                <g key={col.stage_index} transform={`translate(${idx * 280 + 60}, 20)`}>
                  <rect x="-100" y="0" width="200" height="34" rx="8" fill="rgba(154, 230, 46, 0.15)" stroke="rgba(111, 180, 26, 0.3)" />
                  <text x="0" y="22" textAnchor="middle" fontSize="13" fontWeight="800" fill="#2E5E04" letterSpacing="0.06em">
                    {col.title.toUpperCase()}
                  </text>
                </g>
              ))}

              {/* Edge Connecting Lines */}
              {renderedEdges.map(edge => {
                const sPos = nodePositionMap[edge.source];
                const tPos = nodePositionMap[edge.target];
                if (!sPos || !tPos) return null;

                const isPathEdge = edge.is_path;
                const isSuggested = edge.origin === 'suggested';

                const strokeColor = isPathEdge ? '#6FC21A' : '#94A3B8';
                const strokeWidth = isPathEdge ? 3 : 1.5;
                const strokeDash = isSuggested ? '5,4' : 'none';
                const marker = isPathEdge ? 'url(#flow-arrow-thick)' : 'url(#flow-arrow-grey)';

                const midX = (sPos.x + tPos.x) / 2;

                return (
                  <path
                    key={edge.id}
                    d={`M ${sPos.x + 90} ${sPos.y} C ${midX} ${sPos.y}, ${midX} ${tPos.y}, ${tPos.x - 90} ${tPos.y}`}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDash}
                    markerEnd={marker}
                    opacity={isPathEdge ? 1 : 0.65}
                  />
                );
              })}

              {/* Node Cards */}
              {flowData.columns.flatMap(col => {
                const colNodes = flowData.nodes.filter(n => col.node_ids.includes(n.id));
                return colNodes.map(node => {
                  const pos = nodePositionMap[node.id];
                  if (!pos) return null;

                  const isStudied = node.state === 'studied';
                  const isNextUp = node.state === 'next_up';
                  const isLocked = node.state === 'locked';

                  let fillBg = '#FFFFFF';
                  let strokeBorder = '#CBD5E1';
                  let strokeWidth = 1.5;
                  let strokeDash = 'none';

                  if (isStudied) {
                    fillBg = '#9AE62E';
                    strokeBorder = '#10140C';
                    strokeWidth = 2;
                  } else if (isNextUp) {
                    fillBg = '#FFFFFF';
                    strokeBorder = '#6FC21A';
                    strokeWidth = 2.5;
                  } else if (isLocked) {
                    fillBg = 'rgba(241, 245, 249, 0.7)';
                    strokeBorder = '#94A3B8';
                    strokeDash = '4,4';
                  }

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => {
                        setSelectedTarget(node.name || node.id);
                        onSelectConcept({ id: node.id, name: node.name });
                      }}
                      style={{ cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.name}, Step ${node.stage_index + 1}, ${node.state}`}
                    >
                      <rect
                        x="-90"
                        y="-30"
                        width="180"
                        height="60"
                        rx="12"
                        fill={fillBg}
                        stroke={strokeBorder}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDash}
                        filter="drop-shadow(0 4px 10px rgba(16, 20, 12, 0.06))"
                      />

                      {/* State badge / icon */}
                      {isStudied && (
                        <circle cx="70" cy="-16" r="8" fill="#10140C" />
                      )}
                      {isLocked && (
                        <circle cx="70" cy="-16" r="7" fill="#94A3B8" />
                      )}

                      {/* Next Up Pill Tag */}
                      {isNextUp && (
                        <g transform="translate(45, -24)">
                          <rect x="-35" y="-8" width="70" height="16" rx="8" fill="#6FC21A" />
                          <text x="0" y="4" textAnchor="middle" fontSize="9" fontWeight="800" fill="#FFFFFF">
                            NEXT UP
                          </text>
                        </g>
                      )}

                      {/* Concept name */}
                      <text
                        x="-75"
                        y="5"
                        fontSize="13"
                        fontWeight="700"
                        fill="#10140C"
                      >
                        {node.name.length > 17 ? `${node.name.slice(0, 15)}…` : node.name}
                      </text>

                      {/* Minutes tag */}
                      <text
                        x="-75"
                        y="20"
                        fontSize="10"
                        fontWeight="600"
                        fill={isStudied ? '#2E5E04' : '#64748B'}
                      >
                        ~{node.estimated_minutes || 10} min
                      </text>
                    </g>
                  );
                });
              })}
            </g>
          </svg>
        </div>

        {/* Mobile View: Clean Vertical Top-to-Bottom Steps (320-430px) */}
        <div className="flow-mobile-steplist show-on-phone" role="list" aria-label="Vertical Prerequisite Step Sequence">
          {flowData.nodes.map((node, index) => {
            const isStudied = node.state === 'studied';
            const isNextUp = node.state === 'next_up';
            const isLocked = node.state === 'locked';

            return (
              <div key={node.id} className="flow-mobile-step-row" role="listitem">
                <div className="flow-step-connector-col">
                  <div className={`flow-step-node-badge ${node.state}`}>
                    {isStudied ? <CheckCircle2 size={16} /> : isLocked ? <Lock size={14} /> : <span>{index + 1}</span>}
                  </div>
                  {index < flowData.nodes.length - 1 && <div className="flow-step-line" />}
                </div>

                <div
                  className={`flow-mobile-step-card ${node.state}`}
                  onClick={() => onSelectConcept({ id: node.id, name: node.name })}
                >
                  <div className="flow-mobile-step-header">
                    <span className="flow-step-stage-tag">STEP {node.stage_index + 1}</span>
                    {isNextUp && <span className="flow-badge-nextup">Next up</span>}
                    {isStudied && <span className="flow-badge-done">Done</span>}
                  </div>
                  <strong className="flow-mobile-step-title">{node.name}</strong>
                  <div className="flow-mobile-step-meta">
                    <Clock size={12} />
                    <span>~{node.estimated_minutes || 10} mins</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 3. Side Panel: Path Progress & Continue Action */}
        <aside className="flow-side-panel" aria-label="Path to Target Concept Progress">
          <div className="flow-progress-card">
            <span className="flow-panel-eyebrow">LEARNING SEQUENCE</span>
            <h3 className="flow-path-title">Path to {target?.name || 'Target'}</h3>

            {/* Progress bar */}
            <div className="flow-progress-bar-wrap">
              <div className="flow-progress-bar-track">
                <div className="flow-progress-bar-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flow-progress-text-row">
                <span><strong>{progress.studied_steps} of {progress.total_steps}</strong> steps done</span>
                <span><strong>{progressPct}%</strong></span>
              </div>
            </div>

            <div className="flow-time-left">
              <Clock size={14} />
              <span>~{progress.estimated_minutes_left || 0} minutes remaining</span>
            </div>

            {/* Continue button */}
            {nextUpNode && (
              <button
                type="button"
                className="flow-continue-btn"
                onClick={() => {
                  setSelectedTarget(nextUpNode.name || nextUpNode.id);
                  onSelectConcept({ id: nextUpNode.id, name: nextUpNode.name });
                }}
                aria-label={`Continue with next concept: ${nextUpNode.name}`}
              >
                <span>Continue: <strong>{nextUpNode.name}</strong></span>
                <ArrowRight size={15} />
              </button>
            )}
          </div>

          {/* Ordered Step-by-Step Checklist */}
          <div className="flow-steps-checklist" role="region" aria-label="Ordered Prerequisites Checklist">
            <h4 className="flow-steps-heading">Prerequisite Steps</h4>
            <div className="flow-checklist-items">
              {flowData.nodes.map((step, idx) => (
                <div key={step.id} className={`flow-checklist-item ${step.state}`}>
                  <div className="flow-check-icon">
                    {step.state === 'studied' ? (
                      <CheckCircle2 size={16} className="text-lime-done" />
                    ) : step.state === 'locked' ? (
                      <Lock size={14} className="text-locked" />
                    ) : (
                      <span className="flow-step-num">{idx + 1}</span>
                    )}
                  </div>
                  <div className="flow-check-info">
                    <strong>{step.name}</strong>
                    <span className="flow-check-stage">Step {step.stage_index + 1} &bull; ~{step.estimated_minutes || 10} min</span>
                  </div>
                  {isAuthenticated && (
                    <button
                      type="button"
                      className={`flow-toggle-studied-btn ${step.state === 'studied' ? 'is-studied' : ''}`}
                      onClick={() => onToggleStudied(step.id)}
                      title={step.state === 'studied' ? 'Mark unstudied' : 'Mark studied'}
                      aria-label={`Toggle studied status for ${step.name}`}
                    >
                      {step.state === 'studied' ? 'Studied' : 'Mark done'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
