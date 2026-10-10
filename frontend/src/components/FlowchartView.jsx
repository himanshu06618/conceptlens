import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, MiniMap, Controls, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng, toSvg } from 'html-to-image';
import { BookOpen, ExternalLink, X, FileText, Sparkles } from 'lucide-react';
import { getDocumentFlowchart, getDocumentFileUrl } from '../api/client';
import { layoutFlow } from '../utils/flowLayout';
import { downloadText, toMermaid } from '../utils/flowchartExport';
import { cleanText } from '../utils/textCleaner';

function FlowchartCanvas({
  documentId,
  topics,
  concepts = [],
  selectedConcept,
  onSelectConcept,
  onRedirectToDescription,
  query,
  setQuery
}) {
  const [topic, setTopic] = useState('');
  const [subflow, setSubflow] = useState(0);
  const [related, setRelated] = useState(false);
  const [direction, setDirection] = useState('LR');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selectedFlowConcept, setSelectedFlowConcept] = useState(null);
  const { fitView } = useReactFlow();

  useEffect(() => {
    let active = true;
    getDocumentFlowchart(documentId, { topic, subflow, includeRelated: related })
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message || 'Could not load flowchart.'); });
    return () => { active = false; };
  }, [documentId, topic, subflow, related]);

  const visibleNodes = useMemo(() => {
    const source = data?.nodes || [];
    const needle = query.trim().toLocaleLowerCase();
    const matched = new Set(source.filter((node) => !needle || String(node.label).toLocaleLowerCase().includes(needle)).map((node) => node.id));
    return source.map((node) => {
      const selected = (selectedConcept && String(node.concept_id) === String(selectedConcept.id)) ||
                       (selectedFlowConcept && String(node.concept_id) === String(selectedFlowConcept.id));
      return {
        id: String(node.id),
        position: { x: 0, y: 0 },
        data: { ...node, label: node.label, selected },
        className: `flow-node flow-node-${node.node_type || 'concept'}${needle && !matched.has(node.id) ? ' flow-node-dim' : ''}`,
      };
    });
  }, [data, query, selectedConcept, selectedFlowConcept]);
  const visibleEdges = useMemo(() => (data?.edges || []).map((edge) => ({
    ...edge, id: String(edge.id), source: String(edge.source), target: String(edge.target),
    label: edge.label || undefined, animated: edge.type === 'sequence',
    style: { stroke: edge.type === 'sequence' ? '#397F69' : '#7C9C83', strokeWidth: 2 },
  })), [data]);
  const nodes = useMemo(() => layoutFlow(visibleNodes, visibleEdges, direction), [visibleNodes, visibleEdges, direction]);

  useEffect(() => {
    if (nodes.length) fitView({ padding: 0.2, duration: 250 });
  }, [nodes, fitView]);

  const handleExportImage = async (format) => {
    const element = document.querySelector('.flowchart-canvas .react-flow');
    if (!element) return;
    setExporting(true);
    try {
      const toImage = format === 'svg' ? toSvg : toPng;
      const image = await toImage(element, { backgroundColor: '#F7F8F5', pixelRatio: 2 });
      const anchor = document.createElement('a');
      anchor.href = image;
      anchor.download = `${documentId}-flowchart.${format}`;
      anchor.click();
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleNodeClick = (_, node) => {
    // Attempt matching with full concepts array or reconstruct from node attributes
    const found = concepts.find((item) =>
      (node.data?.concept_id && String(item.id) === String(node.data.concept_id)) ||
      String(item.name || '').trim().toLowerCase() === String(node.data?.label || '').trim().toLowerCase()
    );

    const concept = found || (node.data?.concept_id || node.data?.node_type === 'concept' ? {
      id: node.data?.concept_id || node.id,
      name: node.data?.label || 'Concept',
      definition: node.data?.definition || '',
      source_excerpt: node.data?.source_excerpt || '',
      page: node.data?.page || 1,
      topic: node.data?.topic || topic || 'General',
    } : null);

    if (concept) {
      setSelectedFlowConcept(concept);
      onSelectConcept?.(concept);
    } else {
      setSelectedFlowConcept(null);
    }

    if (data?.overview && node.data?.topic) {
      setTopic(node.data.topic);
      setSubflow(0);
    }
  };

  const handleRedirect = () => {
    if (!selectedFlowConcept) return;
    if (onRedirectToDescription) {
      onRedirectToDescription(selectedFlowConcept);
    } else if (onSelectConcept) {
      onSelectConcept(selectedFlowConcept);
    }
  };

  const handleDeepDive = () => {
    if (!selectedFlowConcept) return;
    const pageNum = selectedFlowConcept.page || 1;
    const fileUrl = getDocumentFileUrl(documentId, pageNum);
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  const selectedTopic = topic || '';
  const topicOptions = [...new Set([...(topics || []), ...(data?.topics || [])])];
  return (
    <section className="flowchart-view" aria-label="Interactive document flowchart">
      <div className="flowchart-toolbar">
        <select aria-label="Flowchart topic" value={selectedTopic} onChange={(event) => { setTopic(event.target.value); setSubflow(0); }}>
          <option value="">Topic overview</option>
          {topicOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <input aria-label="Search flowchart" placeholder="Search diagram..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" onClick={() => setDirection((value) => value === 'LR' ? 'TB' : 'LR')}>Direction: {direction === 'LR' ? 'Horizontal' : 'Vertical'}</button>
        <button type="button" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((open) => !open)}>Outline</button>
        <label><input type="checkbox" checked={related} onChange={(event) => setRelated(event.target.checked)} /> Related links</label>
        <button type="button" onClick={() => downloadText(`${documentId}-flowchart.json`, JSON.stringify(data, null, 2), 'application/json')} disabled={!data}>JSON</button>
        <button type="button" onClick={() => downloadText(`${documentId}-flowchart.mmd`, toMermaid({ nodes, edges: visibleEdges }))} disabled={!data}>Mermaid</button>
        <button type="button" onClick={() => handleExportImage('png')} disabled={!data || exporting}>PNG</button>
        <button type="button" onClick={() => handleExportImage('svg')} disabled={!data || exporting}>SVG</button>
      </div>
      {!data && !error && <div className="flowchart-status" role="status">Loading flowchart…</div>}
      {error && <div className="flowchart-status flowchart-error" role="alert">{error}</div>}
      {data && <div className="flowchart-meta">{data.total_concepts ?? concepts.length} concepts {topic ? `· ${topic}` : '· Overview'}</div>}
      {data && !data.overview && data.subflow_count > 1 && (
        <nav className="flowchart-pages" aria-label="Flowchart pages">
          <button type="button" disabled={subflow === 0} onClick={() => setSubflow((page) => page - 1)}>Previous part</button>
          <span>Part {subflow + 1} of {data.subflow_count}</span>
          <button type="button" disabled={subflow + 1 >= data.subflow_count} onClick={() => setSubflow((page) => page + 1)}>Next part</button>
        </nav>
      )}
      {outlineOpen && data && (
        <nav className="flowchart-outline" aria-label="Diagram outline">
          {nodes.filter((node) => !['start', 'end'].includes(node.data.node_type)).map((node) => (
            <button key={node.id} type="button" onClick={() => fitView({ nodes: [{ id: node.id }], padding: 0.5, duration: 250 })}>
              {node.data.label}
            </button>
          ))}
        </nav>
      )}
      <div className="flowchart-canvas" style={{ position: 'relative' }}>
        {data && (
          <ReactFlow
            nodes={nodes}
            edges={visibleEdges}
            fitView
            nodesDraggable
            nodesConnectable={false}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedFlowConcept(null)}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        )}

        {/* Selected Concept Action Popover */}
        {selectedFlowConcept && (
          <div className="flowchart-concept-popover" role="dialog" aria-label={`Concept actions for ${selectedFlowConcept.name}`}>
            <div className="flowchart-popover-header">
              <div className="flowchart-popover-title-row">
                <span className="flowchart-popover-tag">
                  <Sparkles size={12} className="tag-icon" />
                  Concept
                </span>
                <h4 className="flowchart-popover-title">{selectedFlowConcept.name}</h4>
              </div>
              <button
                type="button"
                className="flowchart-popover-close-btn"
                onClick={() => setSelectedFlowConcept(null)}
                aria-label="Close concept action card"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flowchart-popover-meta">
              {selectedFlowConcept.topic && (
                <span className="flowchart-popover-topic-chip">
                  {selectedFlowConcept.topic}
                </span>
              )}
              <span className="flowchart-popover-page-chip">
                Page {selectedFlowConcept.page || 1}
              </span>
            </div>

            {(selectedFlowConcept.definition || selectedFlowConcept.source_excerpt) && (
              <p className="flowchart-popover-snippet">
                "{cleanText(selectedFlowConcept.definition || selectedFlowConcept.source_excerpt)}"
              </p>
            )}

            <div className="flowchart-popover-actions">
              <button
                type="button"
                className="flowchart-popover-btn primary"
                onClick={handleRedirect}
                title="Jump to concept definition and full details"
              >
                <BookOpen size={14} />
                <span>View Concept Description</span>
              </button>

              <button
                type="button"
                className="flowchart-popover-btn secondary"
                onClick={handleDeepDive}
                title={`Open PDF at Page ${selectedFlowConcept.page || 1}`}
              >
                <ExternalLink size={14} />
                <span>Deep Dive (Page {selectedFlowConcept.page || 1})</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function FlowchartView(props) {
  return <ReactFlowProvider><FlowchartCanvas {...props} /></ReactFlowProvider>;
}
