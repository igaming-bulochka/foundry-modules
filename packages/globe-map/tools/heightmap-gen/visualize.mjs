// Decode a generated terrain tile back to elevation and print an ASCII map.
// Run with: node visualize.mjs <z> <x> <y>
import sharp from "sharp";

const [_, __, zArg, xArg, yArg] = process.argv;
const z = Number(zArg ?? 0);
const x = Number(xArg ?? 0);
const y = Number(yArg ?? 0);
const file = `/tmp/golarion-terrain/${z}/${x}/${y}.png`;

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
console.log(`Decoded ${file}: ${info.width}x${info.height} ${info.channels}ch`);

// Terrarium: elevation = (R*256 + G + B/256) - 32768
function decode(idx) {
  const r = data[idx], g = data[idx + 1], b = data[idx + 2];
  return r * 256 + g + b / 256 - 32768;
}

const W = info.width, H = info.height;
let min = Infinity, max = -Infinity, sum = 0, n = 0;
const elev = new Float32Array(W * H);
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const idx = (py * W + px) * info.channels;
    const e = decode(idx);
    elev[py * W + px] = e;
    if (e < min) min = e;
    if (e > max) max = e;
    sum += e;
    n++;
  }
}
console.log(`elevation min=${min.toFixed(0)}m max=${max.toFixed(0)}m mean=${(sum / n).toFixed(0)}m`);

// Downsample to 100x50 char grid and print
const COLS = 100, ROWS = 50;
const chars = " .,:-+oxOX#@".split("");
const stepX = W / COLS, stepY = H / ROWS;
for (let r = 0; r < ROWS; r++) {
  let line = "";
  for (let c = 0; c < COLS; c++) {
    const sx = Math.floor(c * stepX), sy = Math.floor(r * stepY);
    const e = elev[sy * W + sx];
    if (e <= 0) { line += "~"; continue; }
    const t = Math.min(1, e / 5000);
    line += chars[Math.floor(t * (chars.length - 1))];
  }
  console.log(line);
}

// Bucket histogram
console.log("\nelevation histogram (m):");
const buckets = [-200, 0, 100, 300, 600, 1000, 2000, 3000, 5000, 8000, 15000, 30000];
const counts = new Array(buckets.length).fill(0);
for (let i = 0; i < elev.length; i++) {
  const e = elev[i];
  for (let b = buckets.length - 1; b >= 0; b--) {
    if (e >= buckets[b]) { counts[b]++; break; }
  }
}
const maxC = Math.max(...counts);
for (let i = 0; i < buckets.length; i++) {
  const bar = "#".repeat(Math.round((counts[i] / maxC) * 50));
  console.log(`  >=${String(buckets[i]).padStart(6)}m: ${String(counts[i]).padStart(6)}  ${bar}`);
}
