// Neural TTS in the browser: Kokoro-82M via kokoro-js (ONNX, WebGPU or WASM).
// Free, no API key. First load downloads ~90 MB (cached by the browser afterwards).
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export class NeuralVoice {
  constructor({ onProgress } = {}) {
    this.onProgress = onProgress || (() => {});
    this.tts = null;
    this.voice = 'af_heart';       // warm female voice (alternatives: af_bella, af_nicole, bf_emma)
    this.ctx = null;
    this.analyser = null;
    this.ready = false;
    this.failed = false;
    this.current = null;           // { sources: [], cancelled }
  }

  async init() {
    try {
      this.onProgress('Loading neural voice…', 0);
      const { KokoroTTS } = await import(KOKORO_CDN);
      const webgpu = !!navigator.gpu;
      const files = {};
      this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: webgpu ? 'fp32' : 'q8',
        device: webgpu ? 'webgpu' : 'wasm',
        progress_callback: p => {
          if (p.status === 'progress') {
            files[p.file] = p.progress || 0;
            const vals = Object.values(files);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            this.onProgress(`Loading neural voice… ${Math.round(avg)}%`, avg);
          }
        },
      });
      this.ready = true;
      this.onProgress('Kokoro · ' + this.voice + (webgpu ? ' · WebGPU' : ' · WASM'), 100);
    } catch (e) {
      console.warn('Neural voice unavailable, falling back to Web Speech:', e);
      this.failed = true;
      this.onProgress('', 0);
    }
    return this.ready;
  }

  ensureAudio() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
      this.levelBuf = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 0..1 loudness of what is playing right now
  level() {
    if (!this.analyser || !this.current) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) { const v = (this.levelBuf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  cancel() {
    if (this.current) {
      this.current.cancelled = true;
      for (const s of this.current.sources) { try { s.stop(); } catch {} }
      this.current = null;
    }
  }

  // Splits into sentences, generates each while the previous one plays.
  // onWord(word, durMs) is called as each word starts so the avatar can lip-sync.
  async speak(text, { onStart, onWord, onEnd } = {}) {
    if (!this.ready) throw new Error('neural voice not ready');
    this.cancel();
    this.ensureAudio();
    const job = { sources: [], cancelled: false };
    this.current = job;

    const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    let started = false;
    let nextStart = this.ctx.currentTime;
    const timers = [];

    // generate sentence i (returns AudioBuffer)
    const gen = async s => {
      const out = await this.tts.generate(s.trim(), { voice: this.voice, speed: 1.0 });
      const buf = this.ctx.createBuffer(1, out.audio.length, out.sampling_rate);
      buf.copyToChannel(out.audio, 0);
      return buf;
    };

    let pending = gen(sentences[0]);
    for (let i = 0; i < sentences.length; i++) {
      const buf = await pending;
      if (job.cancelled) return;
      if (i + 1 < sentences.length) pending = gen(sentences[i + 1]);

      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.connect(this.analyser);
      const startAt = Math.max(nextStart, this.ctx.currentTime + 0.02);
      src.start(startAt);
      job.sources.push(src);
      nextStart = startAt + buf.duration;

      if (!started) { started = true; onStart?.(); }

      // proportional word timing across the sentence's real audio duration
      const words = sentences[i].trim().split(/\s+/).filter(Boolean);
      const chars = words.reduce((a, w) => a + w.length + 1, 0);
      const durMs = buf.duration * 1000;
      let offset = (startAt - this.ctx.currentTime) * 1000;
      for (const w of words) {
        const d = ((w.length + 1) / chars) * durMs;
        timers.push(setTimeout(() => { if (!job.cancelled) onWord?.(w, d); }, offset));
        offset += d;
      }
    }
    // wait for the last source to finish
    await new Promise(res => {
      const ms = Math.max(0, (nextStart - this.ctx.currentTime) * 1000);
      timers.push(setTimeout(res, ms + 60));
    });
    if (this.current === job) this.current = null;
    if (!job.cancelled) onEnd?.();
  }
}
