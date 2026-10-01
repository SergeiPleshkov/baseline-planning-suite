export type FlowNode = object;

export interface FlowEdge {
  readonly from: FlowNode;
  readonly to: FlowNode;
  readonly lower: number;
  readonly upper: number;
  /** Paid per unit of flow; may be negative. */
  readonly cost: number;
}

interface ArcPair {
  spare: number;
  used: number;
}

interface Arc {
  readonly from: Vertex;
  readonly to: Vertex;
  readonly cost: number;
  readonly pair: ArcPair;
  readonly forward: boolean;
}

interface Vertex {
  readonly arcs: Arc[];
  distance: number;
  via: Arc | undefined;
  queued: boolean;
}

const newVertex = (): Vertex => ({ arcs: [], distance: Infinity, via: undefined, queued: false });

const residual = (arc: Arc): number => (arc.forward ? arc.pair.spare : arc.pair.used);

function push(arc: Arc, amount: number): void {
  const direction = arc.forward ? 1 : -1;
  arc.pair.spare -= direction * amount;
  arc.pair.used += direction * amount;
}

function connect(from: Vertex, to: Vertex, pair: ArcPair, cost: number): void {
  from.arcs.push({ from, to, cost, pair, forward: true });
  to.arcs.push({ from: to, to: from, cost: -cost, pair, forward: false });
}

/** Bellman–Ford with a queue: residual costs turn negative once flow is pushed back. */
function cheapestPath(vertices: readonly Vertex[], source: Vertex, sink: Vertex): Arc[] | null {
  for (const vertex of vertices) {
    vertex.distance = Infinity;
    vertex.via = undefined;
    vertex.queued = false;
  }
  source.distance = 0;
  const queue: Vertex[] = [source];
  for (const vertex of queue) {
    vertex.queued = false;
    for (const arc of vertex.arcs) {
      if (residual(arc) > 0 && vertex.distance + arc.cost < arc.to.distance) {
        arc.to.distance = vertex.distance + arc.cost;
        arc.to.via = arc;
        if (!arc.to.queued) {
          arc.to.queued = true;
          queue.push(arc.to);
        }
      }
    }
  }
  if (sink.distance === Infinity) return null;
  const path: Arc[] = [];
  for (let arc = sink.via; arc; arc = arc.from.via) path.push(arc);
  return path;
}

/**
 * The cheapest integral circulation that keeps every edge within its [lower, upper] bounds, or null
 * when the bounds cannot all hold at once. Negative-cost edges start saturated, so every residual
 * arc starts with a non-negative cost; successive cheapest paths then never meet a negative cycle
 * and end at an optimum.
 */
export function cheapestCirculation(
  edges: readonly FlowEdge[],
): ReadonlyMap<FlowEdge, number> | null {
  const vertices = new Map<FlowNode, Vertex>();
  const vertexOf = (node: FlowNode): Vertex => {
    const known = vertices.get(node);
    if (known) return known;
    const created = newVertex();
    vertices.set(node, created);
    return created;
  };

  const excess = new Map<Vertex, number>();
  const pairs = new Map<FlowEdge, ArcPair>();
  for (const edge of edges) {
    if (!Number.isInteger(edge.lower) || !Number.isInteger(edge.upper) || edge.upper < edge.lower) {
      throw new RangeError(`Invalid bounds [${String(edge.lower)}, ${String(edge.upper)}]`);
    }
    const from = vertexOf(edge.from);
    const to = vertexOf(edge.to);
    const start = edge.cost < 0 ? edge.upper : edge.lower;
    excess.set(to, (excess.get(to) ?? 0) + start);
    excess.set(from, (excess.get(from) ?? 0) - start);
    if (edge.upper > edge.lower) {
      const pair = { spare: edge.upper - start, used: start - edge.lower };
      connect(from, to, pair, edge.cost);
      pairs.set(edge, pair);
    }
  }

  const source = newVertex();
  const sink = newVertex();
  let required = 0;
  for (const [vertex, amount] of excess) {
    if (amount > 0) {
      connect(source, vertex, { spare: amount, used: 0 }, 0);
      required += amount;
    } else if (amount < 0) {
      connect(vertex, sink, { spare: -amount, used: 0 }, 0);
    }
  }

  const all = [...vertices.values(), source, sink];
  for (let sent = 0; sent < required;) {
    const path = cheapestPath(all, source, sink);
    if (!path) return null;
    const amount = Math.min(...path.map(residual));
    for (const arc of path) push(arc, amount);
    sent += amount;
  }

  return new Map(edges.map((edge) => [edge, edge.lower + (pairs.get(edge)?.used ?? 0)]));
}
