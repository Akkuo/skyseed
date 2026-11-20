// 玩法物件的視覺：上升氣柱、風帶光絲、肥沃地塊、花海、花粉／發光粒子材質
import * as THREE from 'three';
import { heightAt } from './world.js';
import { mulberry32 } from './noise.js';

// 所有特效 shader 共用的 uniform（main 每幀更新）
export const U = {
  time: { value: 0 },
  far: { value: 300 },
  pr: { value: 1 },
};

const VS_UV = `
varying vec2 vUv; varying float vD;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`;

function fxMat(frag, color, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uFar: U.far, uColor: { value: new THREE.Color(color) }, uAmp: { value: 1 } },
    vertexShader: VS_UV,
    fragmentShader: `uniform float uTime; uniform float uFar; uniform vec3 uColor; uniform float uAmp; varying vec2 vUv; varying float vD;
      void main(){ float a = 0.0; ${frag}
        a *= uAmp * (1.0 - smoothstep(uFar * 0.8, uFar * 1.2, vD));
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra,
  });
}

// 上升氣流：往上流動的條紋 + 閃爍細絲
export const updraftMat = fxMat(`
  float y = vUv.y;
  float s1 = smoothstep(0.55, 1.0, sin(y * 16.0 + uTime * 3.0 + vUv.x * 12.566) * 0.5 + 0.5);
  float s2 = smoothstep(0.82, 1.0, sin(vUv.x * 56.5 + y * 4.0 + uTime * 0.8) * 0.5 + 0.5);
  float fade = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.55, 1.0, y));
  float flick = 0.7 + 0.3 * sin(uTime * 9.0 + vUv.x * 40.0 + y * 20.0);
  a = (0.02 + s1 * 0.09 + s2 * 0.12 * flick) * fade * smoothstep(4.0, 30.0, vD);`, 0xffd27a);

// 風帶：沿長度方向高速流動的光絲
export const ribbonMat = fxMat(`
  float edge = smoothstep(0.0, 0.7, 1.0 - abs(vUv.y * 2.0 - 1.0));
  float streak = smoothstep(0.55, 1.0, sin(vUv.x * 70.0 - uTime * 10.0 + vUv.y * 2.0) * 0.5 + 0.5);
  float ends = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
  a = (0.16 + streak * 0.65) * edge * ends;`, 0xbaf6ff);

const plotFrag = `
  float r = vUv.y;
  float ring = smoothstep(0.78, 0.94, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float pulse = 0.5 + 0.5 * sin(uTime * 3.0 - r * 9.0);
  a = ring * 0.95 + (1.0 - r) * 0.35 * pulse + 0.12;`;
const beamFrag = `
  float y = vUv.y;
  a = (1.0 - y) * 0.42 * (0.75 + 0.25 * sin(uTime * 4.0 + y * 10.0)) * smoothstep(8.0, 45.0, vD);`;

const beamGeo = new THREE.CylinderGeometry(0.5, 1.4, 70, 10, 1, true).translate(0, 35, 0);
beamGeo.userData.shared = true;

// 柔和圓點貼圖用的發光粒子 shader（花粉、螢火蟲、星星共用）
export function makeGlowMat(color, size, { atten = true, opacity = 1, twinkle = 3 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uPR: U.pr, uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uOpacity: { value: opacity } },
    vertexShader: `attribute float phase; uniform float uTime; uniform float uPR; uniform float uSize; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = ${atten ? 'uSize * uPR * 260.0 / max(1.0, -mv.z)' : 'uSize * uPR'};
        vA = 0.6 + 0.4 * sin(uTime * ${twinkle.toFixed(1)} + phase);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
        gl_FragColor = vec4(uColor + a * 0.25, a * vA * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export function makeUpdraftMesh(u) {
  const geo = new THREE.CylinderGeometry(u.r, u.r * 1.25, u.h, 14, 1, true);
  const m = new THREE.Mesh(geo, updraftMat);
  m.position.set(u.x, u.y0 + u.h / 2, u.z);
  m.renderOrder = 2;
  return m;
}

// 風帶：3 條交纏的光絲緞帶
export function makeRibbonMesh(rb) {
  const g = new THREE.Group();
  const pts = rb.pts, n = pts.length;
  for (let s = 0; s < 3; s++) {
    const pos = [], uv = [], idx = [];
    const ph = s * 2.1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], t = i / (n - 1);
      const q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
      const dx = q.x - o.x, dz = q.z - o.z, L = Math.hypot(dx, dz) || 1;
      const sx = -dz / L, sz = dx / L; // 側向
      const tw = Math.sin(t * 9 + ph) * 1.6, w = 0.55;
      const cy = p.y + Math.cos(t * 9 + ph) * 1.2;
      const cx = p.x + sx * tw, cz = p.z + sz * tw;
      pos.push(cx - sx * w, cy - w * 0.4, cz - sz * w, cx + sx * w, cy + w * 0.4, cz + sz * w);
      uv.push(t, 0, t, 1);
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, ribbonMat);
    m.renderOrder = 2;
    g.add(m);
  }
  return g;
}

// 肥沃地塊：貼合地形的發光圓盤 + 遠處可見的光柱
export function makePlotMesh(p) {
  const g = new THREE.Group();
  const RINGS = 4, ANG = 28, pos = [], uv = [], idx = [];
  for (let r = 0; r <= RINGS; r++) {
    for (let a = 0; a <= ANG; a++) {
      const rr = (r / RINGS) * p.r, th = (a / ANG) * Math.PI * 2;
      const x = p.x + Math.cos(th) * rr, z = p.z + Math.sin(th) * rr;
      pos.push(x, Math.max(heightAt(x, z), 0) + 0.35, z);
      uv.push(a / ANG, r / RINGS);
    }
  }
  for (let r = 0; r < RINGS; r++) for (let a = 0; a < ANG; a++) {
    const i0 = r * (ANG + 1) + a, i1 = i0 + ANG + 1;
    idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const disc = new THREE.Mesh(geo, fxMat(plotFrag, p.planted ? 0xff9ad5 : 0xd6ff6b));
  disc.material.uniforms.uAmp.value = p.planted ? 0.35 : 1;
  disc.material.userData.own = true;
  disc.renderOrder = 1;
  g.add(disc);
  if (!p.planted) {
    const beam = new THREE.Mesh(beamGeo, fxMat(beamFrag, 0xd6ff6b));
    beam.material.userData.own = true;
    beam.position.set(p.x, p.y, p.z);
    beam.renderOrder = 2;
    g.add(beam);
    p.beam = beam;
  }
  p.disc = disc;
  return g;
}

export function markPlotPlanted(p) {
  p.disc.material.uniforms.uColor.value.set(0xff9ad5);
  p.disc.material.uniforms.uAmp.value = 0.35;
  if (p.beam) { p.beam.removeFromParent(); p.beam.material.dispose(); p.beam = null; }
}

// 花海（兩個 InstancedMesh：莖、花朵），grown=false 時從 0 開始長出
const stemGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 4, 1, true).translate(0, 0.5, 0);
const headGeo = new THREE.IcosahedronGeometry(0.5, 0);
const stemMat = new THREE.MeshLambertMaterial({ color: 0x4f9a3a });
stemGeo.userData.shared = headGeo.userData.shared = true;
const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x221122 });
const PALETTE = [0xff7eb6, 0xffe066, 0xffffff, 0xc59bff, 0xff9f5a, 0xd6ff6b, 0x7affc8, 0xff5d73].map(c => new THREE.Color(c));
const FLOWERS = 150;

export function makeFlowerField(p, grown) {
  const rand = mulberry32(p.id * 7919 + 13);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, FLOWERS);
  const heads = new THREE.InstancedMesh(headGeo, headMat, FLOWERS);
  const data = [];
  for (let i = 0; i < FLOWERS; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (p.r + 7);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    const y = heightAt(x, z);
    if (y < 0.2) { data.push(null); continue; } // 水面不長花
    data.push({ x, y, z, h: 0.8 + rand() * 1.4, s: 0.7 + rand() * 0.8, delay: r / (p.r + 7) * 0.9 + rand() * 0.2 });
    heads.setColorAt(i, PALETTE[(rand() * PALETTE.length) | 0]);
  }
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  const field = { stems, heads, data, t: grown ? 99 : 0, done: false };
  setFieldGrowth(field);
  const g = new THREE.Group();
  g.add(stems, heads);
  field.group = g;
  return field;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
export function setFieldGrowth(f) {
  let all = true;
  for (let i = 0; i < f.data.length; i++) {
    const d = f.data[i];
    if (!d) { _m.makeScale(0, 0, 0); f.stems.setMatrixAt(i, _m); f.heads.setMatrixAt(i, _m); continue; }
    let k = Math.min(1, Math.max(0, (f.t - d.delay) / 0.8));
    if (k < 1) all = false;
    k = k <= 0 ? 0.0001 : easeOutBack(k);
    _m.compose(_v.set(d.x, d.y - 0.1, d.z), _q.identity(), _s.set(1, d.h * k, 1)); f.stems.setMatrixAt(i, _m);
    _m.compose(_v.set(d.x, d.y - 0.1 + d.h * k, d.z), _q.identity(), _s.setScalar(d.s * k)); f.heads.setMatrixAt(i, _m);
  }
  f.stems.instanceMatrix.needsUpdate = true; f.heads.instanceMatrix.needsUpdate = true;
  f.stems.computeBoundingSphere(); f.heads.computeBoundingSphere();
  f.done = all;
}

// 花粉：全域一組 Points，每幀由已載入分塊的花粉填入
export class PollenField {
  constructor(scene, cap = 900) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    const phase = new Float32Array(cap);
    for (let i = 0; i < cap; i++) phase[i] = Math.random() * 6.28;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.points = new THREE.Points(this.geo, makeGlowMat(0xffc830, 4.2, { twinkle: 5 }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  update(list, t) {
    let n = 0;
    for (const p of list) {
      if (!p.alive || n >= this.cap) continue;
      this.pos[n * 3] = p.x + Math.sin(t * 1.3 + p.ph) * 0.6;
      this.pos[n * 3 + 1] = p.y + Math.sin(t * 2 + p.ph) * 0.5;
      this.pos[n * 3 + 2] = p.z + Math.cos(t * 1.1 + p.ph) * 0.6;
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
  }
}
