// 三種視角 + 防暈：位置／注視點指數平滑、翻滾角上限、FOV 緩變、可關閉晃動
import * as THREE from 'three';
import { groundAt } from './world.js';

export const CAM_NAMES = ['追尾', '遠景電影', '第一人稱'];
const BASE_FOV = [62, 48, 72];

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 50, 20);
    this.look = new THREE.Vector3();
    this.roll = 0; this.fov = BASE_FOV[0]; this.shake = 0; this.orbit = 0;
    this._f = new THREE.Vector3(); this._d = new THREE.Vector3(); this._l = new THREE.Vector3();
  }

  cycle() { this.mode = (this.mode + 1) % 3; return this.mode; }

  snap(seed) { this.update(1, seed, { reduce: true }, 0, true); }

  update(dt, seed, settings, t, snap = false, title = false) {
    const reduce = settings.reduce;
    const f = seed.forward(this._f), p = seed.pos;
    const d = this._d, l = this._l;
    let k, kl;
    if (title) {
      // 標題畫面：繞種子緩慢環繞
      this.orbit += dt * 0.12;
      d.set(p.x + Math.sin(this.orbit) * 16, p.y + 4 + Math.sin(this.orbit * 0.7) * 2, p.z + Math.cos(this.orbit) * 16);
      l.copy(p); k = kl = 2;
    } else if (this.mode === 0) {
      d.copy(p).addScaledVector(f, -12).y += 4.2;
      l.copy(p).addScaledVector(f, 7).y += 0.8;
      k = reduce ? 3 : 4.5; kl = reduce ? 4 : 6;
    } else if (this.mode === 1) {
      this.orbit += dt * 0.05;
      const a = 0.9 + Math.sin(this.orbit) * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      d.set(p.x - (f.x * ca - f.z * sa) * 34, p.y + 13, p.z - (f.z * ca + f.x * sa) * 34);
      l.copy(p).addScaledVector(f, 6);
      k = 1.2; kl = 2.5;
    } else {
      d.copy(p).y += 0.6;
      l.copy(p).addScaledVector(f, 10).y += 0.6 + Math.sin(seed.pitch * 0.6) * 10;
      k = 14; kl = reduce ? 5 : 8;
    }
    // 鏡頭不得鑽入地面
    const gmin = groundAt(d.x, d.z) + 2;
    if (d.y < gmin) d.y = gmin;
    const a1 = snap ? 1 : 1 - Math.exp(-k * dt), a2 = snap ? 1 : 1 - Math.exp(-kl * dt);
    this.pos.lerp(d, a1);
    this.look.lerp(l, a2);
    const gcam = groundAt(this.pos.x, this.pos.z) + 1.5;
    if (this.pos.y < gcam) this.pos.y = gcam;

    this.cam.position.copy(this.pos);
    if (this.shake > 0 && !reduce) {
      this.cam.position.x += (Math.random() - 0.5) * this.shake;
      this.cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.shake = Math.max(0, this.shake - dt * 2);
    this.cam.lookAt(this.look);
    // 翻滾：追尾最多 ±6°、第一人稱 ±9°；減少晃動時為 0
    const maxRoll = reduce || title || this.mode === 1 ? 0 : this.mode === 2 ? 0.16 : 0.1;
    const tr = Math.max(-maxRoll, Math.min(maxRoll, seed.roll * 0.35));
    this.roll += (tr - this.roll) * (snap ? 1 : 1 - Math.exp(-3 * dt));
    this.cam.rotateZ(this.roll);
    // FOV：隨速度緩慢變寬；減少晃動時固定
    const tf = (title ? 55 : BASE_FOV[this.mode]) + (reduce || title ? 0 : Math.min(10, Math.max(0, (seed.speed - 16) * 0.45)));
    this.fov += (tf - this.fov) * (snap ? 1 : 1 - Math.exp(-1.2 * dt));
    if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
}
