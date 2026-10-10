export function toMermaid({ nodes, edges }) {
  const safeId = (id) => `n_${String(id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const safeLabel = (label) => String(label || '').replace(/["\n\r]/g, ' ').trim();
  const lines = ['flowchart TD'];
  nodes.forEach((node) => {
    const shape = node.data?.node_type === 'decision'
      ? `{${safeLabel(node.data.label)}}`
      : `[${safeLabel(node.data?.label)}]`;
    lines.push(`  ${safeId(node.id)}${shape}`);
  });
  edges.forEach((edge) => {
    const label = edge.label ? `|${safeLabel(edge.label)}|` : '';
    lines.push(`  ${safeId(edge.source)} -->${label} ${safeId(edge.target)}`);
  });
  return lines.join('\n');
}

export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
