# Mote

A fully local emotional journaling companion. The only things on screen are a soft, clay-like 3D form (your Mote) and a text box. You write journal entries. Mote never writes back. It reacts only by changing shape, color, movement and stability, based on what a local **decision model** detects in your writing.

> Mote is an expressive simulation, not a being with feelings. It turns typed answers from a local model into visuals.

- **Temperament at birth.** Each Mote gets a random, permanent personality (an archetype plus seeded jitter).
- **Memory and mood.** It remembers recent history, warms up slowly, holds grudges, and drifts back to its baseline over time, even while the app is closed.
- **Journaling.** Every entry is saved with the model's answers and a snapshot of how Mote looked. The journal shows a timeline with thumbnails, a weekly mood strip, and filters.

Everything runs on your machine. Entries live in one SQLite file. The only network connection the app makes is to your local Ollama server.

---

## Quick start

Requirements: **Node.js 22.12+** and, for real models, **Ollama 0.35+** (Laya needs 0.40.0+, and the current Ollama packages of laya, tev1 and nimble declare 0.40.4+).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

Open <http://127.0.0.1:5173>. The API server runs on port 5174 (Vite proxies `/api` to it).

### Without any model (mock provider)

```bash
DECISION_PROVIDER=mock npm run dev
```

The mock provider returns plausible random answers in the exact `/v1/systemone` response format (keyword cues bias the randomness, so a happy entry usually reads as happy). The whole app works end to end with no model installed.

### Production build

```bash
npm run build
```

```bash
npm start
```

Then open <http://127.0.0.1:5174>. The built client (Three.js, fonts, everything) is served from `dist/client`; nothing loads from a CDN.

---

## Installing and updating Ollama

1. Download Ollama from <https://ollama.com/download> (macOS, Windows, Linux). On Linux you can also use the official install script from that page.
2. Check the version: `ollama --version`. Mote needs **0.35 or newer**, and some models need more (see the catalog). To update, download and install the latest version again.
3. Make sure Ollama is running (the desktop app, or `ollama serve`).

Mote checks all of this at startup and in the background, and tells you what to do:

| Situation | What you see |
| --- | --- |
| Ollama not running | Mote goes dim and still: "Start Ollama to wake me up" |
| Ollama too old (version check, or `/v1/systemone` returns 404) | "Please update Ollama…" with the required version |
| Model not pulled | The exact `ollama pull <model>` command |
| Cloud model (e.g. `clef:cloud`) | Refused: "Mote only uses models that run on your computer" |
| Not a decision model (e.g. a chat model) | Refused, with a pointer to settings |
| `OLLAMA_URL` not local | Refused (ollama.com and other non-local hosts are never used) |

Entries written while the model is unavailable are still saved to the journal.

## Pulling a model for each preset

| Preset | Hardware | Model |
| --- | --- | --- |
| **Lite** | Old laptops, CPU only | `ollama pull laya` (English) or `ollama pull laya:322m-multilingual-bf16` (other languages) |
| **Balanced** (default) | 16 GB RAM | `ollama pull tev1` |
| **Best** | 32 GB+ RAM or a good GPU | `ollama pull nimble` |

You can use any model from the catalog below, or type any model name in settings.

### Model catalog

The catalog lives in [`server/decision/models.json`](server/decision/models.json) (one profile per model: publisher, size, input types, languages, minimum Ollama version, `maxStateTokens`, license, tier). It was checked against each model's page on ollama.com/library in November 2026. Where a page states no minimum version, the `/v1/systemone` API minimum (0.35.0) is used. At runtime Mote also enforces the `requires` version that Ollama reports for the installed package.

| Model | Publisher | Size | Input | Languages | Min Ollama | License |
| --- | --- | --- | --- | --- | --- | --- |
| `laya` | Convai Innovations | 421M, ~845 MB | Text | English only | 0.40.0 | Apache 2.0 |
| `laya:322m-multilingual-bf16` | Convai Innovations | 322M, ~658 MB | Text | 100+ languages | 0.40.0 | Apache 2.0 (laya page) |
| `tev1:0.8b` | Together AI | 0.8B, ~834 MB | Text | English (others untested) | 0.35 | Experimental; weights license being finalized |
| `tev1` | Together AI | 4B, ~4.5 GB | Text | English (others untested) | 0.35 | Experimental; weights license being finalized |
| `nimble` | Bespoke Labs | 9B, ~9.5 GB | Text | Not stated | 0.35 (API min) | Apache 2.0 |
| `nimble-v3` | Bespoke Labs | 9B, 5.6–17.9 GB | Text | Not stated | 0.40.4 | CC BY-NC 4.0 (noncommercial) |
| `d3:2b` / `d3` / `d3:9b` / `d3:27b` | vLLM Semantic Router | 3.1 / 5.6 / 10 / 29 GB | Text, image | Not stated | 0.40.9 | Apache 2.0 |
| `d1` | Liquid AI | 3B, ~3.7 GB | Text, image | 16 languages | 0.35 (API min) | LFM Open License v1.0 |
| `d1-omni` | Liquid AI | 600M / 2B | Text, image, audio | Not stated (speech: English) | 0.35 (API min) | LFM Open License v1.0 |
| `pplx-decider-flash` | Perplexity | 4B, ~5.6 GB | Text, image | Not stated | 0.35 (API min) | Apache 2.0 |
| `kev` | Jared Palmer | 0.8B–27B (default 9B) | Text | English-focused | 0.40.4 | Apache 2.0 |
| `clef-flash` | Cloudflare | 9B, ~11 GB | Text, image | Not stated | 0.35.1 | Apache 2.0 |
| `clef` | Cloudflare | 27B, ~18 GB | Text, image | Not stated | 0.35.1 | Apache 2.0 (local only; cloud tags refused) |

Context limits that shape the state budget: Laya scores each question within **512 tokens** (state + instructions + options); Tev1 runs with about **2,000 tokens**; Nimble's prompt must fit **8,192 tokens**; d3 packages use **4,096 tokens**.

## Switching models

- **Live, in the app:** open **Settings**. It lists the installed models, marks known decision models with their tier, size and languages, flags cloud models, and offers the presets. Press **Use**: the switch happens immediately, with no restart. The choice is saved in the local database.
- **At startup:** set `DECISION_MODEL` in `.env` (used until you pick another model in settings).

If you write in a language other than English while an English-only model (Laya) is selected, Mote doesn't send that entry to the model (it still saves it) and shows a one-time hint suggesting the multilingual model.

### Tested models

Tested with Ollama 0.40.14 on a 4-core CPU with 15 GB RAM and no GPU, using Mote's real questions and state (times are per journal entry, all nine questions in one request):

| Model | Time per entry | Notes |
| --- | --- | --- |
| `laya` | ~4 s | Good on clear emotions with its minimal state (joy 99%, anger 100%, sadness 92%, fear 100%); crisis entries 0.78 to 0.89, but one anxious entry also scored 0.68. Noisier on trust and tone. Gets no history, so it rarely pulses. |
| `laya:322m-multilingual-bf16` | ~2 s | Works, but often answers `none` for the writer's emotion. |
| `tev1:0.8b` | ~5 s | Good emotions once the mood is sent as numbers (worded moods leaked into its answers); weaker on trust; one crisis entry scored only 0.40. |
| `tev1` | ~22 s | Strong across the board; crisis entries 0.99, other entries 0.06 or lower; `surprising` 0.01 for entries that fit, 0.98 for sharp changes. |
| `nimble` | ~50 s on CPU (~100 s for the first, while loading) | Strong: emotions 96 to 99%, hostile 100%, kind 98%; crisis entries 0.99, other entries 0.02 or lower. Needs about 10 GB free RAM: with other models still loaded, Ollama's runner was killed for lack of memory (Mote then says so and suggests a smaller model). |

Only one model needs to be loaded at a time. If memory is tight, lower `OLLAMA_KEEP_ALIVE` so a model you switched away from is unloaded sooner.

## Configuration (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DECISION_PROVIDER` | `ollama` | `ollama` or `mock` (or any provider file you add) |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama server. Only this computer / LAN addresses are accepted |
| `DECISION_MODEL` | `tev1` | Default model (Balanced preset) |
| `OLLAMA_KEEP_ALIVE` | `30m` | Sent as `keep_alive`, so the model stays loaded between entries |
| `DECISION_TIMEOUT_MS` | `300000` | How long to wait for one answer (big models on CPU are slow) |
| `MOTE_HOST` / `MOTE_PORT` | `127.0.0.1` / `5174` | Mote's own server (binds to this machine only) |
| `MOTE_DB_PATH` | `data/mote.sqlite` | The journal database |
| `MOTE_DEBUG` | `true` outside production | Debug panel and debug endpoints |

---

## How it works

```
entry ─► state builder ─► DecisionModel.ask(state, questions) ─► parse ─► mood engine ─► visual mapping ─► shader
           (fits the        (one request, 9 typed questions,      (validate,   (deterministic:   (shared code;
            token budget)    Jev / Ollama /v1/systemone format)    signals)     trust, grudges,   eased 1–3 s
                                                                                decay)            on the GPU)
```

### Decision-model layer

The app talks to one interface, `DecisionProvider` (`server/decision/types.ts`), which uses the Jev / Ollama `/v1/systemone` wire format directly: a `state` (string or JSON) and 1 to 64 named `questions` of type `choice`, `noul` or `score`. Answers come back with `probabilities` and `confidence`. `confidence` measures how concentrated the probabilities are, not the chance of being right; Mote uses it for visual stability, never for trusting an answer.

Every entry asks, in a single request: `user_emotion`, `user_valence`, `user_intensity`, `life_area`, `tone_toward_blob`, `blob_reaction`, `trust_change`, `surprising` and `distress_flag` (see `server/decision/questions.ts`). Choice questions where nothing may fit have a `none` / `other` option. Arithmetic, dates and counting stay in code.

Yes/no questions can be asked either as `noul` or as a two-option `choice` with neutral keys (`a` / `b`), per question, in [`server/decision/questionConfig.json`](server/decision/questionConfig.json). Both default to `choice`: in testing, nimble answered the `noul` form of `surprising` with about 0.9 for every entry, while the choice form separated ordinary entries from sharp changes on tev1, tev1:0.8b and nimble.

### The state and its budget

The state is a JSON object: `new_message`, `current_mood` (words plus numbers), `temperament` (words), `grudges` and `recent_messages` (with relative times). The builder estimates tokens and fits the state to the model's `maxStateTokens`: it drops the oldest messages first, then shortens long old messages, then drops the remaining history. `new_message` is never cut, and it is the first key, so models that truncate long states only ever lose history.

Models can also restrict which fields they get (`stateFields`, `moodStyle` in the catalog). **Laya** gets only `new_message` and a numbers-only mood. In testing, Laya mixed every word in the state into every answer (with a worded mood or the temperament present, a sad entry read as "calm" or "curious", and crisis detection dropped from about 0.8 to 0.2). **tev1:0.8b** gets the full state but a numbers-only mood: with "very happy" in `current_mood`, a sad entry read as 5% sadness (98% with numbers only); its temperament, grudges and history didn't leak. tev1 (4B) and nimble were unaffected. The mood engine applies temperament, grudges and history in code, so small-context models still work.

### Mood engine

`server/mood/engine.ts`, with every constant in [`server/mood/tuning.ts`](server/mood/tuning.ts). The model detects; deterministic code decides:

- `blob_reaction` is blended into the mood, scaled by volatility and intensity.
- Trust moves with `trust_change` (blended with `tone_toward_blob`, which small models answered more reliably), scaled by trust speed and capped per day. A slow-trusting blob needs about a week of consistently kind days to go from low to high trust.
- Hostile or dismissive entries create grudges. They decay according to grudge memory, kindness helps forgive, and while they're active positive reactions are dampened and the resting mood is pulled down.
- The mood decays toward the baseline with time, including while the app is closed. On return, Mote plays a short waking-up transition.
- `surprising` above 0.6 triggers a one-off pulse.

### Visual mapping

`shared/visuals.ts` maps mood to shader parameters, and the client eases each one over 1 to 3 seconds:

| Signal | Look |
| --- | --- |
| Valence | Color temperature (warm / cold) mixed over the temperament's base color |
| Arousal, intensity | Speed and amplitude of movement |
| Anger | Sharp spikes |
| Sadness | Droops, sinks, slows down |
| Fear | Shrinks, trembles, pulls away from the cursor |
| Curiosity | Leans toward the cursor |
| Joy | Rounder, bouncier, brighter |
| Calm | Slow, smooth breathing |
| Disgust | Pulls inward, greyed |
| Trust | Size and how close it floats |
| One clear emotion (high confidence) | Solid and stable |
| Two close emotions | Two color zones plus wobble |
| Flat distribution (low confidence) | Hazy, semi-transparent, misty |

While the model is thinking, a listening shimmer runs and the UI stays responsive.

### Body language and sounds

On top of the mood-driven look, Mote reacts with short gestures (`client/src/blob/gestures.ts`) and a sound in its own voice (`client/src/audio/`). Both follow the strongest feeling in its reaction to an entry. A mixed reaction voices both emotions, and an unclear one sounds muffled, wavery and farther away.

| Reaction | Gesture | Sound |
| --- | --- | --- |
| Joy | Crouches, hops twice, jiggles | Bright rising arpeggio with a sparkle |
| Sadness | Sighs, deflates and slumps | A breath, then a slow falling "aww" |
| Anger | Puffs up, flares spikes, shudders | A huff and a low, rough growl |
| Fear | Flinches back, shrinks, trembles | A gasp and a high, trembling whimper |
| Calm | One slow, deep breath | A soft hum on an open fifth |
| Curiosity | Tilts and leans in | A questioning "hm?" |
| Disgust | Recoils and turns away | A nasal "bleh" |
| Surprising entry | A jolt, a flash and a wave from the top | A bubbly "bloop" |
| Distress safeguard | Slow, soft breathing only | A quiet, warm chord (never alarming) |

More moments:
- A sent entry flows from the text box into Mote as light, and it gulps it in.
- While you type, it turns toward the text box, with tiny ripples.
- Click or tap Mote to poke it: the surface dents, ripples and springs back with a "boing".
- At birth, the mist swirls together, then pops into shape with a first chirp.
- After time away, it wakes with a stretch and a yawn.
- When idle, it slowly looks around; when curious, it follows the cursor.

**Unique voices.** Each Mote's voice comes from its temperament and seed: pitch register by archetype, timbre (FM ratio and depth), vibrato, breathiness and tempo. Its current mood shifts that voice:
- Valence raises or lowers the pitch.
- Arousal sets the pace.
- Clarity sets the brightness.
- Trust sets the warmth and level.

**How the sound works.** All sound is synthesized live with the Web Audio API, so there are no audio files and nothing is downloaded. It starts after your first click or key press (a browser rule).

**Sound settings.** Toggle sound in the top bar. Set the volume in Settings; it's remembered in this browser only. With the system's "reduce motion" setting on, gestures are smaller and the shakes and trembles stop.

### Journal

Each entry stores the text, timestamp, the full model answers (with provider and model), the derived signals, and a snapshot of the visual parameters. The journal view shows a timeline with a thumbnail of each snapshot (rendered with the same shader), a weekly mood strip (one blob per day from your average feelings that day), and filters by life area and emotion.

### Wellbeing safeguard

If `distress_flag` comes back with reasonable probability (threshold in `tuning.ts`), Mote turns soft and calm, and a small, dismissible card shows helpline information as plain text (works offline). Defaults: 988 in the US, findahelpline.com internationally. Edit [`server/wellbeing.json`](server/wellbeing.json) for your region. The model can be wrong; this is a gentle nudge, not a diagnosis, and it never blocks you.

---

## Debug tools

With `MOTE_DEBUG=true`, a **Debug** button appears (or open the app with `?debug`):

- Sliders for every visual parameter, to tune the mapping without any model.
- **Fast-forward time** (+1 h to +7 days): mood decay, trust and grudges run on a shifted clock, so you can simulate days of journaling.
- **Rebirth** with an optional seed: compare two blobs (the seed is shown in Settings).
- A live readout of the mood engine (emotions, trust, grudges).
- **Reaction previews**: play any gesture and sound (each emotion, mixed, unsure, surprise, entry arriving, soothe, puzzled, wake, birth) without a model and without changing the mood.

## Adding a new provider

Any server that speaks `/v1/systemone` (for example llama.cpp's server, Ollaya or Jev's own API) can be added with **one file** in `server/decision/providers/` plus `DECISION_PROVIDER=<id>`. Files there are discovered automatically.

```ts
// server/decision/providers/myserver.ts
import { askSystemOne } from '../systemoneHttp';
import type { DecisionProvider, ProviderContext, ProviderFactory, Questions, SystemOneState } from '../types';

const BASE_URL = 'http://localhost:8080'; // any local server that speaks /v1/systemone

class MyServer implements DecisionProvider {
  readonly providerId = 'myserver';
  constructor(private ctx: ProviderContext, public model: string) {}

  profile() {
    return this.ctx.catalog.profileFor(this.model);
  }
  async status() {
    return { state: 'ready' as const, provider: this.providerId, model: this.model, message: 'Ready', checkedAt: Date.now() };
  }
  async setModel(model: string) {
    this.model = model;
    return this.status();
  }
  async listModels() {
    return [];
  }
  ask(state: SystemOneState, questions: Questions) {
    return askSystemOne(BASE_URL, { model: this.model, state, questions }, questions, { timeoutMs: this.ctx.config.decisionTimeoutMs });
  }
}

const factory: ProviderFactory = { id: 'myserver', create: (ctx, model) => new MyServer(ctx, model) };
export default factory;
```

`askSystemOne` checks the request limits (1 to 64 questions, 2 to 26 options, 64 KiB), maps HTTP errors, and validates the answers. See `providers/ollama.ts` for a full example with health checks.

## Privacy and offline use

- No cloud APIs, analytics, telemetry or CDN assets. Three.js and the Nunito font are installed from npm and bundled, and all sounds are synthesized in the browser (no audio files).
- The server binds to `127.0.0.1` and only calls `OLLAMA_URL`, which must be local. Cloud models are refused by tag (`:cloud`, `-cloud`) and by the remote host Ollama reports for them.
- After `npm install` (and pulling a model), the app works with the network disconnected.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

Unit tests cover the mood engine (decay, trust, grudges, reactions, temperament), the state builder (budget trimming, field selection), response parsing, the Ollama provider's checks against a fake local server, the mock provider, the catalog, the gesture curves (they start and end at rest with no jumps) and the voices (fixed per seed, different between blobs).

## Project layout

```
client/            Vite + TypeScript + Three.js front end
  src/blob/        shader, live blob view, gestures, thumbnails
  src/audio/       synthesized sounds and per-blob voices
  src/ui/          journal, settings, debug panel
server/            Hono + better-sqlite3 back end
  decision/        DecisionProvider interface, questions, parsing, state builder, catalog
    providers/     ollama.ts, mock.ts (add one file per provider)
  mood/            temperament, mood engine, tuning constants
shared/            types and the visual mapping used by both sides
tests/             vitest unit tests
```
