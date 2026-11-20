// 世界函數：生態帶、地形高度、地表顏色（純函數，決定性）
import { makeSimplex, fbm, ridged, lerp, smoothstep, clamp } from './noise.js';

export const CHUNK = 72;          // 分塊邊長（世界單位）
export const SEG = 18;            // 分塊格數
export const VIEW_RADIUS = 3;     // 以玩家所在分塊為中心載入 (2r+1)^2 塊
export const BIOME_LEN = 640;     // 每個生態帶沿旅程軸（-Z）的長度
export const WATER_Y = 0;

export const BIOMES = [
  { key: 'meadow', name: '草原', updraft: 0.26, ribbon: 0.22, plot: 0.5 },
  { key: 'river', name: '河谷', updraft: 0.24, ribbon: 0.32, plot: 0.45 },
  { key: 'town', name: '舊城屋頂', updraft: 0.32, ribbon: 0.22, plot: 0.5 },
  { key: 'autumn', name: '秋林', updraft: 0.28, ribbon: 0.25, plot: 0.45 },
  { key: 'snow', name: '雪嶺', updraft: 0.42, ribbon: 0.38, plot: 0.4 },
];

const nBase = makeSimplex(1337);
const nDetail = makeSimplex(4242);
const nRiver = makeSimplex(777);
const nRidge = makeSimplex(9001);
const nColor = makeSimplex(31337);

// 依旅程軸取得目前生態與與下一個生態的混合比例
export function biomeBlend(z) {
  const j = -z / BIOME_LEN;
  const fl = Math.floor(j);
  const f = j - fl;
  const i = ((fl % 5) + 5) % 5;
  return { i, n: (i + 1) % 5, t: smoothstep(0.84, 1, f), f, leg: fl };
}

function riverDist(x, z) {
  const rx = nRiver(z * 0.0035, 3.1) * 70 + nRiver(z * 0.011, 8.7) * 14;
  const xm = ((((x - rx + 130) % 260) + 260) % 260) - 130;
  return Math.abs(xm);
}

function biomeHeight(b, x, z) {
  switch (b) {
    case 0: return 9 + fbm(nBase, x * 0.006, z * 0.006, 3) * 14 + nDetail(x * 0.03, z * 0.03) * 1.6;
    case 1: {
      const d = riverDist(x, z);
      const hills = 15 + fbm(nBase, x * 0.007, z * 0.007, 3) * 16 + Math.min(Math.max(d - 40, 0) * 0.22, 26);
      return lerp(-5, hills, smoothstep(9, 42, d));
    }
    case 2: return 8 + fbm(nBase, x * 0.004, z * 0.004, 2) * 4;
    case 3: return 12 + fbm(nBase, x * 0.008, z * 0.008, 4) * 22 + nDetail(x * 0.04, z * 0.04) * 1.5;
    default: return 16 + ridged(nRidge, x * 0.0055, z * 0.0055, 4) * 78 + fbm(nBase, x * 0.01, z * 0.01, 2) * 8;
  }
}

export function heightAt(x, z) {
  const bb = biomeBlend(z);
  const h0 = biomeHeight(bb.i, x, z);
  if (bb.t <= 0) return h0;
  return lerp(h0, biomeHeight(bb.n, x, z), bb.t);
}

export function groundAt(x, z) { return Math.max(heightAt(x, z), WATER_Y); }

// 單一生態的地表顏色（rgb 0..1）
function biomeColor(b, x, z, h, slope, out) {
  const v = nColor(x * 0.05, z * 0.05) * 0.5 + 0.5;
  const v2 = nColor(x * 0.013 + 50, z * 0.013) * 0.5 + 0.5;
  let r, g, bl;
  switch (b) {
    case 0: r = lerp(0.36, 0.55, v2); g = lerp(0.66, 0.8, v); bl = lerp(0.22, 0.3, v); break;
    case 1: {
      if (h < 1.2) { r = 0.72; g = 0.66; bl = 0.48; } // 河岸沙
      else { r = lerp(0.28, 0.42, v); g = lerp(0.58, 0.7, v2); bl = lerp(0.3, 0.38, v); }
      break;
    }
    case 2: r = lerp(0.62, 0.7, v); g = lerp(0.58, 0.64, v); bl = lerp(0.5, 0.56, v2); break; // 石板地
    case 3: r = lerp(0.62, 0.8, v2); g = lerp(0.36, 0.5, v); bl = lerp(0.16, 0.22, v); break;
    default: {
      const snow = smoothstep(24, 38, h + v * 8) * (1 - smoothstep(1.1, 1.9, slope));
      r = lerp(0.42, 0.95, snow); g = lerp(0.42, 0.97, snow); bl = lerp(0.46, 1.0, snow);
    }
  }
  // 陡坡露岩
  const rock = b === 4 ? smoothstep(1.4, 2.4, slope) * 0.6 : smoothstep(0.75, 1.3, slope) * (b === 2 ? 0 : 0.7);
  out[0] = lerp(r, 0.45, rock); out[1] = lerp(g, 0.43, rock); out[2] = lerp(bl, 0.42, rock);
  return out;
}

const tmpA = [0, 0, 0], tmpB = [0, 0, 0];
export function colorAt(x, z, h, slope, out) {
  const bb = biomeBlend(z);
  biomeColor(bb.i, x, z, h, slope, tmpA);
  if (bb.t <= 0) { out[0] = tmpA[0]; out[1] = tmpA[1]; out[2] = tmpA[2]; return out; }
  biomeColor(bb.n, x, z, h, slope, tmpB);
  for (let k = 0; k < 3; k++) out[k] = lerp(tmpA[k], tmpB[k], bb.t);
  return out;
}

// 某點的「主要」生態（裝飾用）：混合比例過半就算下一個
export function biomeIndexAt(z, r = 0.5) {
  const bb = biomeBlend(z);
  return bb.t > r ? bb.n : bb.i;
}

export { clamp, lerp, smoothstep };
