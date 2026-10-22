// Shared OSM rail-geometry helpers for the baked rail modes (MRT, LRT).
// Pure functions only: the sync scripts fetch, these chain, project and trim.

export type LngLat = [number, number];

export interface OsmNode {
  type: "node";
  id: number;
  lon: number;
  lat: number;
  tags?: Record<string, string>;
}
export interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
export interface OsmRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members: { type: "node" | "way" | "relation"; ref: number; role: string }[];
}
export interface OsmDocument {
  elements: (OsmNode | OsmWay | OsmRelation)[];
}

export const STOP_ROLES = new Set([
  "stop",
  "stop_entry_only",
  "stop_exit_only",
]);

export const metres = (a: LngLat, b: LngLat) =>
  Math.hypot(
    (a[0] - b[0]) * 111_320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
    (a[1] - b[1]) * 110_540,
  );

export const round = (n: number) => Number(n.toFixed(7));

/**
 * Join unordered/reversed OSM track ways, never bridging a gap. `label` and
 * `railway` only shape the error messages and the accepted track kind, so an
 * under-construction or disused way is rejected loudly instead of drawn.
 */
export function chainTrack(
  ways: OsmWay[],
  nodes: Map<number, OsmNode>,
  first: LngLat,
  label: string,
  railway: string,
): LngLat[] {
  const pool = ways.map((way) => {
    if (way.tags?.railway !== railway)
      throw new Error(
        `${label} way ${way.id} is not operating ${railway} track`,
      );
    return way.nodes.map((id): LngLat => {
      const node = nodes.get(id);
      if (!node) throw new Error(`${label} missing track node ${id}`);
      return [node.lon, node.lat];
    });
  });
  if (!pool.length || pool.some((points) => points.length < 2))
    throw new Error(`${label} has no usable track ways`);
  let line = pool.shift()!;
  while (pool.length) {
    const index = pool.findIndex((p) =>
      [p[0], p.at(-1)!].some(
        (end) => metres(end, line[0]) < 2 || metres(end, line.at(-1)!) < 2,
      ),
    );
    if (index < 0) throw new Error(`${label} track ways are disconnected`);
    const points = pool.splice(index, 1)[0];
    if (metres(points[0], line.at(-1)!) < 2)
      line = line.concat(points.slice(1));
    else if (metres(points.at(-1)!, line.at(-1)!) < 2)
      line = line.concat([...points].reverse().slice(1));
    else if (metres(points.at(-1)!, line[0]) < 2)
      line = points.concat(line.slice(1));
    else line = [...points].reverse().concat(line.slice(1));
  }
  return metres(line[0], first) <= metres(line.at(-1)!, first)
    ? line
    : line.reverse();
}

export function projection(line: LngLat[], point: LngLat) {
  let best = { distance: Infinity, segment: 0, t: 0, point: line[0] };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i],
      b = line[i + 1];
    const kx = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx,
      dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * kx,
      py = (point[1] - a[1]) * 110_540;
    const t =
      dx || dy
        ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
        : 0;
    const distance = Math.hypot(px - dx * t, py - dy * t);
    if (distance < best.distance)
      best = {
        distance,
        segment: i,
        t,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      };
  }
  return best;
}
