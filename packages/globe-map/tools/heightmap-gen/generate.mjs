// Golarion heightmap synthesizer.
//
// Reads the live pf-wikis pmtiles, rasterizes geometry polygons by biome
// (color -> base elevation), boosts elevation near labels named like
// "*Mountains*"/"*Peaks*"/"*Range*", adds simplex noise weighted by
// roughness, smooths, and writes Terrarium-encoded raster-dem PNG tiles
// for z=0..5 under /tmp/golarion-terrain/{z}/{x}/{y}.png .
//
// Designed for MapLibre raster-dem with encoding: "terrarium".

import { PMTiles, FetchSource } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";
import { createNoise2D } from "simplex-noise";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const URL = "https://staging.golarion.schmooky.dev/modules/globe-map/golarion.pmtiles";
const OUT_DIR = "/tmp/golarion-terrain";

// Native canvas = world Mercator at z=5 detail (256 * 2^5 = 8192). Output
// z=5 tiles are now 1:1 with source resolution (no upsampling). Memory:
// 8192*8192 * 4 bytes float32 = 256 MB per buffer.
const CANVAS = 8192;
const SOURCE_ZOOM = 5; // pmtiles source zoom to read polygons from
const MAX_OUT_ZOOM = 5;
const FETCH_CONCURRENCY = 32;

// --- biome color -> base elevation (metres) ---------------------------------
// Derived from sampling the live pmtiles geometry layer + visual inspection.
// Tunable; mountains live in the dim/dark browns and greys.
const ELEV = new Map(Object.entries({
  // water -- 0m, no depression. Land near coast gets gradient-flattened to
  // 0 in the coastal pass below, so there is no cliff at the shore.
  "#8ab4f8": 0,
  "#dae7fc": 0,
  "#577ec2": 0,
  "#e1ecfd": 0,
  "#9dadc9": 0,
  "#7b8bc2": 0,

  // jungle / grass / marsh -- low rolling green (the Mwangi is canonically
  // lowland tropical, not highlands)
  "#bbe2c6": 150,
  "#8ca47a": 100,

  // light plains / cream / yellow -- desert lowlands (Osirion ~200m,
  // Casmaron steppe ~300m, Crown of the World ice ~100m)
  "#f8f1e1": 180,
  "#fdfbf7": 120,
  "#f0f0f0": 280,    // tundra / snow plateau
  "#f6f4ed": 200,
  "#f9f7f2": 250,
  "#fff7be": 230,

  // tans -- rolling foothills (savannah, badlands, wastes). Down from the
  // last pass; named mountain ranges add their own bumps on top via the
  // LORE_RANGES table, so this layer is for the "rolling brown" baseline.
  "#ebe3cd": 500,
  "#ded4b8": 1100,   // dominant brown shading: foothill country, not peaks
  "#b7c5bc": 1700,
  "#c3c1bc": 2000,
  "#c4bfb2": 2000,
  "#c5c7bd": 2000,
  "#778899": 2100,
  "#789": 2100,

  // hill country (olive brown)
  "#b99d5c": 2400,

  // mountains (greys + dark browns) -- still high but a bit gentler
  "#a9a9a9": 3200,
  "#696969": 4000,
  "#4d3728": 4700,
  "#3b331d": 5400,

  // volcanic
  "#fba116": 3000,
}));

const WATER_COLORS = new Set([
  "#8ab4f8", "#dae7fc", "#577ec2", "#e1ecfd", "#9dadc9", "#7b8bc2",
]);

// --- lore-tiered mountain pattern table -------------------------------------
// Match Golarion-specific named ranges with appropriate elevation profiles.
// Order matters: patterns are tested top-down and the first match wins, so
// the most specific patterns must come first. Each tier writes a wide
// "shoulder" bump and (optionally) a narrow "summit" peak on top.
//
// Sources: PathfinderWiki canonical descriptions of major ranges plus the
// pf-wikis cartographic conventions.
const LORE_RANGES = [
  // Special case: Crown of the World is an icy plateau at near-sea-level,
  // not a mountain range. Suppress any "mountain"-pattern bump for it.
  { rx: /crown of the world/i, shoulderR: 0, shoulderP: 0, summitR: 0, summitP: 0 },

  // Mythic / divine tier: peaks of legend. Wall of Heaven separates Tian
  // Xia from the Crown of the World; canon describes 8km+ summits.
  { rx: /wall of heaven|crown of hu wan|world.?s edge|wati ridge|mountains of the sun/i,
    shoulderR: 110, shoulderP: 2000, summitR: 40, summitP: 2800 },

  // Alpine high (4-5 km class): named dwarven/elven strongholds, major
  // continental ranges.
  { rx: /five kings|menador|aspodell|iron wraith|kodar|tusk mountains|kortos peaks|kelesh peak/i,
    shoulderR: 85,  shoulderP: 1500, summitR: 35, summitP: 2000 },

  // Moderate mountain ranges (3-4 km class): the bulk of named Avistan +
  // Garund + Tian Xia ranges.
  { rx: /mindspin|brazen peaks|napsune|prophet|kelaur|sankyodai|kyojin|wyvern|bandu|barrier wall|terwa uplands|wati|hold of belkzen/i,
    shoulderR: 70,  shoulderP: 1100, summitR: 30, summitP: 1500 },

  // Plateaus / highlands (broad lift, no sharp summit). Storval Plateau
  // is canonically a raised tableland; Hold of Belkzen is steppe.
  { rx: /storval plateau|hidden country|terwa|ekujae|cinderlands/i,
    shoulderR: 130, shoulderP: 700, summitR: 0, summitP: 0 },

  // Generic mountain pattern (Tier C). Catches everything else with
  // mountain-ish names: ranges, peaks, crags, sierras, tors, pinnacles,
  // spurs, cliffs, ridges, massifs.
  { rx: /\b(mountains?|peaks?|range|cliffs?|crags?|tor|pinnacle|massif|alps|sierra|spur|ridge)\b/i,
    shoulderR: 55,  shoulderP: 700, summitR: 25, summitP: 900 },
];

// Hills (gentler). Down/moor/uplands/bluffs.
const HILL_RX = /\b(hills?|downs|moor|uplands?|bluffs?|fells?)\b/i;

const elev = new Float32Array(CANVAS * CANVAS).fill(0); // default = "no data" -> we fill before noise
const filled = new Uint8Array(CANVAS * CANVAS);          // 1 if any polygon touched this pixel
const isWater = new Uint8Array(CANVAS * CANVAS);         // water mask

// --- scanline polygon fill -------------------------------------------------
function fillPolygon(rings, value, opts = {}) {
  const { setWater = false, blendMax = false } = opts;
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(CANVAS - 1, Math.ceil(maxY));
  for (let y = yStart; y <= yEnd; y++) {
    const yMid = y + 0.5;
    const xs = [];
    for (const ring of rings) {
      const n = ring.length;
      if (n < 2) continue;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y <= yMid && b.y > yMid) || (b.y <= yMid && a.y > yMid)) {
          const t = (yMid - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i < xs.length - 1; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i]));
      const xb = Math.min(CANVAS - 1, Math.floor(xs[i + 1]));
      for (let x = xa; x <= xb; x++) {
        const idx = y * CANVAS + x;
        if (setWater) {
          // Water always wins. Setting elev=0 + isWater=1 forces all later
          // land polygons that happen to overlap to skip this pixel.
          isWater[idx] = 1;
          elev[idx] = value;
        } else if (!isWater[idx]) {
          // Land paints only on non-water pixels.
          if (blendMax) {
            if (value > elev[idx]) elev[idx] = value;
          } else {
            elev[idx] = value;
          }
        }
        filled[idx] = 1;
      }
    }
  }
}

// --- radial bump (additive, capped at final clamp pass) --------------------
function addRadialBump(cx, cy, radius, peak) {
  const r2 = radius * radius;
  const yStart = Math.max(0, Math.floor(cy - radius));
  const yEnd = Math.min(CANVAS - 1, Math.ceil(cy + radius));
  const xStart = Math.max(0, Math.floor(cx - radius));
  const xEnd = Math.min(CANVAS - 1, Math.ceil(cx + radius));
  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) / radius; // 0..1
      const bump = peak * (Math.cos(d * Math.PI) * 0.5 + 0.5);
      const idx = y * CANVAS + x;
      if (isWater[idx]) continue;
      elev[idx] += bump;
    }
  }
}

// --- Mercator projection helpers --------------------------------------------
// Convert pmtiles tile (z, xt, yt) + local feature point (lx, ly, extent) to
// canvas pixel coords (X is 0..CANVAS east-positive, Y is 0..CANVAS south-positive).
function projTilePoint(z, xt, yt, lx, ly, extent) {
  const tilesPerSide = 1 << z;
  const pixPerTile = CANVAS / tilesPerSide;
  return {
    x: xt * pixPerTile + (lx / extent) * pixPerTile,
    y: yt * pixPerTile + (ly / extent) * pixPerTile,
  };
}

// --- fetch pmtiles features -------------------------------------------------
console.log(`Opening ${URL}`);
const p = new PMTiles(new FetchSource(URL));
const header = await p.getHeader();
console.log(`pmtiles header: minZoom=${header.minZoom} maxZoom=${header.maxZoom}`);

const SRC_SIDE = 1 << SOURCE_ZOOM;
let tilesHit = 0;
let polysRendered = 0;
let waterPolys = 0;
const mountainLabels = []; // { x, y, name, score }
const hillLabels = [];

// Pass 1: rasterize land polygons (color -> elevation), collect labels.
// Fetches are HTTP range reads to the staging archive, so we fan out
// FETCH_CONCURRENCY at a time. Rasterization itself is single-threaded
// against the shared elev/isWater buffers.
console.log(`\nPass 1: rasterizing ${SRC_SIDE}x${SRC_SIDE} = ${SRC_SIDE * SRC_SIDE} tiles at z=${SOURCE_ZOOM}`);
const t0 = Date.now();
const queue = [];
for (let xt = 0; xt < SRC_SIDE; xt++)
  for (let yt = 0; yt < SRC_SIDE; yt++) queue.push([xt, yt]);

async function fetchOne([xt, yt]) {
  try { return [xt, yt, await p.getZxy(SOURCE_ZOOM, xt, yt)]; } catch { return [xt, yt, null]; }
}

let qi = 0;
async function worker() {
  while (qi < queue.length) {
    const my = qi++;
    if (my >= queue.length) return;
    const [xt, yt, tile] = await fetchOne(queue[my]);
    if (!tile) continue;
    tilesHit++;
    const vt = new VectorTile(new Protobuf(tile.data));

    const geom = vt.layers.geometry;
    if (geom) {
      for (let i = 0; i < geom.length; i++) {
        const f = geom.feature(i);
        const color = String(f.properties.color || "").toLowerCase();
        const baseE = ELEV.get(color);
        const water = WATER_COLORS.has(color);
        if (baseE === undefined && !water) continue;
        const rings = f.loadGeometry();
        const projected = rings.map((r) => r.map((pt) =>
          projTilePoint(SOURCE_ZOOM, xt, yt, pt.x, pt.y, f.extent)
        ));
        if (water) {
          // water rendered in pass 2 (after land), keep value but tag
          fillPolygon(projected, baseE ?? -30, { setWater: true });
          waterPolys++;
        } else {
          fillPolygon(projected, baseE, { blendMax: true });
          polysRendered++;
        }
      }
    }

    // labels: point features; classify by lore tier
    const labels = vt.layers.labels;
    if (labels) {
      for (let i = 0; i < labels.length; i++) {
        const f = labels.feature(i);
        const name = String(f.properties.label || "");
        if (!name) continue;
        const tier = LORE_RANGES.find((t) => t.rx.test(name));
        const isHill = !tier && HILL_RX.test(name);
        if (!tier && !isHill) continue;
        const g = f.loadGeometry();
        const pt = g[0]?.[0];
        if (!pt) continue;
        const xy = projTilePoint(SOURCE_ZOOM, xt, yt, pt.x, pt.y, f.extent);
        if (tier) mountainLabels.push({ ...xy, name, tier });
        else hillLabels.push({ ...xy, name });
      }
    }

    // line-labels: linestring features. Pick mountain-ish ranges + sample
    // points along the line so the named range forms a ridge, not a blob.
    const lineLabels = vt.layers["line-labels"];
    if (lineLabels) {
      for (let i = 0; i < lineLabels.length; i++) {
        const f = lineLabels.feature(i);
        const name = String(f.properties.label || "");
        if (!name) continue;
        const tier = LORE_RANGES.find((t) => t.rx.test(name));
        if (!tier) continue;
        const lines = f.loadGeometry();
        for (const line of lines) {
          // sample one point per ~10 tile-units to avoid overcounting
          for (let k = 0; k < line.length; k += Math.max(1, Math.floor(line.length / 20))) {
            const pt = line[k];
            const xy = projTilePoint(SOURCE_ZOOM, xt, yt, pt.x, pt.y, f.extent);
            mountainLabels.push({ ...xy, name: name + " (line)", tier });
          }
        }
      }
    }
  }
}

await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));
console.log(`Pass 1 done in ${((Date.now() - t0) / 1000).toFixed(1)}s. tiles=${tilesHit}, land polys=${polysRendered}, water polys=${waterPolys}, mtn labels=${mountainLabels.length}, hill labels=${hillLabels.length}`);

// Any pixel not covered by any polygon is open ocean (the pf-wikis archive
// only has features for inhabited/named regions; the deep sea is implicit).
// Mark them as water so the later noise/blur passes leave them dead flat.
let oceanFill = 0;
for (let i = 0; i < CANVAS * CANVAS; i++) {
  if (!filled[i]) { isWater[i] = 1; elev[i] = 0; oceanFill++; }
}
console.log(`Marked ${oceanFill} uncovered pixels as open ocean (${((oceanFill * 100) / (CANVAS * CANVAS)).toFixed(1)}% of world)`);

// Pass 2: apply label bumps. Radius / peak chosen for canvas size.
// Mountain radius ~ 40 canvas pixels ≈ ~250 km on a Mercator world that big.
console.log(`\nPass 2: applying ${mountainLabels.length} tiered mountain bumps + ${hillLabels.length} hill bumps`);
const t1 = Date.now();
// Tier-aware bumping. Each label carries a shoulder (broad lift) and an
// optional summit (sharp peak) magnitude from LORE_RANGES; Crown of the
// World gets a 0/0 tier so its label produces no relief.
for (const m of mountainLabels) {
  if (m.tier.shoulderP > 0) addRadialBump(m.x, m.y, m.tier.shoulderR, m.tier.shoulderP);
  if (m.tier.summitP   > 0) addRadialBump(m.x, m.y, m.tier.summitR,   m.tier.summitP);
}
for (const h of hillLabels) addRadialBump(h.x, h.y, 55, 600);
console.log(`Pass 2 done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

// Pass 3a: coastal flatten. Land pixels close to water get multiplicatively
// pulled down toward 0 so the shoreline doesn't appear as a hard cliff
// (without this, a 1100m foothill polygon abutting 0m water creates a
// kilometre-scale cliff once exaggerated). Sweep out to COAST_RADIUS pixels
// with a smoothstep so the transition is gradual.
console.log(`\nPass 3a: coastal flatten`);
const t2a = Date.now();
const COAST_RADIUS = 10;
for (let y = COAST_RADIUS; y < CANVAS - COAST_RADIUS; y++) {
  for (let x = COAST_RADIUS; x < CANVAS - COAST_RADIUS; x++) {
    const idx = y * CANVAS + x;
    if (isWater[idx]) continue;
    // closest water within radius
    let near = -1;
    for (let r = 1; r <= COAST_RADIUS; r++) {
      if (
        isWater[idx - r] || isWater[idx + r] ||
        isWater[idx - r * CANVAS] || isWater[idx + r * CANVAS]
      ) { near = r; break; }
    }
    if (near < 0) continue;
    // smoothstep: 0 at shore, 1 at radius. Below 1, scale elevation down.
    const t = near / COAST_RADIUS;
    const k = t * t * (3 - 2 * t);
    elev[idx] *= k;
  }
}
console.log(`Pass 3a done in ${((Date.now() - t2a) / 1000).toFixed(1)}s`);

// Pass 3b: multi-octave fBm noise. Three octaves of simplex add fractal
// detail: large-scale undulation, medium-scale slopes, small grain. Noise
// amplitude scales with current elevation so plains get a hint of texture
// and mountains get aggressive roughness.
console.log(`\nPass 3b: fBm noise (3 octaves)`);
const t2b = Date.now();
const n1 = createNoise2D(() => 0.1234);
const n2 = createNoise2D(() => 0.5678);
const n3 = createNoise2D(() => 0.9876);
function fbm(x, y) {
  return (
    n1(x / 220, y / 220) * 1.0 +
    n2(x / 70,  y / 70)  * 0.5 +
    n3(x / 22,  y / 22)  * 0.25
  );
}
for (let y = 0; y < CANVAS; y++) {
  for (let x = 0; x < CANVAS; x++) {
    const idx = y * CANVAS + x;
    if (isWater[idx]) continue;
    const base = elev[idx];
    // 1 = full mountain roughness, 0.15 = gentle plains roughness
    const roughness = 0.15 + Math.min(1.5, Math.max(0, base) / 2000) * 0.85;
    const n = fbm(x, y);
    elev[idx] = Math.max(0, base + n * 900 * roughness);
  }
}
console.log(`Pass 3b done in ${((Date.now() - t2b) / 1000).toFixed(1)}s`);

// Pass 4: small box blur (3x3 twice ≈ gaussian) to soften polygon edges.
// Skip across water so coastlines stay sharp.
console.log(`\nPass 4: blur`);
const t3 = Date.now();
const tmp = new Float32Array(elev.length);
function boxBlurOnce(src, dst) {
  for (let y = 1; y < CANVAS - 1; y++) {
    for (let x = 1; x < CANVAS - 1; x++) {
      const idx = y * CANVAS + x;
      if (isWater[idx]) { dst[idx] = src[idx]; continue; }
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * CANVAS + (x + dx);
          if (isWater[j]) continue;
          sum += src[j];
          n++;
        }
      }
      dst[idx] = n ? sum / n : src[idx];
    }
  }
}
boxBlurOnce(elev, tmp);
boxBlurOnce(tmp, elev);
console.log(`Pass 4 done in ${((Date.now() - t3) / 1000).toFixed(1)}s`);

// Pass 5: clamp. Fantasy-scale ceiling 8500m gives Himalayan peaks plus
// room for stacked bumps + noise on top of the highest-color base.
console.log(`\nPass 5: clamp`);
const t4 = Date.now();
const HARD_MAX = 8500;
const HARD_MIN = -300;
let clampedHigh = 0;
for (let i = 0; i < elev.length; i++) {
  if (elev[i] > HARD_MAX) { elev[i] = HARD_MAX; clampedHigh++; }
  else if (elev[i] < HARD_MIN) elev[i] = HARD_MIN;
}
console.log(`Pass 5 done in ${((Date.now() - t4) / 1000).toFixed(1)}s. Clamped ${clampedHigh} cells to ${HARD_MAX}m`);

// --- Terrarium encoder ------------------------------------------------------
// elevation = (R*256 + G + B/256) - 32768
// For ints: R = (e + 32768) >> 8, G = (e + 32768) & 0xff, B = 0
function encodeTerrariumPixel(e) {
  const v = Math.round(Math.max(-32768, Math.min(32767, e)) + 32768);
  return [(v >> 8) & 0xff, v & 0xff, 0];
}

// --- write tiles ------------------------------------------------------------
console.log(`\nWriting tiles to ${OUT_DIR}`);
const TILE = 256;
async function writeZoom(z) {
  const tilesPerSide = 1 << z;
  const cellsPerTile = CANVAS / tilesPerSide; // 8192/2^z
  // For z=5: 256 cells per tile (1:1). For z=6: 128 cells per tile (upscale 2x).
  // For lower z, we average source pixels into a tile.
  const sampleStep = cellsPerTile / TILE; // source pixels per output pixel
  let wrote = 0;
  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) {
      const buf = Buffer.alloc(TILE * TILE * 3);
      let nonZero = false;
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          // For sampleStep >= 1, average a sampleStep x sampleStep block.
          // For sampleStep < 1, nearest-sample (upscale).
          let acc = 0, count = 0;
          if (sampleStep >= 1) {
            const sx0 = tx * cellsPerTile + px * sampleStep;
            const sy0 = ty * cellsPerTile + py * sampleStep;
            const step = sampleStep | 0 || 1;
            for (let yy = 0; yy < step; yy++) {
              const sy = Math.min(CANVAS - 1, Math.floor(sy0 + yy));
              for (let xx = 0; xx < step; xx++) {
                const sx = Math.min(CANVAS - 1, Math.floor(sx0 + xx));
                acc += elev[sy * CANVAS + sx];
                count++;
              }
            }
          } else {
            const sx = Math.min(CANVAS - 1, Math.floor(tx * cellsPerTile + px * sampleStep));
            const sy = Math.min(CANVAS - 1, Math.floor(ty * cellsPerTile + py * sampleStep));
            acc = elev[sy * CANVAS + sx];
            count = 1;
          }
          const e = acc / count;
          if (e !== 0) nonZero = true;
          const [r, g, b] = encodeTerrariumPixel(e);
          const idx = (py * TILE + px) * 3;
          buf[idx] = r;
          buf[idx + 1] = g;
          buf[idx + 2] = b;
        }
      }
      const dir = `${OUT_DIR}/${z}/${tx}`;
      await mkdir(dir, { recursive: true });
      const png = await sharp(buf, { raw: { width: TILE, height: TILE, channels: 3 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(`${dir}/${ty}.png`, png);
      wrote++;
    }
  }
  console.log(`  z=${z}: wrote ${wrote} tiles`);
}

for (let z = 0; z <= MAX_OUT_ZOOM; z++) {
  await writeZoom(z);
}

console.log(`\nDone. Heightmap stats:`);
let minE = Infinity, maxE = -Infinity, sumE = 0, n = 0;
for (let i = 0; i < elev.length; i++) {
  const v = elev[i];
  if (v > maxE) maxE = v;
  if (v < minE) minE = v;
  sumE += v;
  n++;
}
console.log(`  min=${minE.toFixed(0)}m  max=${maxE.toFixed(0)}m  mean=${(sumE / n).toFixed(0)}m`);
