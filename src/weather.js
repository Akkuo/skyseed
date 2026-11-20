// 天空穹頂、日夜循環、光照、霧、陣雨、螢火蟲、星空
import * as THREE from 'three';
import { makeGlowMat } from './features.js';
import { smoothstep, clamp, lerp } from './noise.js';

const DAY_LEN = 210; // 一個完整日夜循環（秒）
const C = (h) => new THREE.Color(h);
const SKY = {
  dayTop: C(0x4f9bff), dayHor: C(0xcdeaff),
  setTop: C(0x5a5fc8), setHor: C(0xffb07a),
  nightTop: C(0x050920), nightHor: C(0x18224a),
  rainTop: C(0x5d6876), rainHor: C(0x9aa4ad),
};

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.tod = 0.3;         // 0..1，0.5 為正午
    this.rain = 0;          // 0..1 雨勢
    this.rainOn = false;
    this.rainTimer = 40 + Math.random() * 30;
    this.top = new THREE.Color(); this.hor = new THREE.Color();
    this.sunDir = new THREE.Vector3();

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: this.top }, uHor: { value: this.hor }, uSun: { value: this.sunDir }, uSunAmt: { value: 1 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uSunAmt; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(uHor, uTop, pow(max(h, 0.0), 0.55));
          float s = max(dot(normalize(vDir), uSun), 0.0);
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.25) * uSunAmt;
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // 星空
    const sp = [], ph = [];
    for (let i = 0; i < 500; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.9 + 0.1);
      sp.push(Math.sin(v) * Math.cos(u) * 450, Math.cos(v) * 450, Math.sin(v) * Math.sin(u) * 450);
      ph.push(Math.random() * 6.28);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('phase', new THREE.Float32BufferAttribute(ph, 1));
    this.starMat = makeGlowMat(0xdfe8ff, 3, { atten: false, opacity: 0, twinkle: 2 });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.hemi = new THREE.HemisphereLight(0xdff2ff, 0x5a6a3a, 1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xcdeaff, 90, 300);

    // 螢火蟲（夜間）
    this.FF = 90;
    this.ffPos = new Float32Array(this.FF * 3);
    this.ffSeed = [];
    for (let i = 0; i < this.FF; i++) this.ffSeed.push({ x: (Math.random() - 0.5) * 120, y: Math.random() * 30, z: (Math.random() - 0.5) * 120, p: Math.random() * 6.28 });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.ffPos, 3));
    fg.setAttribute('phase', new THREE.Float32BufferAttribute(this.ffSeed.map(s => s.p), 1));
    this.ffMat = makeGlowMat(0xc8ff6b, 1.6, { opacity: 0, twinkle: 6 });
    this.fireflies = new THREE.Points(fg, this.ffMat);
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);

    // 雨絲
    this.RN = 900;
    this.rainPos = new Float32Array(this.RN * 6);
    this.rainSeed = new Float32Array(this.RN * 3);
    for (let i = 0; i < this.RN; i++) { this.rainSeed[i * 3] = Math.random(); this.rainSeed[i * 3 + 1] = Math.random(); this.rainSeed[i * 3 + 2] = Math.random(); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0, depthWrite: false });
    this.rainLines = new THREE.LineSegments(rg, this.rainMat);
    this.rainLines.frustumCulled = false;
    scene.add(this.rainLines);
    this.night = 0; this.day = 1;
  }

  get isNight() { return this.night > 0.6; }

  reset() { this.tod = 0.3; this.rain = 0; this.rainOn = false; this.rainTimer = 40 + Math.random() * 30; }

  update(dt, t, camPos, playerPos, simulate) {
    if (simulate) {
      this.tod = (this.tod + dt / DAY_LEN) % 1;
      this.rainTimer -= dt;
      if (this.rainTimer <= 0) {
        this.rainOn = !this.rainOn;
        this.rainTimer = this.rainOn ? 16 + Math.random() * 12 : 45 + Math.random() * 40;
      }
    }
    this.rain = clamp(this.rain + (this.rainOn ? dt / 4 : -dt / 5), 0, 1);

    const ang = (this.tod - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.8, elev, -0.45).normalize();
    this.day = smoothstep(-0.18, 0.22, elev);
    this.night = 1 - this.day;
    const sunset = clamp(1 - Math.abs(elev) * 3.2, 0, 1);

    this.top.copy(SKY.nightTop).lerp(SKY.dayTop, this.day).lerp(SKY.setTop, sunset * 0.55);
    this.hor.copy(SKY.nightHor).lerp(SKY.dayHor, this.day).lerp(SKY.setHor, sunset * 0.75);
    const rk = this.rain * 0.75;
    this.top.lerp(SKY.rainTop, rk * (0.3 + this.day * 0.7)); this.hor.lerp(SKY.rainHor, rk * (0.3 + this.day * 0.7));
    this.skyMat.uniforms.uSunAmt.value = this.day * (1 - this.rain * 0.9);
    this.scene.fog.color.copy(this.hor);
    this.scene.fog.near = lerp(90, 45, this.rain);
    this.scene.fog.far = lerp(300, 200, this.rain);

    this.hemi.intensity = 0.32 + this.day * 0.95 * (1 - this.rain * 0.3);
    this.hemi.color.setRGB(lerp(0.45, 0.88, this.day), lerp(0.55, 0.95, this.day), 1);
    this.sun.intensity = this.day * 1.6 * (1 - this.rain * 0.6) + this.night * 0.25;
    this.sun.color.setRGB(1, lerp(0.75, 0.95, 1 - sunset), lerp(0.55, 0.85, 1 - sunset));
    const sd = elev > -0.05 ? this.sunDir : this.sunDir.clone().negate(); // 夜裡用月光方向
    this.sun.position.copy(playerPos).addScaledVector(sd, 100);
    this.sun.target.position.copy(playerPos);

    this.sky.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.starMat.uniforms.uOpacity.value = smoothstep(0.4, 1, this.night) * (1 - this.rain);

    // 螢火蟲：在玩家周圍環繞包裹
    this.ffMat.uniforms.uOpacity.value = smoothstep(0.5, 1, this.night) * (1 - this.rain * 0.8);
    if (this.ffMat.uniforms.uOpacity.value > 0) {
      for (let i = 0; i < this.FF; i++) {
        const s = this.ffSeed[i];
        const wrap = (v, c) => c + ((((v - c) % 120) + 180) % 120) - 60;
        this.ffPos[i * 3] = wrap(s.x + Math.sin(t * 0.3 + s.p) * 6, playerPos.x);
        this.ffPos[i * 3 + 2] = wrap(s.z + Math.cos(t * 0.27 + s.p) * 6, playerPos.z);
        this.ffPos[i * 3 + 1] = playerPos.y - 18 + s.y + Math.sin(t * 0.8 + s.p) * 2;
      }
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    }

    // 雨絲：以鏡頭為中心的盒子內循環落下
    this.rainMat.opacity = this.rain * 0.55;
    this.rainLines.visible = this.rain > 0.01;
    if (this.rainLines.visible) {
      const S = 70, Hh = 50, sp = 46;
      for (let i = 0; i < this.RN; i++) {
        const x = camPos.x + (this.rainSeed[i * 3] - 0.5) * S;
        const z = camPos.z + (this.rainSeed[i * 3 + 2] - 0.5) * S;
        const y = camPos.y + Hh / 2 - (((this.rainSeed[i * 3 + 1] * Hh + t * sp) % Hh));
        const o = i * 6;
        this.rainPos[o] = x; this.rainPos[o + 1] = y; this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x + 0.15; this.rainPos[o + 4] = y + 1.6; this.rainPos[o + 5] = z;
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
  }
}
