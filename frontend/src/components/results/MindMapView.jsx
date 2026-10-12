import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Compass,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  Sparkles,
  ChevronRight
} from 'lucide-react';

export default function MindMapView({
  documentData,
  concepts = [],
  selectedConcept,
  onSelectConcept,
  searchQuery = ''
}) {
  const containerRef = useRef(null);

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

  const chapterNames = useMemo(() => Array.from(chaptersMap.keys()), [chaptersMap]);

  // Determine initial open chapter: chapter containing selectedConcept or first chapter
  const initialOpenChapter = useMemo(() => {
    if (selectedConcept) {
      return selectedConcept.chapter || selectedConcept.topic || 'General';
    }
    return chapterNames[0] || 'General';
  }, [selectedConcept, chapterNames]);

  const [openChapter, setOpenChapter] = useState(initialOpenChapter);
  const [showAllConceptsForChapter, setShowAllConceptsForChapter] = useState(false);

  // Pan and Zoom transform state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Update open chapter if selectedConcept changes
  useEffect(() => {
    if (selectedConcept) {
      const targetCh = selectedConcept.chapter || selectedConcept.topic || 'General';
      setOpenChapter(targetCh);
      setShowAllConceptsForChapter(false);
    }
  }, [selectedConcept]);

  const handleResetCenter = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  // Zoom handlers
  const handleZoom = (factor) => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.3, Math.min(2.5, prev.scale * factor)),
    }));
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    handleZoom(factor);
  };

  // Drag handlers
  const handleMouseDown = (e) => {
    if (e.target.closest('.mindmap-interactive-node') || e.target.closest('.mindmap-controls')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch handlers for mobile pan & pinch zoom
  const touchStartDistRef = useRef(0);
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX - transform.x, y: e.touches[0].clientY - transform.y };
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 1 && isDragging) {
      setTransform((prev) => ({
        ...prev,
        x: e.touches[0].clientX - dragStartRef.current.x,
        y: e.touches[0].clientY - dragStartRef.current.y,
      }));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchStartDistRef.current > 0) {
        const factor = dist / touchStartDistRef.current;
        touchStartDistRef.current = dist;
        setTransform((prev) => ({
          ...prev,
          scale: Math.max(0.3, Math.min(2.5, prev.scale * factor)),
        }));
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartDistRef.current = 0;
  };

  // Geometry computation
  // Center at (0, 0)
  const R_CHAPTER = 230; // Radius for chapters orbit
  const R_CONCEPT = 420; // Radius for concepts orbit

  const layout = useMemo(() => {
    const totalChapters = chapterNames.length;
    if (totalChapters === 0) return { chapters: [], concepts: [] };

    const chaptersData = chapterNames.map((chName, idx) => {
      // Angle for chapter
      const angle = (2 * Math.PI * idx) / totalChapters - Math.PI / 2;
      const x = Math.round(R_CHAPTER * Math.cos(angle));
      const y = Math.round(R_CHAPTER * Math.sin(angle));
      const isOpen = chName === openChapter;
      const chConcepts = chaptersMap.get(chName) || [];

      return {
        name: chName,
        x,
        y,
        angle,
        isOpen,
        totalConcepts: chConcepts.length,
      };
    });

    // Concepts for open chapter
    const activeChConcepts = chaptersMap.get(openChapter) || [];
    const openChData = chaptersData.find((c) => c.isOpen);
    const conceptsData = [];

    if (openChData && activeChConcepts.length > 0) {
      const maxDisplay = showAllConceptsForChapter ? activeChConcepts.length : 30;
      const displayedConcepts = activeChConcepts.slice(0, maxDisplay);
      const remainingCount = activeChConcepts.length - maxDisplay;

      // Fan concepts out in an arc centered at the chapter's angle
      const arcSpread = Math.min(Math.PI * 1.3, (displayedConcepts.length * Math.PI) / 12);
      const startAngle = openChData.angle - arcSpread / 2;

      displayedConcepts.forEach((c, cIdx) => {
        const step = displayedConcepts.length > 1 ? arcSpread / (displayedConcepts.length - 1) : 0;
        const cAngle = startAngle + step * cIdx;
        const cx = Math.round(R_CONCEPT * Math.cos(cAngle));
        const cy = Math.round(R_CONCEPT * Math.sin(cAngle));
        const isSelected = selectedConcept && String(selectedConcept.id) === String(c.id);

        conceptsData.push({
          concept: c,
          x: cx,
          y: cy,
          chapterX: openChData.x,
          chapterY: openChData.y,
          isSelected,
        });
      });

      // Add '+N more' expander node if remaining
      if (remainingCount > 0) {
        const moreAngle = startAngle + arcSpread + 0.15;
        const mx = Math.round(R_CONCEPT * Math.cos(moreAngle));
        const my = Math.round(R_CONCEPT * Math.sin(moreAngle));
        conceptsData.push({
          isMoreNode: true,
          remainingCount,
          x: mx,
          y: my,
          chapterX: openChData.x,
          chapterY: openChData.y,
        });
      }
    }

    return { chapters: chaptersData, concepts: conceptsData };
  }, [chapterNames, openChapter, chaptersMap, selectedConcept, showAllConceptsForChapter]);

  return (
    <div
      ref={containerRef}
      className="mindmap-view-container"
      role="region"
      aria-label="Radial Mind Map View"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Mindmap Controls Toolbar */}
      <div className="mindmap-controls">
        <button
          type="button"
          onClick={() => handleZoom(1.15)}
          className="mindmap-btn"
          title="Zoom In"
          aria-label="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(0.85)}
          className="mindmap-btn"
          title="Zoom Out"
          aria-label="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={handleResetCenter}
          className="mindmap-btn"
          title="Reset to Center"
          aria-label="Reset view to center"
        >
          <RotateCcw size={16} />
          <span>Center</span>
        </button>
      </div>

      {/* Interactive Radial SVG Canvas */}
      <svg
        className="mindmap-svg-canvas"
        viewBox="-600 -450 1200 900"
        aria-label="Mind map radial graph"
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Subtle Orbit Rings */}
          <circle cx="0" cy="0" r={R_CHAPTER} className="orbit-ring orbit-chapters" />
          <circle cx="0" cy="0" r={R_CONCEPT} className="orbit-ring orbit-concepts" />

          {/* Chapter Connector Lines (Center -> Chapters) */}
          {layout.chapters.map((ch) => (
            <path
              key={`line_ch_${ch.name}`}
              d={`M 0 0 Q ${ch.x * 0.5} ${ch.y * 0.5} ${ch.x} ${ch.y}`}
              className={`mindmap-edge ${ch.isOpen ? 'is-active' : ''}`}
            />
          ))}

          {/* Concept Connector Lines (Open Chapter -> Concepts) */}
          {layout.concepts.map((c, idx) => (
            <path
              key={`line_c_${c.concept?.id || idx}`}
              d={`M ${c.chapterX} ${c.chapterY} Q ${(c.chapterX + c.x) * 0.5} ${(c.chapterY + c.y) * 0.5} ${c.x} ${c.y}`}
              className={`mindmap-edge concept-edge ${c.isSelected ? 'is-selected' : ''}`}
            />
          ))}

          {/* Center Document Node */}
          <g className="mindmap-interactive-node center-node" onClick={handleResetCenter}>
            <circle cx="0" cy="0" r="54" className="center-node-circle" />
            <foreignObject x="-50" y="-35" width="100" height="70">
              <div className="center-node-content" xmlns="http://www.w3.org/1999/xhtml">
                <BookOpen size={16} className="center-icon" />
                <span className="center-title" title={documentData?.filename || 'Document'}>
                  {documentData?.filename || 'Document'}
                </span>
              </div>
            </foreignObject>
          </g>

          {/* Chapter Nodes */}
          {layout.chapters.map((ch) => (
            <g
              key={`node_ch_${ch.name}`}
              className={`mindmap-interactive-node chapter-node ${ch.isOpen ? 'is-open' : 'is-collapsed'}`}
              transform={`translate(${ch.x}, ${ch.y})`}
              onClick={() => {
                setOpenChapter(ch.name);
                setShowAllConceptsForChapter(false);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenChapter(ch.name);
                  setShowAllConceptsForChapter(false);
                }
              }}
            >
              <rect x="-85" y="-26" width="170" height="52" rx="26" className="chapter-rect" />
              <foreignObject x="-80" y="-22" width="160" height="44">
                <div className="chapter-node-html" xmlns="http://www.w3.org/1999/xhtml">
                  <span className="ch-title" title={ch.name}>{ch.name}</span>
                  <span className="ch-badge">
                    {ch.isOpen ? `${ch.totalConcepts}` : `+${ch.totalConcepts}`}
                  </span>
                </div>
              </foreignObject>
            </g>
          ))}

          {/* Concept Nodes for Open Chapter */}
          {layout.concepts.map((c, idx) => {
            if (c.isMoreNode) {
              return (
                <g
                  key="more_node"
                  className="mindmap-interactive-node more-concepts-node"
                  transform={`translate(${c.x}, ${c.y})`}
                  onClick={() => setShowAllConceptsForChapter(true)}
                  role="button"
                  tabIndex={0}
                >
                  <circle cx="0" cy="0" r="28" className="more-circle" />
                  <text x="0" y="4" textAnchor="middle" className="more-text">
                    +{c.remainingCount}
                  </text>
                </g>
              );
            }

            const concept = c.concept;
            const isStudied = concept.status === 'studied';

            return (
              <g
                key={`c_node_${concept.id}`}
                className={`mindmap-interactive-node concept-node ${c.isSelected ? 'is-selected' : ''}`}
                transform={`translate(${c.x}, ${c.y})`}
                onClick={() => onSelectConcept && onSelectConcept(concept)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectConcept && onSelectConcept(concept);
                  }
                }}
              >
                <rect x="-80" y="-24" width="160" height="48" rx="24" className="concept-rect" />
                <foreignObject x="-76" y="-20" width="152" height="40">
                  <div className="concept-node-html" xmlns="http://www.w3.org/1999/xhtml">
                    <div className="concept-title-row">
                      {isStudied ? (
                        <CheckCircle2 size={11} className="concept-check" />
                      ) : (
                        <Circle size={11} className="concept-circle" />
                      )}
                      <span className="c-name" title={concept.name}>{concept.name}</span>
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
