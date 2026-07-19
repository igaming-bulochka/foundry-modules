import type { HexGridConfig } from "./types";

// Minimal GeoJSON shapes so this module never depends on the ambient
// `GeoJSON` namespace (the base tsconfig sets `types: []`).
interface GeoFeature {
  type: "Feature";
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "Point"; coordinates: number[] };
  properties: Record<string, unknown>;
}
export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

const MILES_PER_DEG_LAT = 69.0;

function milesToLat(mi: number): number {
  return mi / MILES_PER_DEG_LAT;
}
function milesToLng(mi: number, atLat: number): number {
  const denom = MILES_PER_DEG_LAT * Math.max(0.15, Math.cos((atLat * Math.PI) / 180));
  return mi / denom;
}

interface HexCell {
  cx: number; // miles, relative to grid center
  cy: number;
  label: string;
}

/** Column letters A..Z, AA.. for readable hex references. */
function colLabel(n: number): string {
  let s = "";
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildCells(cfg: HexGridConfig): HexCell[] {
  // "Across the flats" distance == cfg.hexMiles. For a regular hexagon that
  // equals sqrt(3) * R where R is the circumradius (center to vertex).
  const R = cfg.hexMiles / Math.sqrt(3);
  const cells: HexCell[] = [];
  const pointy = cfg.orientation === "pointy";

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const raw: Array<{ x: number; y: number; label: string }> = [];

  for (let col = 0; col < cfg.cols; col++) {
    for (let row = 0; row < cfg.rows; row++) {
      let x: number, y: number;
      if (pointy) {
        x = Math.sqrt(3) * R * col + (row % 2 ? (Math.sqrt(3) * R) / 2 : 0);
        y = 1.5 * R * row;
      } else {
        x = 1.5 * R * col;
        y = Math.sqrt(3) * R * row + (col % 2 ? (Math.sqrt(3) * R) / 2 : 0);
      }
      raw.push({ x, y, label: `${colLabel(col)}${row + 1}` });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (const c of raw) cells.push({ cx: c.x - midX, cy: c.y - midY, label: c.label });
  return cells;
}

function hexCorners(R: number, pointy: boolean): Array<[number, number]> {
  const corners: Array<[number, number]> = [];
  const start = pointy ? 30 : 0;
  for (let i = 0; i < 6; i++) {
    const a = ((start + i * 60) * Math.PI) / 180;
    corners.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return corners;
}

/**
 * Build a GeoJSON FeatureCollection for the configured hex grid. Polygons carry
 * a `label` property; a matching centroid Point feature is emitted for each hex
 * so labels can be placed with a symbol layer when enabled.
 */
export function buildHexGeoJSON(cfg: HexGridConfig): GeoFeatureCollection {
  const R = cfg.hexMiles / Math.sqrt(3);
  const pointy = cfg.orientation === "pointy";
  const cornerOffsets = hexCorners(R, pointy);
  const cells = buildCells(cfg);
  const features: GeoFeature[] = [];

  for (const cell of cells) {
    const ring: Array<[number, number]> = cornerOffsets.map(([dx, dy]) => {
      const mx = cell.cx + dx;
      const my = cell.cy + dy;
      const lat = cfg.centerLat + milesToLat(my);
      const lng = cfg.centerLng + milesToLng(mx, cfg.centerLat);
      return [lng, lat];
    });
    ring.push(ring[0]);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { label: cell.label },
    });
    if (cfg.showLabels) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            cfg.centerLng + milesToLng(cell.cx, cfg.centerLat),
            cfg.centerLat + milesToLat(cell.cy),
          ],
        },
        properties: { label: cell.label, isLabel: true },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
