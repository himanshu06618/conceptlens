import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { ChevronRight, ChevronDown, Plus, Minus, GitBranch, Layers, Sparkles } from 'lucide-react';

const BRANCH_COLOR_MAP = [
  { name: 'mint', hex: '#397F69', tint: 'rgba(57, 127, 105, 0.14)', text: '#316F5B' },
  { name: 'sage', hex: '#6A8C78', tint: 'rgba(106, 140, 120, 0.16)', text: '#526D5D' },
  { name: 'olive', hex: '#7C9C83', tint: 'rgba(124, 156, 131, 0.16)', text: '#5F7A65' },
  { name: 'clay', hex: '#C17D55', tint: 'rgba(193, 125, 85, 0.14)', text: '#985A35' },
  { name: 'moss', hex: '#8A9A7A', tint: 'rgba(138, 154, 122, 0.16)', text: '#64724F' },
  { name: 'fern', hex: '#8BA99A', tint: 'rgba(139, 169, 154, 0.16)', text: '#5C7969' },
];

export function getBranchColor(index = 0) {
  return BRANCH_COLOR_MAP[Math.abs(index) % BRANCH_COLOR_MAP.length];
}

/**
 * Root Node (Level 0)
 * Dark charcoal root topic with a restrained green accent
 */
export const RootNode = memo(({ data, selected }) => {
  const isHorizontal = data.orientation !== 'TB';
  return (
    <div
      className={`tree-node tree-node-root ${selected ? 'is-selected' : ''} ${data.isDimmed ? 'is-dimmed' : ''} ${data.isHighlighted ? 'is-highlighted' : ''}`}
      style={{
        background: 'linear-gradient(135deg, #252D2A 0%, #34443D 100%)',
        border: selected ? '2px solid var(--gold-bright)' : '1px solid rgba(57, 127, 105, 0.65)',
        boxShadow: data.isHighlighted || selected 
          ? '0 0 24px rgba(57, 127, 105, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)' 
          : '0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
        borderRadius: 20,
        padding: '16px 22px',
        color: '#FFFFFF',
        minWidth: 220,
        maxWidth: 300,
        transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        opacity: data.isDimmed ? 0.35 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: 'rgba(57, 127, 105, 0.16)',
          border: '1px solid var(--gold)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--gold-bright)'
        }}>
          <Sparkles size={16} strokeWidth={2.2} />
        </div>
        <div>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gold-bright)', fontWeight: 600 }}>
            Root Topic
          </span>
          <div style={{ fontSize: 11, color: 'var(--midnight-text-muted)' }}>
            {data.childCount || 0} branches
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '1.25rem',
        fontWeight: 600,
        color: '#FFFFFF',
        lineHeight: 1.25,
        letterSpacing: '-0.02em',
        wordBreak: 'break-word'
      }}>
        {data.label}
      </div>

      {/* Connection Handle (Outgoing only) */}
      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        style={{
          background: 'var(--gold)',
          width: 10,
          height: 10,
          border: '2px solid #252D2A'
        }}
      />
    </div>
  );
});

/**
 * Topic Node (Level 1)
 * Pill / card in branch color with icon, child count, and circular +/- toggle button
 */
export const TopicNode = memo(({ data, selected }) => {
  const isHorizontal = data.orientation !== 'TB';
  const branch = getBranchColor(data.branchColorIndex);
  const isCollapsed = data.isCollapsed;

  const handleToggle = (e) => {
    e.stopPropagation();
    if (data.onToggle) data.onToggle(data.id);
  };

  return (
    <div
      className={`tree-node tree-node-topic ${selected ? 'is-selected' : ''} ${data.isDimmed ? 'is-dimmed' : ''} ${data.isHighlighted ? 'is-highlighted' : ''}`}
      style={{
        background: branch.tint,
        border: `1.5px solid ${branch.hex}`,
        boxShadow: data.isHighlighted || selected
          ? `0 0 20px ${branch.hex}88, inset 0 1px 0 rgba(255, 255, 255, 0.2)`
          : `0 6px 20px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        borderRadius: 16,
        padding: '12px 16px',
        color: '#FFFFFF',
        minWidth: 190,
        maxWidth: 260,
        backdropFilter: 'blur(12px)',
        transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        opacity: data.isDimmed ? 0.35 : 1
      }}
    >
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        style={{ background: branch.hex, width: 8, height: 8, border: '2px solid #17211C' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            background: `${branch.hex}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: branch.hex,
            flexShrink: 0
          }}>
            <Layers size={13} strokeWidth={2.2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.95rem',
              fontWeight: 600,
              color: '#FFFFFF',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {data.label}
            </div>
            <div style={{ fontSize: 10, color: branch.text, fontWeight: 500 }}>
              {data.childCount || 0} concepts
            </div>
          </div>
        </div>

        {/* Circular +/- Expand/Collapse Button */}
        {data.childCount > 0 && (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={isCollapsed ? `Expand ${data.label}` : `Collapse ${data.label}`}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: isCollapsed ? branch.hex : 'rgba(255, 255, 255, 0.12)',
              border: `1px solid ${branch.hex}`,
              color: isCollapsed ? '#252D2A' : '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.2s ease',
              padding: 0
            }}
          >
            {isCollapsed ? <Plus size={14} strokeWidth={2.5} /> : <Minus size={14} strokeWidth={2.5} />}
          </button>
        )}
      </div>

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        style={{ background: branch.hex, width: 8, height: 8, border: '2px solid #17211C' }}
      />
    </div>
  );
});

/**
 * Concept Node (Level 2)
 * Compact white-glass card with name, importance dots, definition preview, and branch accent bar
 */
export const ConceptNode = memo(({ data, selected }) => {
  const isHorizontal = data.orientation !== 'TB';
  const branch = getBranchColor(data.branchColorIndex);
  const isCollapsed = data.isCollapsed;

  const handleToggle = (e) => {
    e.stopPropagation();
    if (data.onToggle) data.onToggle(data.id);
  };

  const importanceDots = Array.from({ length: 5 }).map((_, i) => (
    <span
      key={i}
      style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        display: 'inline-block',
        background: i < (data.importance || 3) ? 'var(--gold-bright)' : 'rgba(255, 255, 255, 0.2)',
        marginRight: 2
      }}
    />
  ));

  return (
    <div
      className={`tree-node tree-node-concept ${selected ? 'is-selected' : ''} ${data.isDimmed ? 'is-dimmed' : ''} ${data.isHighlighted ? 'is-highlighted' : ''}`}
      style={{
        background: 'rgba(255, 255, 255, 0.08)',
        border: selected ? '1.5px solid var(--gold-bright)' : '1px solid rgba(255, 255, 255, 0.16)',
        borderLeft: `4px solid ${branch.hex}`,
        boxShadow: data.isHighlighted || selected
          ? `0 0 20px ${branch.hex}77, inset 0 1px 0 rgba(255, 255, 255, 0.2)`
          : '0 6px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        padding: '10px 14px',
        color: '#FFFFFF',
        minWidth: 200,
        maxWidth: 270,
        backdropFilter: 'blur(14px)',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        opacity: data.isDimmed ? 0.35 : 1
      }}
    >
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        style={{ background: branch.hex, width: 8, height: 8, border: '2px solid #17211C' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {importanceDots}
        </div>
        {data.childCount > 0 && (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={isCollapsed ? `Expand ${data.label}` : `Collapse ${data.label}`}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: isCollapsed ? branch.hex : 'rgba(255, 255, 255, 0.15)',
              border: `1px solid ${branch.hex}`,
              color: isCollapsed ? '#252D2A' : '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0
            }}
          >
            {isCollapsed ? <Plus size={11} strokeWidth={2.5} /> : <Minus size={11} strokeWidth={2.5} />}
          </button>
        )}
      </div>

      <div style={{
        fontWeight: 600,
        fontSize: '0.92rem',
        color: '#FFFFFF',
        marginBottom: 3,
        lineHeight: 1.3,
        wordBreak: 'break-word'
      }}>
        {data.label}
      </div>

      {data.shortDefinition && (
        <div style={{
          fontSize: 11,
          color: 'var(--midnight-text-muted)',
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}>
          {data.shortDefinition}
        </div>
      )}

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        style={{ background: branch.hex, width: 8, height: 8, border: '2px solid #17211C' }}
      />
    </div>
  );
});

/**
 * Sub-concept Node (Level 3)
 * Lighter, compact chip with subtle border and dot
 */
export const SubConceptNode = memo(({ data, selected }) => {
  const isHorizontal = data.orientation !== 'TB';
  const branch = getBranchColor(data.branchColorIndex);

  return (
    <div
      className={`tree-node tree-node-subconcept ${selected ? 'is-selected' : ''} ${data.isDimmed ? 'is-dimmed' : ''} ${data.isHighlighted ? 'is-highlighted' : ''}`}
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        border: selected ? '1.5px solid var(--gold-bright)' : '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 12,
        padding: '8px 12px',
        color: '#FFFFFF',
        minWidth: 160,
        maxWidth: 220,
        backdropFilter: 'blur(10px)',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        opacity: data.isDimmed ? 0.35 : 1
      }}
    >
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        style={{ background: branch.hex, width: 6, height: 6, border: '1px solid #17211C' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: branch.hex,
          flexShrink: 0
        }} />
        <span style={{
          fontSize: '0.82rem',
          fontWeight: 500,
          color: 'var(--midnight-text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {data.label}
        </span>
      </div>

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        style={{ background: branch.hex, width: 6, height: 6, border: '1px solid #17211C' }}
      />
    </div>
  );
});

/**
 * More Node
 * Expandable pill for overflowed nodes (e.g. "+ 5 more")
 */
export const MoreNode = memo(({ data, selected }) => {
  const isHorizontal = data.orientation !== 'TB';
  const branch = getBranchColor(data.branchColorIndex);

  const handleClick = (e) => {
    e.stopPropagation();
    if (data.onExpandMore) data.onExpandMore(data.id);
  };

  return (
    <div
      onClick={handleClick}
      className={`tree-node tree-node-more ${selected ? 'is-selected' : ''}`}
      style={{
        background: 'rgba(57, 127, 105, 0.08)',
        border: '1px dashed rgba(57, 127, 105, 0.5)',
        borderRadius: 12,
        padding: '6px 12px',
        color: 'var(--gold-bright)',
        fontSize: '0.8rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        minWidth: 120
      }}
    >
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        style={{ background: 'var(--gold)', width: 6, height: 6, border: '1px solid #17211C' }}
      />
      <Plus size={12} strokeWidth={2.5} />
      <span>{data.label}</span>
    </div>
  );
});

export const nodeTypes = {
  root: RootNode,
  topic: TopicNode,
  concept: ConceptNode,
  subconcept: SubConceptNode,
  more: MoreNode
};
