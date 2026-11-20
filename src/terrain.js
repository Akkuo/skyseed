// 無限地形：依玩家位置載入／回收分塊；每塊含地形網格、合併後的裝飾網格與玩法物件
import * as THREE from 'three';
import { CHUNK, SEG, VIEW_RADIUS, BIOMES, WATER_Y, heightAt, groundAt, colorAt, biomeIndexAt } from './world.js';
import { mulberry32, hash2 } from './noise.js';
import { makeUpdraftMesh, makeRibbonMesh, makePlotMesh, makeFlowerField, markPlotPlanted, setFieldGrowth } from './features.js';

const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const decoMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// 裝飾模板（非索引幾何，底部對齊 y=0）
const T = {
  cone: new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0).toNonIndexed(),
  pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0).toNonIndexed(),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0).toNonIndexed(),
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(1, 0), // 本身即非索引
};

// 把多個模板合併成一個帶頂點色的幾何（每塊只需 1 次 draw call）
class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(tmpl, x, y, z, sx, sy, sz, ry, color, rand) {
    const p = tmpl.attributes.position.array, n = tmpl.attributes.normal.array;
    const c = Math.cos(ry), s = Math.sin(ry);
    const j = rand ? 0.88 + rand() * 0.24 : 1;
    const r = ((color >> 16) & 255) / 255 * j, g = ((color >> 8) & 255) / 255 * j, b = (color & 255) / 255 * j;
    for (let i = 0; i < p.length; i += 3) {
      const lx = p[i] * sx, ly = p[i + 1] * sy, lz = p[i + 2] * sz;
      this.pos.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
      const nx = n[i] / sx, ny = n[i + 1] / sy, nz = n[i + 2] / sz;
      const L = Math.hypot(nx, ny, nz) || 1;
      this.nor.push((nx * c + nz * s) / L, ny / L, (-nx * s + nz * c) / L);
      this.col.push(r, g, b);
    }
  }
  build() {
    if (!this.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

const pick = (rand, arr) => arr[(rand() * arr.length) | 0];

function tree(B, rand, x, y, z, trunkC, crownC, size) {
  B.add(T.cyl, x, y - 0.3, z, 0.3 * size, 2.6 * size, 0.3 * size, 0, trunkC, rand);
  B.add(T.ico, x, y + 3.4 * size, z, 2.1 * size, 2.0 * size, 2.1 * size, rand() * 6, crownC, rand);
}

function decorate(B, b, rand, x, y, z, solids) {
  const roll = rand();
  switch (b) {
    case 0: // 草原
      if (y < 0.6) return;
      if (roll < 0.09) tree(B, rand, x, y, z, 0x7a5233, pick(rand, [0x4f9a3a, 0x63ad40, 0x3f8a3a]), 0.9 + rand() * 0.6);
      else if (roll < 0.7) for (let k = 0; k < 3; k++) B.add(T.cone, x + rand() * 1.4, y - 0.1, z + rand() * 1.4, 0.35, 0.9 + rand() * 0.8, 0.35, 0, pick(rand, [0x6db84a, 0x7cc24f, 0x5aa442]), rand);
      else for (let k = 0; k < 4; k++) B.add(T.ico, x + rand() * 2, y + 0.3, z + rand() * 2, 0.22, 0.22, 0.22, 0, pick(rand, [0xffffff, 0xffe066, 0xff8fc0, 0xc59bff]));
      break;
    case 1: // 河谷
      if (y > -0.8 && y < 1.6) { for (let k = 0; k < 4; k++) B.add(T.cone, x + rand() * 1.5, Math.max(y, 0) - 0.2, z + rand() * 1.5, 0.12, 2 + rand() * 1.6, 0.12, 0, pick(rand, [0x8aa04a, 0x6f8c3a]), rand); return; }
      if (y < 0) return;
      if (roll < 0.22) { // 垂柳
        B.add(T.cyl, x, y - 0.3, z, 0.35, 3.2, 0.35, 0, 0x6a4a30, rand);
        B.add(T.ico, x, y + 3.6, z, 2.4, 2.8, 2.4, rand() * 6, 0x7fae4a, rand);
        B.add(T.ico, x + 1, y + 2.6, z - 0.6, 1.6, 2.2, 1.6, rand() * 6, 0x8fbd55, rand);
      } else if (roll < 0.45) B.add(T.ico, x, y + 0.2, z, 0.8 + rand(), 0.5 + rand() * 0.5, 0.9 + rand(), rand() * 6, 0x8a8f96, rand);
      else for (let k = 0; k < 3; k++) B.add(T.cone, x + rand() * 1.4, y - 0.1, z + rand() * 1.4, 0.3, 0.9 + rand() * 0.6, 0.3, 0, 0x5e9e48, rand);
      break;
    case 3: // 秋林
      if (y < 0.6) return;
      if (roll < 0.55) tree(B, rand, x, y, z, 0x5c3a24, pick(rand, [0xe8742c, 0xc8402a, 0xf2b53a, 0xd85a2a, 0xb8862a]), 1 + rand() * 0.7);
      else if (roll < 0.8) {
        const s = 1 + rand() * 0.6;
        B.add(T.cyl, x, y - 0.3, z, 0.25 * s, 1.5 * s, 0.25 * s, 0, 0x5c3a24, rand);
        B.add(T.cone, x, y + 1 * s, z, 1.5 * s, 4.5 * s, 1.5 * s, 0, pick(rand, [0xd9a33a, 0xc8602a, 0x8a6a2a]), rand);
      } else B.add(T.ico, x, y + 0.1, z, 1.0, 0.25, 1.0, rand() * 6, 0xc2582a, rand); // 落葉堆
      break;
    case 4: { // 雪嶺
      if (roll < 0.6) {
        const s = 0.9 + rand() * 0.8, snowy = y > 30;
        B.add(T.cyl, x, y - 0.3, z, 0.25 * s, 1.4 * s, 0.25 * s, 0, 0x4a3426);
        for (let k = 0; k < 3; k++) B.add(T.cone, x, y + (0.9 + k * 1.3) * s, z, (1.7 - k * 0.45) * s, 2.2 * s, (1.7 - k * 0.45) * s, k, k === 2 && snowy ? 0xe8f0f6 : 0x2f5a44, rand);
      } else B.add(T.ico, x, y + 0.3, z, 1.2 + rand() * 1.5, 0.8 + rand(), 1.2 + rand() * 1.4, rand() * 6, roll < 0.8 ? 0x7d8590 : 0xeef3f8, rand);
      break;
    }
  }
}

function house(B, rand, x, z, solids) {
  const w = 6 + rand() * 4, d = 6 + rand() * 4, ry = (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.1;
  const tall = rand() < 0.12;
  const wh = tall ? 12 + rand() * 6 : 3.5 + rand() * 4.5;
  const rh = 2.5 + rand() * 2.5;
  const y = heightAt(x, z);
  B.add(T.box, x, y - 2, z, w, wh + 2, d, ry, pick(rand, [0xefe4cf, 0xe6d3b0, 0xd9c2a0, 0xf3ece0, 0xc9b79a]), rand);
  const tw = tall ? Math.min(w, d) : 1;
  B.add(T.pyramid, x, y + wh, z, tall ? tw * 1.1 : w * 1.12, rh * (tall ? 1.6 : 1), tall ? tw * 1.1 : d * 1.12, ry, pick(rand, [0xb5533a, 0xa4462f, 0xc0683f, 0x6f6f7a]), rand);
  if (!tall && rand() < 0.6) B.add(T.box, x + w * 0.25, y + wh, z + d * 0.2, 0.8, rh * 0.9, 0.8, ry, 0x8a5a44, rand);
  solids.push({ x, z, hw: w / 2 + 0.6, hd: d / 2 + 0.6, top: y + wh + rh * 0.5 });
}

export class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.planted = new Set();
    this.growing = [];
    this.dirty = true;
    this.lists = { updrafts: [], ribbons: [], plots: [], pollen: [], solids: [] };
    const size = CHUNK * (VIEW_RADIUS * 2 + 3);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x3f8fbf, transparent: true, opacity: 0.82 }));
    this.water.position.y = WATER_Y;
    scene.add(this.water);
    this.cx = 1e9; this.cz = 1e9;
  }

  key(cx, cz) { return cx + ',' + cz; }

  build(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK, st = CHUNK / SEG, N = SEG + 1;
    const group = new THREE.Group();
    // 地形：多算一圈邊界以求坡度
    const H = new Float32Array((N + 2) * (N + 2));
    for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) H[(j + 1) * (N + 2) + i + 1] = heightAt(x0 + i * st, z0 + j * st);
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), c = [0, 0, 0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j + 1) * (N + 2) + i + 1, h = H[k];
      const slope = (Math.abs(H[k + 1] - H[k - 1]) + Math.abs(H[k + N + 2] - H[k - N - 2])) / (2 * st);
      const x = x0 + i * st, z = z0 + j * st, v = j * N + i;
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      colorAt(x, z, h, slope, c);
      col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
    }
    const idx = [];
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    group.add(new THREE.Mesh(geo, terrainMat));

    const rand = mulberry32(hash2(cx, cz, 17));
    const ch = { cx, cz, group, updrafts: [], ribbons: [], plots: [], pollen: [], solids: [], fields: [] };
    const bc = biomeIndexAt(z0 + CHUNK / 2);
    const BI = BIOMES[bc];
    const rx = () => x0 + 10 + rand() * (CHUNK - 20), rz = () => z0 + 10 + rand() * (CHUNK - 20);

    // 肥沃地塊：取 6 個候選中最平坦、不在水裡的
    if (rand() < BI.plot) {
      let best = null, bs = 1e9;
      for (let k = 0; k < 6; k++) {
        const x = rx(), z = rz(), h = heightAt(x, z);
        if (h < 1.5) continue;
        const s = Math.abs(heightAt(x + 5, z) - heightAt(x - 5, z)) + Math.abs(heightAt(x, z + 5) - heightAt(x, z - 5));
        if (s < bs) { bs = s; best = { x, z, y: h }; }
      }
      if (best) {
        const id = hash2(cx, cz, 5);
        const p = { ...best, r: 6, id, planted: this.planted.has(id) };
        group.add(makePlotMesh(p));
        if (p.planted) { const f = makeFlowerField(p, true); group.add(f.group); ch.fields.push(f); }
        ch.plots.push(p);
      }
    }
    // 上升氣流
    const nUp = (rand() < BI.updraft ? 1 : 0) + (rand() < BI.updraft * 0.15 ? 1 : 0);
    for (let k = 0; k < nUp; k++) {
      const x = rx(), z = rz(), y0 = groundAt(x, z);
      const u = { x, z, y0, r: 9 + rand() * 3, h: 110, str: 7 + rand() * 3 };
      group.add(makeUpdraftMesh(u));
      ch.updrafts.push(u);
      for (let q = 0; q < 3; q++) ch.pollen.push({ x: x + (rand() - 0.5) * 4, y: y0 + 14 + q * 14 + rand() * 6, z: z + (rand() - 0.5) * 4, alive: true, ph: rand() * 6 });
    }
    // 風帶：大致朝旅程方向（-Z）
    if (rand() < BI.ribbon) {
      const a = (rand() - 0.5) * 1.4, dx = Math.sin(a), dz = -Math.cos(a);
      const sx = rx(), sz = rz(), L = 120, n = 26;
      let top = 0;
      for (let i = 0; i < n; i += 5) top = Math.max(top, groundAt(sx + dx * L * i / n, sz + dz * L * i / n));
      const base = top + 16 + rand() * 14, wav = rand() * 6;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), bend = Math.sin(t * Math.PI * 1.5 + wav) * 10;
        pts.push({ x: sx + dx * L * t - dz * bend, y: base + Math.sin(t * 6 + wav) * 3, z: sz + dz * L * t + dx * bend });
      }
      const rb = { pts, dir: { x: dx, z: dz }, str: 16 };
      group.add(makeRibbonMesh(rb));
      ch.ribbons.push(rb);
      for (let i = 4; i < n; i += 7) ch.pollen.push({ ...pts[i], alive: true, ph: rand() * 6 });
    }
    // 散佈花粉
    const np = 3 + ((rand() * 4) | 0);
    for (let k = 0; k < np; k++) { const x = rx(), z = rz(); ch.pollen.push({ x, y: groundAt(x, z) + 6 + rand() * 30, z, alive: true, ph: rand() * 6 }); }

    // 裝飾
    const B = new Builder();
    const nearPlot = (x, z, m) => ch.plots.some(p => Math.hypot(x - p.x, z - p.z) < p.r + m);
    const nearUp = (x, z) => ch.updrafts.some(u => Math.hypot(x - u.x, z - u.z) < u.r);
    // 舊城：格狀街廓
    const cell = 18;
    for (let gz = 0; gz < CHUNK / cell; gz++) for (let gx = 0; gx < CHUNK / cell; gx++) {
      const x = x0 + gx * cell + cell / 2 + (rand() - 0.5) * 2, z = z0 + gz * cell + cell / 2 + (rand() - 0.5) * 2;
      if (biomeIndexAt(z, rand()) !== 2) continue;
      if (rand() < 0.15 || nearPlot(x, z, 9) || nearUp(x, z) || heightAt(x, z) < 1) continue;
      house(B, rand, x, z, ch.solids);
    }
    const nd = [45, 40, 10, 80, 45][bc];
    for (let k = 0; k < nd; k++) {
      const x = x0 + rand() * CHUNK, z = z0 + rand() * CHUNK;
      if (nearPlot(x, z, 2)) continue;
      const b = biomeIndexAt(z, rand());
      decorate(B, b === 2 ? 0 : b, rand, x, heightAt(x, z), z, ch.solids);
    }
    const dg = B.build();
    if (dg) group.add(new THREE.Mesh(dg, decoMat));

    this.scene.add(group);
    this.chunks.set(this.key(cx, cz), ch);
    this.dirty = true;
  }

  dispose(ch) {
    this.scene.remove(ch.group);
    ch.group.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material && o.material.userData.own) o.material.dispose();
    });
    this.growing = this.growing.filter(f => !ch.fields.includes(f));
    this.dirty = true;
  }

  // 每幀：回收遠塊、依距離排程建新塊（budget 塊/幀，避免卡頓）
  update(px, pz, dt, budget = 2) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK), R = VIEW_RADIUS;
    if (cx !== this.cx || cz !== this.cz) {
      this.cx = cx; this.cz = cz;
      for (const [k, ch] of this.chunks) if (Math.abs(ch.cx - cx) > R + 1 || Math.abs(ch.cz - cz) > R + 1) { this.dispose(ch); this.chunks.delete(k); }
      this.water.position.x = (cx + 0.5) * CHUNK; this.water.position.z = (cz + 0.5) * CHUNK;
    }
    const todo = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) todo.push([cx + dx, cz + dz, dx * dx + dz * dz]);
    todo.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < Math.min(budget, todo.length); i++) this.build(todo[i][0], todo[i][1]);
    // 花海生長動畫
    for (const f of this.growing) { f.t += dt; setFieldGrowth(f); }
    this.growing = this.growing.filter(f => !f.done);
  }

  forceLoad(px, pz) { this.update(px, pz, 0, 999); }

  reset() {
    for (const ch of this.chunks.values()) this.dispose(ch);
    this.chunks.clear(); this.planted.clear(); this.growing = []; this.cx = this.cz = 1e9;
  }

  get active() {
    if (this.dirty) {
      const L = this.lists;
      for (const k in L) L[k] = [];
      for (const ch of this.chunks.values()) for (const k in L) L[k].push(...ch[k]);
      this.dirty = false;
    }
    return this.lists;
  }

  plant(p) {
    p.planted = true;
    this.planted.add(p.id);
    markPlotPlanted(p);
    for (const ch of this.chunks.values()) if (ch.plots.includes(p)) {
      const f = makeFlowerField(p, false);
      ch.group.add(f.group); ch.fields.push(f); this.growing.push(f);
    }
  }

  get loaded() { return this.chunks.size; }
}
