// SKYSEED 種子遠航 — 主程式：場景組裝、狀態機、HUD、主迴圈、除錯介面
import * as THREE from 'three';
import { BIOMES, CHUNK, groundAt, biomeIndexAt } from './world.js';
import { ChunkManager } from './terrain.js';
import { U, PollenField } from './features.js';
import { Weather } from './weather.js';
import { Seed, MAX_VIT } from './player.js';
import { CameraRig, CAM_NAMES } from './camera.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

const GOAL = 8;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('skyseed.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('skyseed.' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式等：照常遊玩 */ } },
};

// ---- 場景 ----
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 1000);
const world = new ChunkManager(scene);
const weather = new Weather(scene);
const seed = new Seed(scene);
const rig = new CameraRig(camera);
const pollenFx = new PollenField(scene);
const audio = new Audio();
const settings = Object.assign({ reduce: false, cam: 0 }, store.get('settings', {}));
rig.mode = settings.cam | 0;

let renderScale = 1;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * renderScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  U.pr.value = dpr;
  document.body.classList.toggle('portrait', innerHeight > innerWidth);
}
addEventListener('resize', resize);
resize();

// ---- 遊戲狀態 ----
const G = { scene: 'title', frame: 0, fps: 0, t: 0, flowers: 0, pollen: 0, journey: 0, score: 0, biome: 0, hits: 0, endAt: 0, best: store.get('best', 0) };

function newWorld() {
  world.reset();
  weather.reset();
  const y = groundAt(0, 0) + 42;
  seed.reset(0, y, 0);
  world.forceLoad(0, 0);
  G.flowers = G.pollen = G.journey = G.score = G.hits = 0;
  G.biome = biomeIndexAt(0);
  G.hoverY = y;
}

function setScene(s) {
  G.scene = s;
  $('title').classList.toggle('hidden', s !== 'title');
  $('pause').classList.toggle('hidden', s !== 'paused');
  $('end').classList.toggle('hidden', s !== 'win' && s !== 'lose');
  $('hud').classList.toggle('hidden', s === 'title');
  document.body.classList.toggle('playing', s === 'playing');
}

function start() {
  audio.init();
  newWorld();
  rig.snap(seed);
  setScene('playing');
  toast(BIOMES[G.biome].name + '：乘風出發');
}
window.__start = start;

function finish(win) {
  G.endAt = performance.now();
  const best = Math.max(G.best, G.score);
  const isBest = G.score > G.best;
  G.best = best; store.set('best', best);
  $('endTitle').textContent = win ? '花開遍野' : '種子落地';
  $('endText').innerHTML = (win ? `你種出了 ${GOAL} 片花海，風把你的故事帶得很遠。` : '生命力耗盡，這趟旅程在此歇息。') +
    `<br>分數 <b>${G.score}</b>${isBest ? '（新紀錄！）' : ''}　·　最佳 ${best}<br>花海 ${G.flowers}　·　花粉 ${G.pollen}　·　航程 ${Math.round(G.journey)} m`;
  setScene(win ? 'win' : 'lose');
  audio.sfx(win ? 'win' : 'lose');
}

let toastTimer = 0;
function toast(msg, dur = 2.2) { $('toast').textContent = msg; $('toast').classList.add('on'); toastTimer = dur; }

function applySettings() {
  for (const el of document.querySelectorAll('.optReduce')) el.checked = settings.reduce;
  settings.cam = rig.mode;
  store.set('settings', settings);
}
for (const el of document.querySelectorAll('.optReduce')) {
  el.addEventListener('change', () => { settings.reduce = el.checked; applySettings(); });
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.parentElement.addEventListener('click', e => e.stopPropagation());
}
applySettings();
$('best').textContent = '最佳紀錄：' + (G.best || '—');

// ---- 輸入 ----
const input = new Input(code => {
  if (code === 'KeyM') { audio.init(); toast(audio.toggleMute() ? '已靜音' : '音效開啟', 1.2); return; }
  const s = G.scene;
  if (s === 'title') { if (code === 'Enter' || code === 'Space') start(); return; }
  if (s === 'playing') {
    if (code === 'KeyP' || code === 'Escape') { setScene('paused'); audio.sfx('click'); }
    else if (code === 'KeyC') { rig.cycle(); applySettings(); toast('視角：' + CAM_NAMES[rig.mode], 1.2); }
    return;
  }
  if (s === 'paused') {
    if (code === 'KeyP' || code === 'Escape' || code === 'Enter') setScene('playing');
    else if (code === 'KeyR') start();
    return;
  }
  if ((s === 'win' || s === 'lose') && performance.now() - G.endAt > 600 && (code === 'Enter' || code === 'KeyR' || code === 'Space')) start();
});
$('title').addEventListener('click', e => { if (G.scene === 'title') start(); });
$('btnStart').addEventListener('click', e => { e.stopPropagation(); if (G.scene === 'title') start(); });

// ---- HUD ----
const _f = new THREE.Vector3();
function nearestPlot() {
  let best = null, bd = 1e9;
  for (const p of world.active.plots) {
    if (p.planted) continue;
    const d = Math.hypot(p.x - seed.pos.x, p.z - seed.pos.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: bd } : null;
}
function updateHUD() {
  $('hFlowers').textContent = `${G.flowers} / ${GOAL}`;
  $('hPollen').textContent = G.pollen;
  $('hScore').textContent = G.score;
  $('hBiome').textContent = BIOMES[G.biome].name;
  const tod = weather.tod, hour = Math.floor(((tod * 24) + 24) % 24);
  const phase = weather.isNight ? '夜晚' : hour < 9 ? '清晨' : hour >= 17 ? '黃昏' : '白天';
  $('hEnv').textContent = `${phase} ${String(hour).padStart(2, '0')}:00 · ${weather.rain > 0.3 ? '陣雨（下沉加快）' : '晴'}`;
  const v = seed.vitality / MAX_VIT;
  $('vitFill').style.width = (v * 100).toFixed(1) + '%';
  $('vitFill').classList.toggle('low', v < 0.3);
  $('hAlt').textContent = Math.round(seed.pos.y - groundAt(seed.pos.x, seed.pos.z));
  $('hSpd').textContent = Math.round(seed.speed);
  $('hCam').textContent = CAM_NAMES[rig.mode];
  $('hState').textContent = seed.inUpdraft > 0.5 ? '↑ 上升氣流' : seed.inWind > 0.1 ? '≫ 乘著風帶' : seed.umbrella ? '張傘中' : seed.dive ? '俯衝' : '';
  const np = nearestPlot();
  if (np) {
    const ty = Math.atan2(-(np.p.x - seed.pos.x), -(np.p.z - seed.pos.z));
    let rel = ty - seed.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    $('arrowGlyph').style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
    $('plotDist').textContent = `肥沃地 ${Math.round(np.d)} m`;
    $('plotArrow').style.opacity = 1;
  } else $('plotArrow').style.opacity = 0.3;
}

// ---- 主迴圈 ----
let last = performance.now(), fpsN = 0, fpsT = 0, hudT = 0, qT = 0, qN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  G.frame++; fpsN++; fpsT += dt;
  if (fpsT >= 1) { G.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  const playing = G.scene === 'playing';
  if (G.scene !== 'paused') G.t += dt;
  U.time.value = G.t;

  if (playing) {
    const ev = seed.update(dt, input.state(), { lists: world.active, rain: weather.rain });
    for (const e of ev) {
      if (e.type === 'pollen') { G.pollen++; audio.sfx('pollen'); }
      else if (e.type === 'plant') {
        world.plant(e.plot); G.flowers++; audio.sfx('plant');
        toast(G.flowers >= GOAL ? '最後一片花海！' : `花海綻放！ ${G.flowers} / ${GOAL}`);
        rig.shake = 0.25;
      } else if (e.type === 'hit') { G.hits++; audio.sfx('hit'); rig.shake = 0.6; toast('撞到了！生命力 -15', 1.2); }
    }
    G.journey = Math.max(G.journey, -seed.pos.z);
    G.score = G.flowers * 100 + G.pollen * 5 + Math.floor(G.journey / 10);
    const b = biomeIndexAt(seed.pos.z);
    if (b !== G.biome) { G.biome = b; toast('進入 ' + BIOMES[b].name); audio.sfx('biome'); }
    if (G.flowers >= GOAL) finish(true);
    else if (ev.some(e => e.type === 'dead')) finish(false);
  } else if (G.scene === 'title') {
    seed.pos.y = G.hoverY + Math.sin(G.t * 0.8) * 0.6;
    seed.yaw = Math.sin(G.t * 0.2) * 0.3;
  }

  if (G.scene !== 'paused') {
    world.update(seed.pos.x, seed.pos.z, dt, 1);
    weather.update(dt, G.t, camera.position, seed.pos, playing);
    pollenFx.update(world.active.pollen, G.t);
    seed.animate(dt, G.t, playing && rig.mode === 2);
    rig.update(dt, seed, settings, G.t, false, G.scene === 'title');
  }
  U.far.value = scene.fog.far;
  renderer.render(scene, camera);

  hudT += dt;
  if (hudT > 0.1 && G.scene !== 'title') { hudT = 0; updateHUD(); }
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('on'); }
  audio.update({ playing, speed: seed.speed, wind: seed.inWind, lift: seed.inUpdraft, rain: weather.rain, biome: G.biome, night: weather.night });

  // 自適應解析度：持續低於 28 FPS 時降低渲染比例
  qT += dt; qN++;
  if (qT > 2) {
    const f = qN / qT; qT = 0; qN = 0;
    if (f < 28 && renderScale > 0.5) { renderScale = Math.max(0.5, renderScale - 0.15); resize(); }
    else if (f > 55 && renderScale < 1) { renderScale = Math.min(1, renderScale + 0.1); resize(); }
  }
}

newWorld();
rig.update(1, seed, settings, 0, true, true);
setScene('title');
if (new URLSearchParams(location.search).get('autostart') === '1') start();
requestAnimationFrame(loop);

// ---- 自動驗證用 ----
window.__debug = () => ({
  scene: G.scene, frame: G.frame, fps: G.fps,
  player: { x: +seed.pos.x.toFixed(2), y: +seed.pos.y.toFixed(2), z: +seed.pos.z.toFixed(2), yaw: +seed.yaw.toFixed(3), pitch: +seed.pitch.toFixed(3),
    speed: +seed.speed.toFixed(2), alt: +(seed.pos.y - groundAt(seed.pos.x, seed.pos.z)).toFixed(2), umbrella: seed.umbrella, dive: seed.dive,
    inUpdraft: +seed.inUpdraft.toFixed(2), inWind: +seed.inWind.toFixed(2) },
  vitality: +seed.vitality.toFixed(1), flowers: G.flowers, goal: GOAL, pollen: G.pollen, score: G.score, hits: G.hits,
  biome: BIOMES[G.biome].key, biomeName: BIOMES[G.biome].name, level: G.biome,
  chunk: [Math.floor(seed.pos.x / CHUNK), Math.floor(seed.pos.z / CHUNK)], chunksLoaded: world.loaded,
  features: { updrafts: world.active.updrafts.length, ribbons: world.active.ribbons.length, plots: world.active.plots.length, pollen: world.active.pollen.filter(p => p.alive).length },
  camMode: CAM_NAMES[rig.mode], reduceMotion: settings.reduce, timeOfDay: +weather.tod.toFixed(3), night: weather.isNight, rain: +weather.rain.toFixed(2),
  renderScale: +renderScale.toFixed(2), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
});
// 測試鉤子：直接把種子移到某處、設定時間或雨勢（僅供驗證截圖）
window.__test = {
  teleport(x, z, alt = 30) { seed.pos.set(x, groundAt(x, z) + alt, z); world.forceLoad(x, z); rig.snap(seed); },
  setTime(t) { weather.tod = t; }, rain(on) { weather.rainOn = on; weather.rain = on ? 1 : 0; },
  cam(m) { rig.mode = m; rig.snap(seed); },
  kill() { seed.vitality = 0.01; },
  nearestPlot() { const n = nearestPlot(); return n && { x: n.p.x, z: n.p.z, y: n.p.y, d: n.d }; },
  nearestUpdraft() { let b = null, bd = 1e9; for (const u of world.active.updrafts) { const d = Math.hypot(u.x - seed.pos.x, u.z - seed.pos.z); if (d < bd) { bd = d; b = u; } } return b && { x: b.x, z: b.z, y0: b.y0 }; },
  place(x, y, z, yaw = 0) { seed.pos.set(x, y, z); seed.yaw = yaw; seed.speed = 15; seed.pitch = -0.07; seed.boostVy = 0; rig.snap(seed); },
};
