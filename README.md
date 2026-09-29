# NOVA — Humanoid AI

A browser-only "digital humanoid" page: an Ameca-style 3D avatar in the centre that talks,
moves its mouth in sync with speech, blinks, follows your cursor with its eyes and head,
changes facial expression and gestures with its arms while it answers you.

No build step, no backend, no API keys.

## Run

Serve the folder with any static server (ES modules need `http://`, not `file://`):

```bash
npx serve .
```

Then open the printed URL in Chrome or Edge (best Web Speech support).

## How it works

- **Avatar** — a [Ready Player Me](https://readyplayer.me) GLB with ARKit blendshapes and
  Oculus visemes, loaded with Three.js. Skin/outfit materials are restyled into a grey,
  satin "robot skin" and dark metal body.
- **Lip-sync** — Web Speech API `SpeechSynthesis` word-boundary events drive a letter→viseme
  mapping (`avatar.js`), so the mouth shapes match the spoken text.
- **Life** — procedural blinking, eye saccades, cursor tracking (eyes + head + neck),
  breathing, nodding while speaking, mood blendshapes (neutral / happy / think / surprise / sad).
- **Gestures** — arm poses (point, explain, wave, think, self) interpolated on the
  Mixamo-compatible skeleton.
- **Input** — text chat or microphone (`SpeechRecognition`, en-US).
- **Brain** — a small local rule-based responder in `app.js` (`RULES`). Replace `think()`
  with a call to any LLM API to make it actually smart.

## Custom avatar

Create your own avatar at readyplayer.me, then use the **Avatar URL** button or
`?avatar=<glb-url>`. Append `?morphTargets=ARKit,Oculus%20Visemes` to the RPM URL so the
face can animate.
