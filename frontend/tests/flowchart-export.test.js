import test from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid } from '../src/utils/flowchartExport.js';

test('Mermaid export serializes decision nodes and labeled edges', () => {
  const result = toMermaid({
    nodes: [
      { id: 'start:1', data: { label: 'Start', node_type: 'start' } },
      { id: 'decision:2', data: { label: 'Is valid?', node_type: 'decision' } },
    ],
    edges: [{ source: 'start:1', target: 'decision:2', label: 'next' }],
  });
  assert.match(result, /^flowchart TD/);
  assert.match(result, /Is valid\?/);
  assert.match(result, /\|next\|/);
});
