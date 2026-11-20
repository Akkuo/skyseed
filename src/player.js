// 蒲公英種子：模型 + 滑翔物理 + 與世界物件的互動
import * as THREE from 'three';
import { groundAt } from './world.js';
import { makeGlowMat } from './features.js';
import { clamp, smoothstep } from './noise.js';

const NEUTRAL_PITCH = -0.07;
export const MAX_VIT = 100;

export class Seed {
  constructor(scene) {
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    const brown = new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true });
    const achene = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.9, 6).rotateX(Math.PI), brown);
    achene.position.y = -1.65;
    const beak = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 4), new THREE.MeshLambertMaterial({ color: 0xeef2e6 }));
    beak.position.y = -0.6;
    // 冠毛：放射細絲 + 末端光點
    const lines = [], tips = [], ph = [];
    const N = 46;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i + 0.5) / N * 0.75, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      const tx = Math.cos(a) * r * 1.15, ty = y * 0.75 + 0.05, tz = Math.sin(a) * r * 1.15;
      lines.push(0, 0, 0, tx, ty, tz);
      tips.push(tx, ty, tz); ph.push(Math.random() * 6);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.pappus = new THREE.Group();
    this.pappus.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })));
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tips, 3));
    tg.setAttribute('phase', new THREE.Float32BufferAttribute(ph, 1));
    this.tipMat = makeGlowMat(0xf4ffe0, 0.55, { twinkle: 2 });
    this.pappus.add(new THREE.Points(tg, this.tipMat));
    this.tilt.add(achene, beak, this.pappus);
    this.root.scale.setScalar(1.35);
    scene.add(this.root);
    this.pos = this.root.position;
    this.reset(0, 40, 0);
  }

  reset(x, y, z) {
    this.pos.set(x, y, z);
    this.yaw = 0; this.yawRate = 0; this.pitch = NEUTRAL_PITCH; this.roll = 0;
    this.speed = 15; this.boostVy = 0; this.vy = 0;
    this.vitality = MAX_VIT; this.invuln = 0;
    this.umbrella = false; this.dive = false;
    this.inUpdraft = 0; this.inWind = 0;
    this.open = 0;
  }

  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  // env: { lists, rain }；回傳事件陣列
  update(dt, inp, env) {
    const ev = [];
    this.umbrella = inp.umbrella; this.dive = inp.dive && !inp.umbrella;
    let pt = NEUTRAL_PITCH + (inp.pitch > 0 ? inp.pitch * 0.42 : inp.pitch * 0.5);
    if (this.dive) pt = -0.85;
    this.pitch += (pt - this.pitch) * (1 - Math.exp(-3 * dt));
    const yr = -inp.turn * 1.3 * (this.dive ? 0.7 : this.umbrella ? 1.35 : 1); // 張傘時可小半徑盤旋
    this.yawRate += (yr - this.yawRate) * (1 - Math.exp(-4 * dt));
    this.yaw += this.yawRate * dt;
    this.roll += (clamp(-this.yawRate * 0.4, -0.4, 0.4) - this.roll) * (1 - Math.exp(-5 * dt));

    const { updrafts, ribbons, plots, pollen, solids } = env.lists;
    const p = this.pos;
    const g = groundAt(p.x, p.z);
    const alt = p.y - g;

    // 上升氣流
    let lift = 0;
    for (const u of updrafts) {
      const d = Math.hypot(p.x - u.x, p.z - u.z);
      if (d < u.r && p.y < u.y0 + u.h) {
        const k = 1 - (d / u.r) ** 2;
        lift += u.str * k * (this.umbrella ? 1.9 : 1) * (1 - smoothstep(u.y0 + u.h - 35, u.y0 + u.h, p.y));
      }
    }
    if (alt > 115) lift *= Math.max(0, 1 - (alt - 115) / 20);
    this.inUpdraft = lift;

    // 風帶：最近線段的切線方向推送 + 輕微吸附到緞帶高度
    let wx = 0, wz = 0, wy = 0, windK = 0;
    for (const rb of ribbons) {
      const P = rb.pts;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const L2 = abx * abx + aby * aby + abz * abz;
        const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / L2, 0, 1);
        const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
        const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
        if (d < 6.5) {
          const k = 1 - d / 6.5, L = Math.sqrt(L2);
          if (k > windK) { windK = k; wx = abx / L * rb.str * k; wz = abz / L * rb.str * k; wy = (cy - p.y) * 1.2 * k; }
        }
      }
    }
    this.inWind = windK;

    let acc = -15 * Math.sin(this.pitch) - 0.22 * (this.speed - 15);
    if (this.umbrella) acc -= 1.1 * (this.speed - 7);
    if (windK > 0) acc += 14 * windK;
    this.speed = clamp(this.speed + acc * dt, 4, 48);

    const sink = 1.5 - (this.umbrella ? 0.95 : 0) + env.rain * 1.6;
    this.vy = this.speed * Math.sin(this.pitch) - sink + lift + this.boostVy + wy;
    const hs = this.speed * Math.cos(this.pitch);
    p.x += (-Math.sin(this.yaw) * hs + wx) * dt;
    p.z += (-Math.cos(this.yaw) * hs + wz) * dt;
    p.y += this.vy * dt;
    this.boostVy *= Math.exp(-1.6 * dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.vitality -= (0.9 + env.rain * 0.5) * dt;

    // 地面接觸：肥沃地塊 = 種花；其他 = 彈起並損失生命力
    const g2 = groundAt(p.x, p.z);
    if (p.y < g2 + 0.9) {
      const plot = plots.find(q => !q.planted && Math.hypot(p.x - q.x, p.z - q.z) < q.r + 1.5);
      if (plot) {
        ev.push({ type: 'plant', plot });
        this.vitality = Math.min(MAX_VIT, this.vitality + 30);
        this.boostVy = 26; this.speed = 14; this.pitch = 0; p.y = g2 + 1;
      } else this.hit(ev, g2 + 0.9);
    }
    for (const s of solids) {
      if (Math.abs(p.x - s.x) < s.hw && Math.abs(p.z - s.z) < s.hd && p.y < s.top) { this.hit(ev, s.top + 0.3); break; }
    }
    // 花粉
    for (const q of pollen) {
      if (q.alive && Math.abs(q.x - p.x) < 3.4 && Math.abs(q.z - p.z) < 3.4 && Math.abs(q.y - p.y) < 3.4) {
        q.alive = false;
        this.vitality = Math.min(MAX_VIT, this.vitality + 6);
        ev.push({ type: 'pollen' });
      }
    }
    if (this.vitality <= 0) { this.vitality = 0; ev.push({ type: 'dead' }); }
    return ev;
  }

  hit(ev, y) {
    this.pos.y = Math.max(this.pos.y, y);
    this.boostVy = Math.max(this.boostVy, 24); // 主對話抽查：15 反彈太低，落地後會連撞致死
    if (this.invuln > 0) return;
    this.invuln = 2.2; this.speed *= 0.6; this.vitality -= 15;
    ev.push({ type: 'hit' });
  }

  // 視覺：搖曳、張傘時冠毛撐開
  animate(dt, t, hidden) {
    this.root.visible = !hidden;
    this.root.rotation.set(0, this.yaw, 0);
    this.tilt.rotation.set(this.pitch * 0.6 - 0.12 + Math.sin(t * 1.7) * 0.05, 0, this.roll + Math.sin(t * 1.3) * 0.04);
    this.open += ((this.umbrella ? 1 : 0) - this.open) * (1 - Math.exp(-6 * dt));
    const s = 1 + this.open * 0.35 - (this.dive ? 0.15 : 0);
    this.pappus.scale.set(s, 1 - this.open * 0.25, s);
    this.tipMat.uniforms.uOpacity.value = this.invuln > 0 ? (Math.sin(t * 30) > 0 ? 1 : 0.2) : 1;
  }
}
