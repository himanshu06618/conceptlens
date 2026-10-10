import dagre from '@dagrejs/dagre';

export function layoutFlow(nodes, edges, direction = 'LR') {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: direction, nodesep: 34, ranksep: 70, marginx: 28, marginy: 28 });
  nodes.forEach((node) => graph.setNode(node.id, { width: 190, height: 64 }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const point = graph.node(node.id);
    return { ...node, position: { x: point.x - 95, y: point.y - 32 } };
  });
}
