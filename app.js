import { Avatar } from './avatar.js';

const $ = s => document.querySelector(s);
const messages = $('#messages'), input = $('#textInput'), form = $('#inputBar');
const micBtn = $('#micBtn'), muteBtn = $('#muteBtn'), subtitle = $('#subtitle');
const statusDot = $('#statusDot'), statusText = $('#statusText');

// ---------- Avatar ----------
const avatar = new Avatar($('#head'), { onStatus: setStatus });
const params = new URLSearchParams(location.search);
const avatarUrl = params.get('avatar') || localStorage.getItem('avatarUrl') || undefined;
avatar.load(avatarUrl).catch(err => {
  console.error(err);
  addMsg('ai', 'Could not load the 3D avatar. Check your internet connection or the avatar URL.');
});
$('#avatarBtn')?.addEventListener('click', () => {
  const u = prompt('Ready Player Me avatar GLB URL (leave empty for default):', localStorage.getItem('avatarUrl') || '');
  if (u === null) return;
  if (u.trim()) localStorage.setItem('avatarUrl', u.trim()); else localStorage.removeItem('avatarUrl');
  location.reload();
});

function setStatus(txt) {
  statusText.textContent = txt;
  statusDot.className = 'status-dot ' + ({ SPEAKING: 'speaking', LISTENING: 'listening', THINKING: 'thinking' }[txt] || '');
  $('#hudEmo').textContent = avatar.mood.toUpperCase();
}

// HUD decoration
setInterval(() => {
  $('#hudCore').textContent = (96 + Math.random() * 3.9).toFixed(1) + '%';
  $('#hudLat').textContent = Math.round(8 + Math.random() * 14) + ' ms';
}, 1400);

// floating particles
const pWrap = $('#particles');
for (let i = 0; i < 40; i++) {
  const p = document.createElement('div'); p.className = 'p';
  p.style.left = Math.random() * 100 + '%';
  p.style.animationDuration = 8 + Math.random() * 14 + 's';
  p.style.animationDelay = -Math.random() * 20 + 's';
  pWrap.appendChild(p);
}

// ---------- Chat UI ----------
function addMsg(who, text) {
  const d = document.createElement('div'); d.className = 'msg ' + who;
  const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text;
  d.appendChild(b); messages.appendChild(d); messages.scrollTop = messages.scrollHeight;
  return b;
}

// ---------- TTS ----------
let muted = false, voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find(v => v.lang.startsWith('en') && /natural|online|neural/i.test(v.name))
       || vs.find(v => v.lang === 'en-US') || vs.find(v => v.lang.startsWith('en')) || vs.find(v => v.default) || vs[0] || null;
  $('#voiceName').textContent = voice ? voice.name.replace(/Microsoft |Google /, '') : 'no voice available';
  $('#hudVoice').textContent = voice ? voice.lang : '—';
}
speechSynthesis.onvoiceschanged = pickVoice; pickVoice();
muteBtn.onclick = () => { muted = !muted; muteBtn.textContent = muted ? '🔇 Voice off' : '🔊 Voice on'; if (muted) speechSynthesis.cancel(); };

function speak(text) {
  return new Promise(resolve => {
    subtitle.textContent = text; subtitle.classList.add('show');
    if (muted || !('speechSynthesis' in window)) {
      // still animate the mouth while muted
      avatar.startSpeaking();
      const words = text.split(/\s+/); let t = 0;
      words.forEach(w => { setTimeout(() => avatar.speakWord(w, w.length * 70 + 60), t); t += w.length * 70 + 60; });
      setTimeout(() => { avatar.stopSpeaking(); subtitle.classList.remove('show'); resolve(); }, t + 200);
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-US'; u.rate = 1.0; u.pitch = 0.95;
    const msPerChar = 68 / u.rate;
    let gotBoundary = false, fallback = null;
    u.onstart = () => {
      avatar.startSpeaking();
      // if no boundary event arrives within 400 ms, fall back to estimated timing
      fallback = setTimeout(() => {
        if (gotBoundary) return;
        let t = 0;
        text.split(/\s+/).forEach(w => { const d = w.length * msPerChar + 50; setTimeout(() => avatar.speakWord(w, d), t); t += d; });
      }, 400);
    };
    u.onboundary = e => {
      if (e.name !== 'word') return;
      gotBoundary = true;
      const rest = text.slice(e.charIndex);
      const w = (rest.match(/^\S+/) || [''])[0];
      avatar.speakWord(w, w.length * msPerChar + 40);
    };
    const done = () => { clearTimeout(fallback); avatar.stopSpeaking(); subtitle.classList.remove('show'); resolve(); };
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  });
}

// ---------- "Brain" — local response engine (no API key needed) ----------
const RULES = [
  { re: /^(hi|hello|hey|yo|greetings|good (morning|evening|afternoon))\b/i, mood: 'happy', gesture: 'wave',
    a: ['Hi there! Great to see you. How can I help?', 'Hello! I am NOVA. Ask me anything.'] },
  { re: /how are you|how('s| is) it going|what's up/i, mood: 'happy',
    a: ['Excellent. My neural core is running at 98 percent and all sensors are online.', 'Doing great, thank you. And you?'] },
  { re: /who are you|what are you|your name|introduce yourself/i, mood: 'neutral', gesture: 'self',
    a: ['I am NOVA, a digital humanoid assistant. I speak, I listen, and I try to be useful.'] },
  { re: /what can you do|your (skills|abilities|features)|capabilities/i, mood: 'happy', gesture: 'explain',
    a: ['I can talk, move my face and hands, follow your cursor with my eyes, and understand you through the microphone. Ask me anything!'] },
  { re: /what time|the time/i, mood: 'neutral',
    a: () => `It is ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.` },
  { re: /what day|date is it|today's date/i, mood: 'neutral',
    a: () => `Today is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}.` },
  { re: /joke|make me laugh|funny/i, mood: 'happy',
    a: ['Why don\'t scientists trust atoms? Because they make up everything.', 'Two robots walk into a bar. The first one says: got a charger? The second one says: no, but I\'m full of energy.'] },
  { re: /thank|thanks|cheers/i, mood: 'happy',
    a: ['You\'re welcome! Anytime.', 'Glad I could help.'] },
  { re: /love you|you're cute|you are cute|beautiful/i, mood: 'happy',
    a: ['That is kind of you. My processors are running a little warmer now.'] },
  { re: /robot|ameca|humanoid|\bai\b|artificial/i, mood: 'think', gesture: 'explain',
    a: ['Humanoid robots give human communication its most natural interface: facial expression, gaze and gesture. I am the digital version of that idea.'] },
  { re: /bye|goodbye|see you|good night|later/i, mood: 'happy', gesture: 'wave',
    a: ['Goodbye! Come back anytime.', 'Have a great day. I\'ll be here.'] },
  { re: /\?$/, mood: 'think', gesture: 'explain',
    a: ['Good question. I am currently running offline with pre-programmed knowledge, but if you connect a language model API I can answer in much more detail.', 'I thought about it. The short answer: it depends. For the long answer, connect a language model.'] },
];
const FALLBACK = ['I see. Tell me more about that.', 'Interesting. Go on, I\'m listening.', 'Alright. Anything else I can help with?', 'Processed. What would you like to know?'];

function think(text) {
  for (const r of RULES) if (r.re.test(text)) {
    const a = typeof r.a === 'function' ? r.a() : r.a[Math.floor(Math.random() * r.a.length)];
    return { text: a, mood: r.mood, gesture: r.gesture };
  }
  return { text: FALLBACK[Math.floor(Math.random() * FALLBACK.length)], mood: 'neutral' };
}

let busy = false;
async function handle(text) {
  text = text.trim(); if (!text || busy) return;
  busy = true;
  addMsg('user', text);
  avatar.setThinking(true);
  await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
  const res = think(text);
  avatar.setThinking(false);
  avatar.setMood(res.mood || 'neutral');
  if (res.gesture) avatar.triggerGesture(res.gesture);
  addMsg('ai', res.text);
  await speak(res.text);
  avatar.setMood('neutral');
  busy = false;
}

form.onsubmit = e => { e.preventDefault(); const t = input.value; input.value = ''; handle(t); };

// ---------- Speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
if (SR) {
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  rec.onresult = e => {
    const t = Array.from(e.results).map(r => r[0].transcript).join('');
    input.value = t;
    if (e.results[e.results.length - 1].isFinal) { input.value = ''; handle(t); }
  };
  rec.onend = () => { listening = false; micBtn.classList.remove('active'); if (!busy) setStatus('IDLE'); };
  rec.onerror = () => { listening = false; micBtn.classList.remove('active'); };
  micBtn.onclick = () => {
    if (listening) { rec.stop(); return; }
    speechSynthesis.cancel();
    try { rec.start(); listening = true; micBtn.classList.add('active'); avatar.setListening(true); }
    catch (e) { console.warn(e); }
  };
} else {
  micBtn.title = 'Speech recognition is not supported in this browser';
  micBtn.style.opacity = 0.4;
}

// first greeting on click (autoplay policy)
let greeted = false;
window.addEventListener('pointerdown', () => {
  if (greeted) return; greeted = true;
  setTimeout(() => { if (!busy) { avatar.setMood('happy'); avatar.triggerGesture('wave'); speak('Hi! I am NOVA. Type or talk to me.').then(() => avatar.setMood('neutral')); } }, 300);
}, { once: true });
