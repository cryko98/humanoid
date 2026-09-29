// Humanoid avatar engine — Ready Player Me GLB + Three.js
// Face: ARKit blendshapes + Oculus visemes. Body: Mixamo-compatible skeleton.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Ready Player Me avatars with ARKit + Oculus viseme morph targets baked in.
// First source is served via jsDelivr's GitHub CDN; the second is the RPM model API.
const AVATAR_SOURCES = [
  'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@main/avatars/brunette.glb',
  'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb?morphTargets=ARKit,Oculus%20Visemes&textureSizeLimit=1024&textureFormat=png',
];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// English letter -> Oculus viseme (approximate, per letter)
const EN_VISEME = {
  a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I',
  p: 'PP', b: 'PP', m: 'PP', f: 'FF', v: 'FF', w: 'U',
  t: 'DD', d: 'DD', n: 'nn', l: 'nn', s: 'SS', z: 'SS', c: 'kk', x: 'SS',
  k: 'kk', g: 'kk', h: 'kk', q: 'kk', r: 'RR', j: 'CH',
};
const DIGRAPH = { th: 'TH', sh: 'CH', ch: 'CH', ph: 'FF', wh: 'U', ck: 'kk', ng: 'nn', oo: 'U', ee: 'I', ou: 'O', ow: 'O', ea: 'I', ai: 'E' };
const VOWELS = new Set(['aa', 'E', 'I', 'O', 'U']);
const ALL_VISEMES = ['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','I','O','U'];

// Arm gesture poses (radians, per bone [x,y,z])
const GESTURES = {
  rest:   { RightArm: [1.25, 0.0, -0.25], RightForeArm: [0.15, 0.0, 0.0], RightHand: [0, 0, 0],
            LeftArm:  [1.25, 0.0,  0.25], LeftForeArm:  [0.15, 0.0, 0.0], LeftHand:  [0, 0, 0] },
  point:  { RightArm: [0.35, -0.6, -0.9], RightForeArm: [0.0, 0.4, -0.3], RightHand: [-0.2, 0, 0.1],
            LeftArm:  [1.25, 0.0,  0.25], LeftForeArm:  [0.15, 0.0, 0.0], LeftHand:  [0, 0, 0] },
  explain:{ RightArm: [0.85, -0.3, -0.7], RightForeArm: [0.0, 0.9, -1.2], RightHand: [0, 0, -0.3],
            LeftArm:  [0.85, 0.3, 0.7],   LeftForeArm:  [0.0, -0.9, 1.2], LeftHand:  [0, 0, 0.3] },
  wave:   { RightArm: [-0.2, -0.3, -1.0], RightForeArm: [0.0, 0.2, -1.6], RightHand: [0, 0, 0],
            LeftArm:  [1.25, 0.0,  0.25], LeftForeArm:  [0.15, 0.0, 0.0], LeftHand:  [0, 0, 0] },
  think:  { RightArm: [1.0, -0.2, -0.5], RightForeArm: [0.0, 1.1, -2.3], RightHand: [0.4, 0.3, 0],
            LeftArm:  [1.25, 0.0,  0.25], LeftForeArm:  [0.15, 0.0, 0.0], LeftHand:  [0, 0, 0] },
  self:   { RightArm: [0.9, -0.2, -0.5], RightForeArm: [0.0, 0.8, -2.0], RightHand: [0, 0.4, 0],
            LeftArm:  [1.25, 0.0,  0.25], LeftForeArm:  [0.15, 0.0, 0.0], LeftHand:  [0, 0, 0] },
};

export class Avatar {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.onStatus = opts.onStatus || (() => {});
    this.robotSkin = opts.robotSkin !== false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    this.camera.position.set(0, 1.5, 1.35);
    this.lookTarget = new THREE.Vector3(0, 1.45, 0);

    const key = new THREE.DirectionalLight(0xdff6ff, 2.2); key.position.set(1.2, 2.6, 2); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8b5cff, 2.5); rim.position.set(-2, 1.8, -1.5); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x19e6ff, 0.8); fill.position.set(-1.5, 0.8, 1.8); this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x223355, 0.6));

    // state
    this.morphMeshes = [];
    this.bones = {};
    this.morph = {};          // current values
    this.morphTarget = {};    // target values
    this.mouse = { x: 0, y: 0 };
    this.headPose = { x: 0, y: 0, z: 0 };
    this.t = 0;
    this.speaking = false;
    this.mood = 'neutral';
    this.visemeQueue = [];    // {time, viseme, dur}
    this.currentViseme = 'sil';
    this.gesture = 'rest';
    this.gestureLerp = {};
    this.nextBlink = 2;
    this.blinkT = 0;
    this.nextSaccade = 1;
    this.eyeOffset = { x: 0, y: 0 };
    this.eyeGoal = { x: 0, y: 0 };
    this.nextGesture = 0;

    window.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(url) {
    this.onStatus('LOADING AVATAR…');
    const loader = new GLTFLoader();
    const sources = url ? [url, ...AVATAR_SOURCES] : AVATAR_SOURCES;
    let gltf = null, lastErr = null;
    for (const src of sources) {
      try { gltf = await loader.loadAsync(src); break; }
      catch (e) { lastErr = e; console.warn('Avatar source failed:', src, e); }
    }
    if (!gltf) throw lastErr;

    if (this.model) this.scene.remove(this.model);
    this.model = gltf.scene;
    this.scene.add(this.model);
    this.morphMeshes = [];
    this.bones = {};

    this.model.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        if (o.morphTargetDictionary) this.morphMeshes.push(o);
        this.styleMesh(o);
      }
    });

    // framing: camera on the upper body
    const head = this.bones.Head;
    if (head) {
      const p = new THREE.Vector3(); head.getWorldPosition(p);
      this.lookTarget.set(0, p.y - 0.2, 0);
      this.camera.position.set(0, p.y - 0.1, 1.55);
    }
    for (const b of ['RightArm','RightForeArm','RightHand','LeftArm','LeftForeArm','LeftHand']) {
      this.gestureLerp[b] = GESTURES.rest[b] ? [...GESTURES.rest[b]] : [0,0,0];
    }
    this.setMood('neutral');
    this.onStatus('IDLE');
    return this;
  }

  styleMesh(o) {
    const n = o.name.toLowerCase();
    const m = o.material;
    if (!m) return;
    if (n.includes('hair') || n.includes('glasses') || n.includes('headwear')) { o.visible = false; return; }
    if (this.robotSkin && (n.includes('head') || n.includes('body') || n.includes('skin'))) {
      // Ameca-like grey, slightly satin "robot skin"
      m.map = null;
      m.color = new THREE.Color(0x9aa5b4);
      m.roughness = 0.5;
      m.metalness = 0.12;
      m.envMapIntensity = 0.9;
      m.needsUpdate = true;
    }
    if (n.includes('outfit')) {
      m.map = null;
      m.color = new THREE.Color(0x1c2129);
      m.roughness = 0.35;
      m.metalness = 0.85;
      m.needsUpdate = true;
    }
    if (n.includes('eye') && !n.includes('brow')) {
      m.emissive = new THREE.Color(0x19e6ff);
      m.emissiveIntensity = 0.15;
    }
    if (n.includes('teeth')) { m.color = new THREE.Color(0xdde6ee); }
  }

  // ---- morph helpers ----
  setTarget(name, v) { this.morphTarget[name] = v; }
  applyMorphs(dt) {
    const k = 1 - Math.exp(-dt * 18);
    for (const name in this.morphTarget) {
      const cur = this.morph[name] ?? 0;
      const nv = lerp(cur, this.morphTarget[name], k);
      this.morph[name] = nv;
      for (const mesh of this.morphMeshes) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx !== undefined) mesh.morphTargetInfluences[idx] = nv;
      }
    }
  }

  setMood(mood) {
    this.mood = mood;
    const M = {
      neutral: { mouthSmileLeft: 0.18, mouthSmileRight: 0.18, browInnerUp: 0.08, eyeSquintLeft: 0.05, eyeSquintRight: 0.05 },
      happy:   { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, cheekSquintLeft: 0.3, cheekSquintRight: 0.3, browInnerUp: 0.2, eyeSquintLeft: 0.2, eyeSquintRight: 0.2 },
      think:   { mouthPressLeft: 0.3, mouthPressRight: 0.3, browDownLeft: 0.35, browInnerUp: 0.25, eyeLookUpLeft: 0.2, eyeLookUpRight: 0.2, mouthSmileLeft: 0.05, mouthSmileRight: 0.05 },
      surprise:{ browInnerUp: 0.7, browOuterUpLeft: 0.6, browOuterUpRight: 0.6, eyeWideLeft: 0.5, eyeWideRight: 0.5, jawOpen: 0.15 },
      sad:     { mouthFrownLeft: 0.4, mouthFrownRight: 0.4, browInnerUp: 0.5, browDownLeft: 0.1, browDownRight: 0.1 },
    };
    const all = new Set(Object.values(M).flatMap(o => Object.keys(o)));
    for (const k of all) this.setTarget(k, 0);
    for (const [k, v] of Object.entries(M[mood] || M.neutral)) this.setTarget(k, v);
  }

  // ---- speech / lipsync ----
  // Word timing comes from Web Speech API boundary events: speakWord(word, estDurMs)
  speakWord(word, durMs) {
    const letters = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!letters.length) return;
    const tokens = [];
    for (let i = 0; i < letters.length; i++) {
      const two = letters.slice(i, i + 2);
      if (DIGRAPH[two]) { tokens.push(DIGRAPH[two]); i++; continue; }
      if (letters[i] === 'e' && i === letters.length - 1 && letters.length > 2) continue; // silent trailing e
      tokens.push(EN_VISEME[letters[i]] || 'sil');
    }
    const now = performance.now();
    // vowels are held longer
    const weights = tokens.map(v => VOWELS.has(v) ? 1.6 : 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = now;
    tokens.forEach((v, i) => {
      const d = (durMs * weights[i]) / total;
      this.visemeQueue.push({ time: t, viseme: v, dur: d });
      t += d;
    });
  }

  startSpeaking() {
    this.speaking = true;
    this.visemeQueue = [];
    this.onStatus('SPEAKING');
    this.triggerGesture(['explain', 'point', 'explain', 'self'][Math.floor(Math.random() * 4)]);
  }
  stopSpeaking() {
    this.speaking = false;
    this.visemeQueue = [];
    this.currentViseme = 'sil';
    this.onStatus('IDLE');
    this.triggerGesture('rest');
  }
  setThinking(on) {
    if (on) { this.setMood('think'); this.triggerGesture('think'); this.onStatus('THINKING'); }
    else { this.setMood('neutral'); }
  }
  setListening(on) {
    if (on) { this.setMood('surprise'); setTimeout(() => this.setMood('neutral'), 600); this.onStatus('LISTENING'); }
  }
  triggerGesture(name) { this.gesture = GESTURES[name] ? name : 'rest'; }

  updateLipsync(dt) {
    const now = performance.now();
    // drop expired entries
    while (this.visemeQueue.length && this.visemeQueue[0].time + this.visemeQueue[0].dur < now) this.visemeQueue.shift();
    let v = 'sil';
    if (this.visemeQueue.length && this.visemeQueue[0].time <= now) v = this.visemeQueue[0].viseme;
    else if (this.speaking && !this.visemeQueue.length) {
      // no timing available (browser gives no boundary events) -> generic mouth motion
      v = Math.sin(this.t * 14) > 0.2 ? 'aa' : (Math.sin(this.t * 9) > 0 ? 'E' : 'sil');
    }
    this.currentViseme = v;
    for (const vis of ALL_VISEMES) {
      const on = vis === v && vis !== 'sil';
      this.setTarget('viseme_' + vis, on ? (VOWELS.has(vis) ? 0.85 : 0.7) : 0);
    }
    // jaw: viseme baseline, boosted by the real audio loudness when a neural voice is playing
    const lvl = this.speaking && this.audioLevel ? this.audioLevel() : 0;
    this.setTarget('jawOpen', clamp((v !== 'sil' && VOWELS.has(v) ? 0.22 : 0.03) + lvl * 0.35, 0, 0.6));
  }

  // ---- main loop ----
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    if (!this.model) { this.renderer.render(this.scene, this.camera); return; }

    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blinkT = 0.16; this.nextBlink = rnd(2.2, 5.5); }
    if (this.blinkT > 0) { this.blinkT -= dt; }
    const blink = this.blinkT > 0 ? Math.sin((0.16 - this.blinkT) / 0.16 * Math.PI) : 0;
    this.setTarget('eyeBlinkLeft', blink); this.setTarget('eyeBlinkRight', blink);

    // eye saccades
    this.nextSaccade -= dt;
    if (this.nextSaccade <= 0) { this.eyeGoal = { x: rnd(-0.15, 0.15), y: rnd(-0.08, 0.08) }; this.nextSaccade = rnd(0.6, 2.5); }
    this.eyeOffset.x = lerp(this.eyeOffset.x, this.eyeGoal.x, 1 - Math.exp(-dt * 20));
    this.eyeOffset.y = lerp(this.eyeOffset.y, this.eyeGoal.y, 1 - Math.exp(-dt * 20));

    // head: cursor tracking + breathing + nodding while speaking
    const nodX = this.speaking ? Math.sin(this.t * 3.1) * 0.05 + Math.sin(this.t * 7.3) * 0.02 : Math.sin(this.t * 0.9) * 0.012;
    const nodY = this.speaking ? Math.sin(this.t * 2.2) * 0.06 : Math.sin(this.t * 0.6) * 0.02;
    const hx = -this.mouse.y * 0.28 + nodX;
    const hy = this.mouse.x * 0.45 + nodY;
    const hz = -this.mouse.x * 0.06 + (this.speaking ? Math.sin(this.t * 1.7) * 0.03 : 0);
    const k = 1 - Math.exp(-dt * 6);
    this.headPose.x = lerp(this.headPose.x, hx, k);
    this.headPose.y = lerp(this.headPose.y, hy, k);
    this.headPose.z = lerp(this.headPose.z, hz, k);
    const { Head, Neck, Spine2, Spine1, LeftEye, RightEye } = this.bones;
    if (Head) Head.rotation.set(this.headPose.x * 0.7, this.headPose.y * 0.7, this.headPose.z);
    if (Neck) Neck.rotation.set(this.headPose.x * 0.3, this.headPose.y * 0.3, 0);
    if (Spine2) Spine2.rotation.set(Math.sin(this.t * 1.3) * 0.012, this.headPose.y * 0.1, 0);
    if (Spine1) Spine1.rotation.set(Math.sin(this.t * 1.3) * 0.01, 0, 0);

    // eyes: toward cursor + saccade
    const ex = clamp(-this.mouse.y * 0.25 + this.eyeOffset.y, -0.35, 0.35);
    const ey = clamp(this.mouse.x * 0.35 + this.eyeOffset.x, -0.45, 0.45);
    if (LeftEye) LeftEye.rotation.set(ex, ey, 0);
    if (RightEye) RightEye.rotation.set(ex, ey, 0);

    // gestures
    this.nextGesture -= dt;
    if (this.speaking && this.nextGesture <= 0) {
      this.triggerGesture(['explain', 'point', 'rest', 'explain', 'self'][Math.floor(Math.random() * 5)]);
      this.nextGesture = rnd(1.8, 3.5);
    }
    const G = GESTURES[this.gesture];
    const gk = 1 - Math.exp(-dt * 5);
    for (const b in this.gestureLerp) {
      const tgt = G[b] || [0, 0, 0];
      const cur = this.gestureLerp[b];
      for (let i = 0; i < 3; i++) cur[i] = lerp(cur[i], tgt[i], gk);
      const bone = this.bones[b];
      if (bone) {
        let wave = 0;
        if (this.gesture === 'wave' && b === 'RightForeArm') wave = Math.sin(this.t * 9) * 0.35;
        if (this.gesture === 'explain' && (b === 'RightForeArm' || b === 'LeftForeArm')) wave = Math.sin(this.t * 4 + (b[0] === 'L' ? 1.5 : 0)) * 0.12;
        bone.rotation.set(cur[0], cur[1] + wave, cur[2]);
      }
    }

    this.updateLipsync(dt);
    this.applyMorphs(dt);

    this.camera.lookAt(this.lookTarget);
    this.renderer.render(this.scene, this.camera);
  }
}
