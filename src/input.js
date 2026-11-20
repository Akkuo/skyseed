// 鍵盤（KeyboardEvent.code）+ 觸控虛擬搖桿／按鈕
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyM', 'KeyP', 'Escape', 'Enter', 'KeyR']);

export class Input {
  constructor(onPress) {
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.btn = { umbrella: false, dive: false };
    this.onPress = onPress;
    this.touch = false;
    addEventListener('keydown', e => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.onPress(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.btn.umbrella = this.btn.dive = false; this.joy.x = this.joy.y = 0; });
    if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) this.enableTouch();
    addEventListener('touchstart', () => this.enableTouch(), { passive: true, once: true });
    this.setupJoystick();
    for (const el of document.querySelectorAll('[data-hold]')) {
      const k = el.dataset.hold;
      const on = e => { e.preventDefault(); this.btn[k] = true; el.classList.add('on'); };
      const off = e => { e.preventDefault(); this.btn[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    }
    for (const el of document.querySelectorAll('[data-tap]')) {
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.onPress(el.dataset.tap); });
    }
  }

  enableTouch() { if (!this.touch) { this.touch = true; document.body.classList.add('touch'); } }

  setupJoystick() {
    const zone = document.getElementById('joy'), knob = document.getElementById('knob');
    let id = null, cx = 0, cy = 0;
    const R = 46;
    const move = e => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const L = Math.hypot(dx, dy);
      if (L > R) { dx *= R / L; dy *= R / L; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.x = dx / R; this.joy.y = dy / R;
    };
    zone.addEventListener('pointerdown', e => {
      e.preventDefault(); id = e.pointerId; zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e);
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const end = e => { if (e.pointerId !== id) return; id = null; this.joy.x = this.joy.y = 0; knob.style.transform = ''; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }

  // turn: +1 右轉；pitch: +1 抬頭（S/↓、搖桿往下拉），-1 壓低（W/↑、搖桿往上推）
  state() {
    const k = this.keys, dz = v => (Math.abs(v) < 0.15 ? 0 : v);
    const turn = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + dz(this.joy.x);
    const pitch = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + dz(this.joy.y);
    return {
      turn: Math.max(-1, Math.min(1, turn)),
      pitch: Math.max(-1, Math.min(1, pitch)),
      umbrella: k.has('Space') || this.btn.umbrella,
      dive: k.has('ShiftLeft') || k.has('ShiftRight') || this.btn.dive,
    };
  }
}
