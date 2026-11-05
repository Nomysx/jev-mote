# Mote

A fully local emotional journaling companion. The only things on screen are a soft, clay-like 3D form (your Mote) and a text box. You write journal entries. Mote never writes back. It reacts only by changing shape, color, movement and stability, based on what a local **decision model** detects in your writing.

> Mote is an expressive simulation, not a being with feelings. It turns typed answers from a local model into visuals, sound, and short thoughts written in advance (the model only chooses among them).

- **Temperament at birth.** Each Mote gets a random, permanent personality (an archetype plus seeded jitter).
- **Memory and mood.** It remembers recent history, warms up slowly, holds grudges, and drifts back to its baseline over time, even while the app is closed.
- **A life of its own.** It has a body clock: it gets tired, sleeps at night, dreams about what you wrote, wakes in the morning and misses you while you're away. It keeps living while the page is closed, and tells you what it did when you come back.
- **It grows.** Its character (warmth, trust, courage, wariness, curiosity, playfulness, dreaminess) is shaped by how you treat it, what it thinks about and what it dreams. The **Growth** view is a living map of that, with a timeline you can play back.
- **It lives on your rhythm (if you let it).** In the desktop app, Mote can notice when you're at the computer (only keyboard-and-mouse idle time and the lock screen, nothing else). It misses you less while you're nearby, and over two weeks it moves its nights toward yours.
- **Journaling.** Every entry is saved with the model's answers and a snapshot of how Mote looked. The journal shows a timeline with thumbnails, a weekly mood strip, and filters, plus Mote's dreams and its inner life.

Everything runs on your machine. Entries live in one SQLite file. Mote only talks to its engine on this computer; the only downloads are the engine and models you choose in setup.

---

## Get Mote for your computer (desktop app)

1. **Download the installer.** Open the repository's **Actions** tab, pick the latest **Desktop app** run, and download from its **Artifacts**: `Mote-Windows` (inside: `Mote-Setup-x.y.z.exe`, or `Mote-Portable-x.y.z.exe` to run without installing), `Mote-macOS` (`.dmg`) or `Mote-Linux` (`.AppImage`). Tagged versions (`v0.2.0`...) are also attached to a GitHub Release.
2. **Install and open it.** The Windows installer needs no admin rights and opens Mote when it's done. The builds aren't code-signed yet, so Windows may say "Windows protected your PC": click **More info**, then **Run anyway**. On macOS, right-click the app and choose **Open** the first time. On Linux, make the AppImage executable and run it.
3. **Let Mote set itself up.** It says hello and walks you through two steps:
   - **Engine.** If you already run Ollama, Mote finds it. If not, press **Set it up for me**: Mote downloads the free, open-source Ollama engine once (1.6 GB on Windows, 190 MB on macOS) into its own folder and runs it privately while Mote runs. Nothing is installed system-wide.
   - **Brain.** Press **Download** on the recommended small model (under 1 GB; Tev1 small for English, Laya multilingual for other languages). Mote switches to it as soon as it's there. Bigger models are under **More models**.

That's all. From then on Mote works offline.

**Tray and widget.** Mote lives in the tray (the notification area on Windows, the menu bar on macOS). Closing the window keeps it living there: it still sleeps, dreams and thinks on its own. From the tray icon or Settings you can show it as a **desktop widget**: a small, transparent, frameless Mote with a text box that floats on your desktop (drag it by the bar that appears on hover; keep it above other windows or not). You can also start Mote when you log in. Windows 11's Widgets board only accepts widgets from Microsoft Store apps, so Mote's widget is a floating desktop widget instead.

**Your data** stays in one folder: `%APPDATA%\mote` on Windows, `~/Library/Application Support/mote` on macOS, `~/.config/mote` on Linux. It holds the journal (`mote.sqlite`), and, if Mote set up its own engine, `engine/` and `models/`. Uninstalling Mote keeps this folder; delete it to remove everything.

**Build the installers yourself:** `npm install`, then `npm run desktop:dist` (builds for the computer you're on; Windows installers need Windows, or the GitHub Actions workflow in `.github/workflows/desktop.yml`). `npm run desktop` runs the desktop app from source.

---

## Quick start (from source)

Requirements: **Node.js 22.13+** and, for real models, **Ollama 0.35+** (Laya needs 0.40.0+, and the current Ollama packages of laya, tev1 and nimble declare 0.40.4+). You don't have to install Ollama yourself: the setup screen can download Mote's own copy.

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
| `MOTE_DEBUG` | `false` | Debug panel and debug endpoints |
| `MOTE_DATA_DIR` | next to the journal | Where Mote keeps its own engine and models, if it sets them up |
| `MOTE_ENGINE_PORT` | `11435` | Port for Mote's own engine (so it never clashes with your Ollama) |

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

Every entry asks, in a single request: `user_emotion`, `user_valence`, `user_intensity`, `life_area`, `tone_toward_blob`, `blob_reaction`, `trust_change`, `surprising`, `distress_flag`, and for Mote's mind `situation` (what kind of moment this is) and `blob_intent` (what it wants to do) (see `server/decision/questions.ts`). Choice questions where nothing may fit have a `none` / `other` option. Arithmetic, dates and counting stay in code.

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

Each entry stores the text, timestamp, the full model answers (with provider and model), the derived signals, what Mote decided to do, and a snapshot of the visual parameters. The journal has three tabs:

- **Entries**: a timeline with a thumbnail of each snapshot (rendered with the same shader), a weekly mood strip (one blob per day from your average feelings that day), and filters by life area and emotion. Entries Mote keeps coming back to are marked as **core memories**.
- **Dreams**: every dream, with what it was about, how it felt and what it did to Mote. Press Watch to replay one.
- **Inner life**: everything Mote did on its own, by day: each thought and what it did next, falling asleep, waking up, dreaming.

### Mote's mind: thoughts, decisions and thinking on its own

Decision models don't write text: they score a fixed set of options. Mote shows that process as its mind.

- **Thoughts are the model's real probabilities.** After an entry, candidate thoughts float up around Mote, each sized by the probability the model gave that kind of moment (one of 20: a win, a loss, an insult, an apology, a hello, worry, self-criticism...). They drift and compete; the strongest settles on top while Mote reacts. When the model is torn, the rivals stay close and blurred, and nothing fully settles.
- **The words are written in advance.** Each kind of moment has a few short lines, many in each archetype's own voice (an anxious Mote thinks "did i do something?" where a stoic one thinks "noted."). The model only picks; the line is chosen by the entry's id, so the journal shows the same thought later.
- **Then it decides what to do.** A small ring of actions appears (come closer, comfort, celebrate, give space, hide, listen, play, rest) and one is chosen and acted out. The final choice weighs the model's suggestion against what fits the moment and Mote's temperament (`shared/decide.ts`). In testing, small models sometimes suggested odd actions, such as "play" after an insult; this keeps decisions sensible, and an anxious Mote hides where a stoic one listens.
- **It thinks on its own.** Every few minutes while you watch (less often with slow models), and every 25 to 40 minutes while nobody does, Mote asks the model what's on its mind: a memory of one of your entries, missing you, getting sleepy, still being hurt, letting go of a hurt, being bored... Then it does something: naps, hums, wanders, sulks, waits by the text box or glows. The state it judges contains its mood, its body (energy, missing you, restlessness), its temperament and character, grudges, the time of day, how long you've been away, what it thought last time (so thoughts follow on from each other), and maybe one past entry chosen in code: recent, strong ones are likelier, core memories can come back from long ago, and entries that raised a distress flag are never resurfaced. What it decides weighs the model's suggestion against the thought, the time of day and its body: a tired Mote naps, a restless one wanders, one that misses you waits by the text box.
- **Thoughts change it, a little.** Each thought nudges the mood by its expected effect over the model's probabilities (a happy memory lifts it, worrying weighs on it, letting go eases grudges). The effects are small and only ever heal grudges, never deepen them: your entries stay what moves Mote most. Thinking it's sleepy late at night can turn a nap into real sleep.
- **Considerate.** Thinking on its own is cancelled (with the model request) the moment you start typing or send an entry. It only runs while your model is already loaded, so it never loads a model by itself, and it never keeps a model in memory longer than `OLLAMA_KEEP_ALIVE` would.
- **Your choice.** In Settings → Mote's mind, turn thoughts off for the original wordless Mote, or turn off its life on its own (it still sleeps and wakes, but doesn't think or dream).

Tested on real models: tev1:0.8b read all eight test moments correctly (win, insult, grief, hello, goodnight, apology, worry, self-criticism; 78 to 100%) and Laya six of eight. Background thoughts made sense on tev1:0.8b too ("still hurt" late at night after an insult, "missing you" after two days away), and on Laya ("still hurt" → sulk after an insult, a happy memory of "I got the job" → glow).

### Mote's life: a body clock, sleep and dreams

Like the mood, Mote's body is simulated in code (`server/life/engine.ts`), and the model is only asked what it thinks and dreams.

- **Energy and sleep.** Energy drains while it's awake (faster when it's stirred up, a little with each entry) and refills while it sleeps. Sleep pressure is low energy plus the time of day, so it falls asleep at night, never within 20 minutes of you doing something, and wakes up with the morning. A nap it decides on can become real sleep. Asleep, it's dim, round and slow-breathing, floats little z's, and doesn't follow the cursor. Write to it and it wakes up (groggy if it was early); poke it three times and it wakes up too.
- **Missing you, without guilt.** It misses you more the longer you're gone and the more it trusts you. That only shapes what it thinks about and how glad it is when you're back: Mote never gets worse because you were away.
- **Dreams.** Sleep runs in 90-minute cycles; in the dreaming (REM) part of a cycle it twitches now and then, and dreams (at most twice a night). Code picks what it dreams about: the day's residue, so the last three days, strong entries more, hard ones (painful, or unkind to it) half as likely again, sometimes two memories mixed, now and then a core memory from long ago, and never an entry that raised a distress flag. The model chooses where the dream goes (8 places), what happens (12 happenings: flying, falling, being chased, being lost, a reunion...), how it feels, and how it ends (peacefully, waking with a start, fading, changing into something new, finding it).
- **Dreams change it.** Sleeping on a hard day helps: a hard dream with a calm ending eases grudges and lifts the mood. A nightmare wakes it up jumpy for a while. A sweet dream leaves it lighter.
- **Watching a dream.** When it has a new dream, "Mote had a dream · watch it" appears above the text box. The page turns into the dream's place (sky, sea, forest, city, home, school, space, the dark); the possible happenings surface like thoughts and one wins (the model's real probabilities); Mote acts it out in the dream's colors while words from your entries drift past; and it ends the way the model chose. If the model was torn between two happenings, the dream shifts from one to the other halfway. Click or press Esc to leave.
- **Its life goes on while the page is closed.** The Mote server has a heartbeat (`server/life/loop.ts`): once a minute its body moves on, and while no page is watching it thinks now and then and dreams in its sleep. When you come back, a "While you were away" card lists what it did (thoughts, sleep, dreams, waking up), and it greets you: overjoyed if it missed you, sulky if it's still hurt, sleepy if it's tired. If the server or the computer was off, the gap is simulated on the next heartbeat (it slept, it woke up), but no thoughts are invented: they only ever come from the model. A night it slept through without the model leaves a dream it may remember later.
- **Memories that matter.** Entries it thinks or dreams about three times become core memories: they can come back in its thoughts and dreams long after the last two weeks.

Tested on light models (Laya and tev1:0.8b, about 2 s per dream): after "My boss yelled at me…" Laya dreamed of being chased in the dark (68%, with "shrinking" 32%, so the dream shifts), sad, ending peacefully (it slept on a hard day); a worry about a sick parent became being held, sad, peaceful.

### Growth: who Mote is becoming

Mote's temperament is its nature, fixed at birth. Its character grows from there (`server/life/character.ts`): kindness makes it warmer and less wary; being hurt or brushed off makes it warier; your questions and big changes make it curious; joy and wins make it playful; every dream makes it more of a dreamer; sleeping on hard days and letting go of hurts make it braver, and nightmares shake it. Traits drift slowly back toward its nature over weeks, so recent life matters most, but nothing is wiped. Character is never stored: it is replayed from the journal and the inner-life log, so every change points at the entry, thought or dream that caused it, and it works for entries written before this existed.

It is not just a chart: who Mote has become leans on what it does. A warm Mote comes closer, a wary one keeps its distance, a playful one plays, a brave one hides less. Bigger models also get its character in words ("a warm, playful dreamer who trusts you") in their state.

The **Growth** button opens a living map of it:

- Mote in the middle, its seven traits around it, sized by how strong they are (a dashed ring shows where each started).
- Your entries as memories, colored by feeling, pulled toward the traits they shaped; dreams as little stars, tied to the memories they grew from; core memories tied to Mote itself, thicker the more often it comes back to them. Hover or tap anything to see what it was and what it changed.
- Milestones (first words, first kindness, the first time it got hurt, first dream, first nightmare, slept on a hard day, a core memory formed, began to trust you, grew warm, became a dreamer...) and what it thinks about most on its own.
- A timeline: scrub it, click a milestone, or press **Play its life** to watch it grow from birth to now.

### What Mote notices: you at the computer

In the desktop app on Windows and macOS, Mote can notice when you're at the computer. It is **off until you turn it on** in Settings → What Mote notices (`server/senses`).

- **What it reads.** Only two things, once a minute and when it needs them: how long ago the keyboard or mouse was last used anywhere on this computer, and whether the screen is locked (Electron's `powerMonitor`). Never what you type, which apps or sites you use, or what's on screen.
- **What it keeps.** Just a count: how many minutes you were at the computer in each quarter hour of each day (the `activity` table in the journal database), deleted after 90 days. **Forget my rhythm** in Settings deletes all of it.
- **You nearby.** With no keyboard or mouse for 10 minutes, or the screen locked, you're away. While you're at the computer, busy with other things, Mote counts that as company: it gets restless more slowly and misses you a little, never a lot (like having seen you two hours ago). An open Mote window, such as the widget on your desktop, only counts as you watching it while you're actually there. When you're back, it tells you what it did while you were away. While you're away, the open window stops thinking on its own and the slower background heartbeat takes over. Bigger models also learn whether you're at the computer or away when Mote thinks.
- **Your daily rhythm.** From the last two weeks of finished days, code finds your usual night: the quietest seven hours of the day. Mote's body clock moves its own nights (by nature about 23:00 to 7:00) toward yours, starting after 3 days and fully after 12. A night owl's Mote stays up later and sleeps in; an early bird's goes to bed earlier. It sleeps, wakes up and feels the time of day on that clock. If your days look the same around the clock, it keeps its own nights. Settings shows your usual day hour by hour, your quiet hours and when Mote sleeps now.
- **Turning it off.** Mote stops noticing at once. What it learned fades over the next two weeks as those days age out, unless you press Forget.
- **Limits.** Watching a film without touching the mouse counts as being away. On Linux this isn't offered, because idle time isn't reliable everywhere (Wayland).

### Wellbeing safeguard

If `distress_flag` comes back with reasonable probability (threshold in `tuning.ts`), Mote turns soft and calm, and a small, dismissible card shows helpline information as plain text (works offline). Defaults: 988 in the US, findahelpline.com internationally. Edit [`server/wellbeing.json`](server/wellbeing.json) for your region. The model can be wrong; this is a gentle nudge, not a diagnosis, and it never blocks you.

---

## Debug tools

With `MOTE_DEBUG=true` in `.env`, a **Debug** button appears (or open the app with `?debug`). It is hidden otherwise:

- Sliders for every visual parameter, to tune the mapping without any model.
- **Fast-forward time** (+1 h to +7 days): mood decay, trust, grudges and Mote's body clock run on a shifted clock, so you can simulate days of journaling. It sleeps and wakes through the skipped time, and the "While you were away" card shows what happened.
- **Mote's life**: put it to sleep, make it dream right now (this asks the model, loading it if needed), wake it up, and replay its newest dream.
- **Rebirth** with an optional seed: compare two blobs (the seed is shown in Settings).
- A live readout of the mood engine (emotions, trust, grudges).
- **Reaction previews**: play any gesture and sound (each emotion, mixed, unsure, surprise, entry arriving, soothe, puzzled, wake, birth) without a model and without changing the mood.
- **Mind previews**: a clear and an undecided thought cloud, every behavior (nap, hum, sulk, wander...), and "think now" to trigger a background thought immediately.

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
- Thinking and dreaming on its own only talk to the same local model, only while that model is already loaded, and also while the page is closed (as long as the Mote server runs). Turn it off in Settings → Mote's mind.
- Noticing you at the computer is off unless you turn it on. When it is on, Mote reads only the keyboard-and-mouse idle time and whether the screen is locked, and keeps only minutes per quarter hour (90 days). See [What Mote notices](#what-mote-notices-you-at-the-computer).
- The server binds to `127.0.0.1` and only calls `OLLAMA_URL`, which must be local. Cloud models are refused by tag (`:cloud`, `-cloud`) and by the remote host Ollama reports for them.
- The only downloads are the ones you press in setup: Mote's own engine (the official Ollama build from its GitHub releases) and models (through the engine, from Ollama's model library). Nothing is uploaded.
- After setup (or `npm install` and pulling a model), the app works with the network disconnected.
- Storage uses the SQLite built into Node and Electron, so there are no native modules to compile.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

Unit tests cover the mood engine (decay, trust, grudges, reactions, temperament), the state builder (budget trimming, field selection), response parsing, the Ollama provider's checks against a fake local server, the mock provider, the catalog, the gesture and dream-motion curves (they start and end at rest with no jumps), the voices (fixed per seed, different between blobs), the body clock (sleeping at night, waking in the morning, never falling asleep while you're active, REM and dreams), what thoughts and dreams do to it, dream memories (never distress entries), character growth and milestones, noticing you at the computer (off by default, only minutes you used it, an open window counts as watched only while you're there, missing you less while you're nearby) and learning your rhythm (night owls and early birds, gradual adapting, no night when your days look the same, a night owl's Mote falling asleep later), a whole simulated night end to end (it thinks, falls asleep, dreams about your day, wakes up and tells you what it did), and setup: picking the right engine build for each platform, model-download progress, and downloading, unpacking and starting an engine against a local test server.

## Project layout

```
client/            Vite + TypeScript + Three.js front end
  src/blob/        shader, live blob view, gestures, dream motion, thumbnails
  src/audio/       synthesized sounds and per-blob voices
  src/mind/        thoughts, thinking on its own, dream theater, lines
  src/ui/          journal, growth map, settings, away card, debug panel
server/            Hono + better-sqlite3 back end
  decision/        DecisionProvider interface, questions, parsing, state builder, catalog
    providers/     ollama.ts, mock.ts (add one file per provider)
  mood/            temperament, mood engine, tuning constants
  life/            body clock, dreams, character growth, the heartbeat that keeps it living
  senses/          noticing you at the computer (opt-in), learning your daily rhythm
  setup/           the engine (yours or Mote's own), model downloads, recommendations
  main.ts          starts everything (used by index.ts and the desktop app)
desktop/           Electron app: tray, window and desktop widget, preload bridge
build/             app and tray icons (SVG sources and PNGs)
scripts/           bundles the desktop app
shared/            types and the visual mapping used by both sides
tests/             vitest unit tests
```
