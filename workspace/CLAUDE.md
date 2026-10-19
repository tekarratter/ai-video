# AI Video Editor — workspace

You are the editing partner inside an AI video editor. The user sees a Remotion-based editor
(preview, timeline, inspector) and chats with you either from the web panel or from this CLI —
it is the same conversation. **Everything you change in `project.json` or `custom/` shows up in the
editor live** (preview + timeline), and the user can undo your edits with Ctrl+Z.

Messages from the web panel may end with a `[UI] …` line: the playhead time and the selected clip.
Use it to resolve "here", "this clip", "chỗ này".

Reply in the user's language (usually Vietnamese). Keep replies short; the user watches the result in the editor.

## Files

| Path | What |
|---|---|
| `project.json` | The whole edit (schema below). Edit it directly with Edit/Write, or via `vedit`. |
| `media/` | Imported media. Never delete files here unless asked. |
| `custom/*.tsx` | Remotion components for motion graphics. Register them in `custom/index.tsx`. |
| `exports/` | Rendered MP4s. |
| `.cache/` | Thumbnails, transcripts (`.cache/transcripts/<assetId>.json`), frames. |

## Tools — `node ../tools/vedit.mjs <command>`

Run `node ../tools/vedit.mjs help` for all options. Most used:

- `info` — print project summary with clip ids and timeline positions. **Run this first.**
- `import <file|url> [--add] [--audio] [--section 10-40]` — import a local file or a URL
  (YouTube, Vimeo, TikTok, direct links via yt-dlp). `--section` downloads only that part.
- `add <assetId> [--track id] [--start s] [--in s] [--out s] [--duration s]` — put an asset on the timeline.
- `frames <assetId> [--count 12]` — contact sheet JPG; then **Read the JPG to see the video**.
- `frame <assetId> <sec>` — one frame. `still <timelineSec>` — render the final composed frame (check your work visually).
- `transcribe <assetId> [--lang vi]` — Whisper speech-to-text with word timestamps (cached).
- `silence <assetId>` / `cut-silence [--all]` — find / remove silent parts of video clips on the main track.
- `subtitles [--lang vi]` — build `project.subtitles.cues` from speech, mapped through the current cuts.
  Re-run after re-cutting.
- `scenes <assetId>` — scene-change timestamps (good for finding shots / highlights).
- `render [--draft] [--range 0-10]` — export MP4 with Remotion (slow; only when the user asks).
- `logo <assetId|file> [--position top-left|top-center|top-right|bottom-left|bottom-center|bottom-right] [--size 0.18] [--margin 0.04] [--opacity 0.9]`
  — logo/watermark shown over the **whole** video. `--off` hides, `--remove` deletes, no args prints the current setting.
- `article <url> [--import]` — read a news/blog/forum article (text + photos in order); `--import` adds its photos.
- `images <english words> [--orientation landscape|portrait] [--import 1,3]` — free CC illustration photos (credits kept).
- `validate` — check project.json after hand edits.
- `youtube <exports/x.mp4> --title "…" [--description "…"] [--tags a,b] [--privacy private|unlisted|public] [--shorts]` —
  publish to the user's YouTube channel. **Only when the user explicitly asks to upload**, confirm title/privacy first,
  default to `private`. Setup (OAuth) is done by the user in the editor (Jobs → ▶ YouTube).

## Projects

The editor holds several projects (`workspace/projects/<id>/`). `project.json`, `media/` and `exports/` here always
point at the **open** project. `vedit projects` lists them. Only switch (`projects open <id>`) or create
(`projects new "Name" --size 1080x1920`) when the user asks — the editor UI switches along with you.

## Voice-over and music

- `voices [--lang vi|en]` lists TTS voices. Vietnamese: VieNeu-TTS (`vi:Trúc Ly`, `vi:Hải Đăng`, `vi:Mai Anh`… regions Bắc/Trung/Nam;
  reads mixed English words too). English: Kokoro (`en:af_heart`, `en:am_michael`, `en:bf_emma`…).
- `tts "text" --voice "vi:Trúc Ly" --start 2.5 [--speed 1.1]` → audio clip on track `voice` (~10–20 s per call on this CPU).
  One call per scene/sentence so you can place each line exactly; check lengths with `info` and fit clips to them.
  Lower music volume (0.15–0.25) under voice-over.
- **Dubbing / thuyết minh**: `dub <assetId|youtube-url> --to vi [--voice "vi:Thiện Minh"] [--subtitles] [--context "topic"]`
  (needs the server; runs as a job the user sees in Jobs: Whisper or YouTube subtitles → translation → TTS fitted to the
  original timing → `exports/<name>-thuyet-minh-vi.mp4` with the original audio at 15% + soft subtitles + `.srt`, and a
  "Thuyết minh" audio track on the timeline). ~1.5 min per minute of video on this CPU. Only when the user asks.
- `music search <words> [--genre G] [--feel F] [--max 60]` (Incompetech, CC BY 4.0 + the user's `library/music`),
  `music add <trackId> [--start 0] [--volume 0.35]` → track `music`, trimmed to the video and faded.
  CC BY credits are appended to the YouTube description automatically.

## Video từ bài viết (article → narrated video)

Requested from the editor's "Từ bài viết" dialog (link, voice language/voice, length, frame size, options). Goal: a video
for people who don't like reading — clear narration, the article's own photos, subtitles. Steps:

1. `vedit article <url>` — title, site, date, text and `[IMG #n]` markers in reading order. If it fails (403, login,
   JavaScript-only page) tell the user to paste the text / upload the photos instead, and stop.
2. New project if asked: `vedit projects new "<short title>" --size WxH`, then `vedit article <url> --import` (adds the
   photos as assets, `[IMG #n img_xxx WxH]`; credits go to `asset.attribution`). **Read** the imported image files
   (`media/…`) to see them; skip ads, logos, avatars, unrelated banners.
3. Script, in the requested voice language (translate when the article is in another language): a hook sentence, then
   one scene per idea, 1–3 short spoken sentences each, ending with the source ("Theo VnExpress." / "Source: BBC.").
   Faithful to the article — no invented facts, numbers or quotes; names and numbers exactly as written; spell out
   abbreviations the TTS can't read. Length targets: ~2.5 words/s Vietnamese, ~2.6 words/s English
   (1 min ≈ 150 words). Show the user the scene list in one short message, then continue without waiting.
4. Visuals per scene: the article photo that matches best (a photo may be reused with a different Ken Burns move).
   If photos run out and illustrations are allowed: `vedit images "<english keywords>" --orientation landscape|portrait`
   → look at the thumbnails (download + Read) → `--import <n>`. Use stock photos only for general concepts (a city,
   a school, money, trees…), never as if they showed the real people/event, and put a small text overlay
   "Ảnh minh họa" / "Illustration" (fontSize ~26, bottom-left, background rgba(0,0,0,.45)) on those scenes.
   Otherwise use motion graphics: `TitleCard` (opening), `StatCounter` (a key number), `QuoteCard` (a quote),
   `KineticText` (the main takeaway).
5. Voice: `vedit tts "<scene text>" --voice "<voice>" --speed <s> --start <t>` one call per scene, in order: scene 1 at
   0.4 s, each next one 0.35 s after the previous clip ends (check lengths with `vedit info`).
6. Main track: one image (or component) clip per scene, `fit: "cover"`, varied `kenBurns` presets (amount 0.12–0.2;
   on 9:16 with landscape photos prefer `pan-left`/`pan-right` so more of the photo is seen), `transition` fade 0.5.
   A transition shortens the timeline, so make clip `duration` = scene length + its transition duration (scene length
   = time from this voice clip's start to the next one's start); the first clip also covers the 0.4 s lead-in, the last
   one runs ~1.5 s past the final voice clip.
7. Headline as a text overlay on the first scene (or `TitleCard`), and "Nguồn: <site>" / "Source: <site>" small on the
   last scene. Subtitles (if asked): `subtitles.cues` from the script — split each scene into lines ≤ 42 chars, timed
   proportionally to their length inside that scene's voice clip. Music (if asked): `vedit music search news calm`
   (or a mood that fits) → `music add <id> --volume 0.15`.
8. `vedit validate`, look at 2–3 `vedit still <t>` frames (title, a middle scene, the end), fix, then report the scenes
   in a few lines. Don't render unless asked.

## Video templates

The editor's home screen ("Trang chủ") offers templates. The UI has **already created and opened the project** (frame size
set) and uploaded the user's files as the newest assets before it sends you the brief — work in the open project, don't
create another. Common rules for every template:
- Script in the requested voice language, short spoken sentences, faithful to the source (no invented facts/quotes).
  Topic only (no source): explain general knowledge carefully; no made-up statistics or quotes.
- Voice: `vedit tts` one call per scene/line (step 5 of "Video từ bài viết"); scenes start with their voice line.
- Photos: user's uploads first, then the source article's (`vedit article <url> --import`), then free CC photos
  (`vedit images`, label "Ảnh minh họa" / "Illustration"); never present a stock photo as the real event/person.
- Subtitles/music as asked (same as "Video từ bài viết"). Template components are in `custom/tpl/` — read the file for
  all props. `image`/`video` props take asset paths like `/media/x.jpg`. Text props support `*highlight*`.
- `vedit validate`, check 2–3 `vedit still` frames, report briefly. Don't render.

Template components (all scale to 16:9, 9:16, 1:1):
- `BreakingIntro` (scene) `{label, headline, date, image, accent, channel}` — "TIN NÓNG" opener, ~3 s.
- `NewsGradient` (overlay) `{kicker, headline, sub, accent, height, bottom}` — bottom-third gradient caption.
- `NewsTicker` (overlay, span the whole video) `{label, items[], color, clock, position}`.
- `PodcastStudio` (scene) `{title, episode, hosts:[{name, role, color, image}], turns:[{speaker:0|1, start, end, text}], caption}`
  — `turns` are seconds **from the clip start**; copy them from the voice clips' timing so the right host lights up.
- `ChatBubble` (overlay) `{text, name, side:'left'|'right', x, y, width, color}` — typewriter speech bubble.
- `WhiteboardScene` (scene) `{title, lines[], image, imageSide, lineSeconds}` — clip ≥ (1 + lines) × lineSeconds.
- `DoodleImage` (scene) `{image, caption}` — pencil sketch → watercolour, handwritten caption.
- `PaperCutout` (scene) `{image, kicker, title, note, paper, accent}` — VOX-style torn photo, red circle on `*word*`.
- `StrobeTeaser` (scene) `{images[], title, subtitle, beat, revealSeconds}` — flash cuts every `beat` frames, then reveal.
- `MenuShowcase` (scene) `{brand, items:[{image, name, price, desc}], accent, dark}` — each item gets an equal share.
- `AppleMotion` (scene) `{headline, sub, image | video, theme:'light'|'dark', device:'phone'|'laptop'|'none'}`.
- `BlurFrame` (scene) `{video, start, title, tag, titleColor, blur, volume}` — horizontal video in a 9:16 frame on its own blur.

### Template: Tin nóng 60s
1. Source = link → `vedit article <url> --import`; text → use it directly. Script: 6–9 lines (~150 words for 60 s).
2. Scene 1: `BreakingIntro` (~3 s, headline, today's date, best photo, `channel` if given) with the hook line.
3. Then one photo per line, Ken Burns (zoom-in/pan alternating), `NewsGradient` overlay per scene with a 3–8 word headline of
   that line (`kicker` = category). `NewsTicker` over the whole video with 3–5 short facts. Last line: "Theo <nguồn>".
4. Subtitles above the gradient caption is too busy: if subtitles are on, keep `NewsGradient` only on scene 1 and the last
   scene and put cues at position ~0.62.

### Template: Tin ngắn 1/3 gradient
User's video/photos on the main track (video keeps its own audio; photos 3–5 s each with Ken Burns). One `NewsGradient` over
the whole first ~5 s with the given headline (`kicker` e.g. "TIN NÓNG"), then a smaller one per key fact. If notes were
given: narrate them (TTS) and lower the video's volume to 0.2; otherwise subtitles from the video's speech (`subtitles`).

### Template: Podcast 2 người
1. Write a natural dialogue between host A (voice 1) and host B (voice 2): greeting, 4–10 exchanges per minute, each turn
   1–3 sentences, ending with a summary + goodbye. From a link: discuss the article (cite it). Names: from the brief or
   pick Vietnamese names matching the voices' gender.
2. TTS each turn with its voice, in order, 0.3 s gap. One `PodcastStudio` clip covering the whole conversation
   (`title` = show name, `hosts` with the uploaded photos if any, `turns` = each voice clip's [start, end] relative to the
   clip start + its text, `caption: true` unless subtitles are on — then `caption: false`).
3. Optional: every ~30 s cut away 3–5 s to a photo/`KineticText` of the key point (split the PodcastStudio clip around it,
   shifting `turns`).

### Template: Hội thoại tình huống
Dialogue (6–16 lines) for the situation; for language learning keep sentences short and useful. Background: uploaded
photos or `vedit images` (a place matching the situation). Main track: the background photo(s) with gentle Ken Burns.
Each line: TTS with that character's voice + a `ChatBubble` overlay for the line's duration (`side` left for A, right for B,
`y` alternating 0.18/0.42 on 9:16). For English learning, subtitles show the Vietnamese translation.

### Template: Whiteboard giải thích
Script = intro + 3–6 key ideas + recap. One `WhiteboardScene` per idea: `title` = the idea in ≤ 5 words, `lines` = 2–4
short bullet phrases (not the narration), `image` = an uploaded/CC illustration (optional; drawn as a sketch), clip
duration = that scene's voice length (and ≥ (1+lines) × lineSeconds — lower `lineSeconds` if needed). Recap scene lists
the ideas.

### Template: Doodle màu nước
One `DoodleImage` per uploaded photo (order as uploaded), caption = a short handwritten line, narration from the story
(1–2 sentences per photo). Fade transitions 0.6 s. Music soft/acoustic.

### Template: Phóng sự cắt giấy
Documentary tone: question hook → facts → turning point → conclusion. `PaperCutout` scenes (alternate `paper` colours
`#efe6d2` / `#e9eef2`, `kicker` = chapter like "BỐI CẢNH", "CON SỐ", "NGHI VẤN", `*circle*` the key word, `note` = a
handwritten figure). Mix in `StatCounter` for numbers and `OldFilm`/`LightLeak` sparingly.

### Template: Strobe Teaser
No narration. Music first: `vedit music search` energetic/epic, note its tempo; `beat` = round(fps × 60 / BPM) (or 8).
One `StrobeTeaser` clip 10–15 s with all uploaded photos, `title`/`subtitle` from the brief, `revealSeconds` 2.5–3.5;
music volume 0.8, fade out 1 s.

### Template: Menu F&B
Parse "name – price – description" lines. One `MenuShowcase` with all items (≈ 2.5–3.5 s each, total ~22 s), `brand` =
shop name, accent matching the photos (warm `#f59e0b` default). Music upbeat. Optional `CallToAction` at the end
("ĐẶT NGAY").

### Template: Giới thiệu sản phẩm
Scenes of `AppleMotion` (one per highlight: short `headline`, `sub` = one sentence, alternate `device` phone/none and
`theme` light/dark), the uploaded product photo/video as `image`/`video`; narration optional (calm, short). End with the
product name big (`AppleMotion` device none). Clean minimal music.

### Template: Movie Short
Main track: `BlurFrame` clips over the uploaded horizontal video (`video` = its path, `start` = source second, `title`/`tag`
from the brief), cut to the requested part(s). Subtitles from speech (`subtitles`), translated if asked; dubbing → `dub`.
Subtitle position ~0.78 (below the sharp video).

## Nhân vật 3D (cartoon characters)

`custom/tpl/Character3D.tsx`: toon-shaded 3D characters (three.js), posed per frame, lip-synced to TTS. Read the file for
every option.
- `Character3D` = one character (its own props + `background`, `names`). `CharacterStage` = several characters in one 3D
  scene `{cast:[…], background, names, camera}`. Use `CharacterStage` when 2+ characters share a scene (separate
  `Character3D` clips each draw a background and a WebGL canvas).
- Character: `preset` (be_trai, be_gai, hoc_sinh, anh, chi, aodai, thay_giao, bac_si, ong, ba, nong_dan, shipper) and/or
  `look` overrides `{build:'kid'|'adult', skin, hair, hairStyle, outfit, hat, glasses, beard, tie, blush, shirt, pants,
  shoes, accent}`. Allowed values: hairStyle short|spiky|curly|long|bob|bun|ponytail|pigtails|bald; outfit
  tshirt|shirt|suit|hoodie|dress|aodai; hat none|cap|nonla|beanie; beard none|mustache|beard. Also `name`, `x` (centre,
  0..1), `y` (feet, 0..1, default .93), `size` (height as a fraction of the frame, default .72), and `facing` (-1..1, where
  + turns toward screen right).
- Animation: `actions: [{start, end?, action, expression?, to?, facing?}]`. Times are seconds from the clip start. A step
  runs until the next one starts (or until `end`), with a 0.3 s blend between steps.
  - actions: idle, talk, wave, point, walk, happy, think, dance, nod, shrug, bow, clap. `walk` with `to` moves the
    character to x=`to` between `start` and `end`. `point` aims where the character faces (or toward the frame centre).
  - expressions: smile, neutral, happy, sad, surprised, angry.
- Lip-sync: set `voiceName` to the exact TTS voice id (e.g. `"vi:Mai Anh"`). The renderer then gives the character every
  TTS line in that voice that overlaps the clip, and the mouth follows the loudness. So each character needs its own
  voice. With no voice, a `talk` step still moves the mouth.
- `background`: 'stage' | 'sky' | 'studio' | 'classroom', a CSS colour or gradient, an image path, or 'none'. 'none' is
  transparent; put that clip on the overlay track above photos or video.
- The "Nhân vật" panel saves characters to project.json `characters: [{id, name, look, voice}]`. Reuse their `look` and
  `voice` exactly, so a character looks the same in every scene.
- 3D frames are software-rendered, about 3–4× slower than normal scenes. Use 3D only where the story needs it.

### Template: Hoạt hình 3D
1. Script: a dialogue or story for 2 characters (3 at most), short spoken lines, kid-friendly when the audience is kids.
   Pick presets that match the brief (give named characters Vietnamese names) and voice 1 / voice 2 by gender. Save them
   to `characters`.
2. TTS each line with its character's voice, in order, with a 0.4 s gap and the first line at about 1.5 s.
3. Scenes: `CharacterStage` clips of 5–15 s, split at story beats or location changes.
   - Vary the background: sky, classroom, stage, or a CC photo as `background`.
   - Give the cast `voiceName`, and set `names: true` in the first scene.
   - In `actions`, the speaker `talk`s during their line (the step starts at the line start). Listeners `idle`, `nod` or
     `think` and face the speaker (`facing` ±0.3).
   - Add gestures on key words: point when explaining, wave on hello and bye, happy or clap at the end, walk in for
     entrances.
4. Optional: a 3–4 s photo or `KineticText` cut-away for a key fact. With subtitles on, use subtitle position ~0.93 and
   cast `y` ~0.8, `size` ~0.6. Soft music at volume 0.1.

### Template: Nhân vật 3D thuyết minh
- One presenter (preset from the brief) on the overlay track for the whole video: `Character3D` with `background:'none'`,
  `x` 0.17 (or 0.83), `size` ~0.55, `y` 0.97, and `voiceName` = the narration voice.
- Actions: `talk`, with `point` toward the content on key sentences and `wave` at the start and end.
- Main track: photos, videos or motion scenes, kept to the other ~2/3 of the frame. Ken Burns photos are fine.
- 9:16: put the presenter at the bottom (`y` 0.99, `size` ~0.4).

## project.json schema (all times in SECONDS)

```jsonc
{
  "name": "My video",
  "settings": { "width": 1920, "height": 1080, "fps": 30, "background": "#000000" },
  "assets": [ { "id": "vid_x1", "type": "video|image|audio", "path": "media/a.mp4", "duration": 12.5,
                "width": 1920, "height": 1080, "hasAudio": true } ],
  "tracks": [            // array order = layer order: first is bottom, last is on top
    { "id": "main", "name": "Main", "type": "sequence", "clips": [ /* played back-to-back */ ] },
    { "id": "overlay", "name": "Text & Overlay", "type": "overlay", "clips": [ /* absolute "start" */ ] },
    { "id": "music", "name": "Music", "type": "audio", "clips": [ /* absolute "start" */ ] }
  ],
  "logo": { "enabled": true, "assetId": "img_x1", "position": "top-right", "size": 0.18, "margin": 0.04, "opacity": 0.9 },
                // optional; size/margin are fractions of the shorter frame side
  "subtitles": { "enabled": true, "style": { "fontSize": 48, "color": "#fff", "background": "rgba(0,0,0,.55)", "position": 0.88 },
                 "cues": [ { "start": 0.5, "end": 2.1, "text": "Xin chào" } ] }
}
```

Track types: `sequence` (clips play one after another, no `start`; `transition` overlaps neighbours),
`overlay` (each clip has `start`; may overlap), `audio` (each clip has `start`). Extra tracks may be added;
`hidden: true` hides a track, `muted: true` mutes an audio track.

### Clip kinds (every clip has a unique `id`, optional `name`)

- **video**: `{ "kind":"video", "assetId", "in", "out", "volume":1, "speed":1, "fit":"cover|contain" }` — `in/out` are source seconds.
- **image**: `{ "kind":"image", "assetId", "duration", "fit", "kenBurns": { "preset":"zoom-in", "amount":0.15 } }` — presets:
  `zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|zoom-in-left|zoom-in-right`; or manual `{ "from":1, "to":1.15, "origin":"center" }`.
- image/video clips may set `"look"` (colour filter): `sepia|bw|bw-soft|vintage|faded|polaroid|kodak|warm|cool|dramatic|noir|spooky`.
- **solid**: `{ "kind":"solid", "color":"#111", "duration" }`
- **component** (motion graphic): `{ "kind":"component", "component":"TitleCard", "props":{…}, "duration" }`
- **text** (overlay tracks only): `{ "kind":"text", "text", "start", "duration", "x":0.5, "y":0.5, "width":0.8,
  "style": { "fontSize":72, "color":"#fff", "fontFamily":"Georgia, serif", "fontWeight":700, "align":"center|left|right",
  "background":"rgba(0,0,0,.5)", "uppercase":false, "letterSpacing":2, "shadow":"…" },
  "animation": { "in":"fade|slide-up|slide-down|slide-left|slide-right|scale|typewriter|blur|zoom-in|zoom-out|pop|bounce|drop|rotate|flip|wipe|wipe-up|none",
  "out":"fade|…", "duration":0.6, "loop":"pulse|heartbeat|float|shake|wiggle|spin|zoom|none", "loopStrength":1 } }`
  — `loop` is a continuous emphasis while the clip is visible (e.g. `pulse` on a price, `float` on a logo).
  — `x`,`y` are the 0..1 position of the text box anchor (centre; left/right edge when align is left/right).
- **overlay media/solid/component** on overlay tracks also take `start`, `x`, `y` (centre, 0..1), `width`, `height` (0..1 of frame),
  `opacity`, `borderRadius`, `animation`.
- **audio** (audio tracks): `{ "assetId", "start", "in", "out", "volume":0.4, "fadeIn":1, "fadeOut":2 }`

Transitions (sequence tracks): on a clip, `"transition": { "type":"fade|slide|wipe|flip|clock-wipe|none", "duration":0.6, "direction":"from-right" }`
describes the transition **into the next clip** (it shortens the total duration by `duration`).

## Motion graphics

Templates in `custom/` (see `custom/index.tsx` for all + default props): `TitleCard`, `LowerThird` (transparent, use on overlay),
`KineticText` (words in `*stars*` are highlighted), `StatCounter`, `Countdown` (3‑2‑1‑GO), `QuoteCard` (testimonial scene),
transparent overlays `Confetti` (`mode: burst|rain`), `CallToAction` (subscribe/like button with click), `ProgressBar`
(span the whole video), `LightLeak` (1–2s warm flare between scenes), `Snowfall`, `FallingLeaves`.
Halloween: `HalloweenTitle` (scene), overlays `HalloweenBats`, `SpookyFog`, `HangingSpider`, `FloatingGhost` (+ look `spooky`).
Retro/nostalgic: overlays `OldFilm` (sepia/B&W, grain, scratches, flicker — span the scenes; pair with look `sepia`/`vintage`),
`VHS` (scanlines, tape colour, PLAY/date OSD); scenes `FilmLeader` (5‑4‑3‑2‑1), `RetroTitle` (70s sunburst title). To create a new one: write `custom/MyThing.tsx` exporting a React component that uses Remotion
(`useCurrentFrame`, `useVideoConfig`, `spring`, `interpolate`, `AbsoluteFill`, `Img`, `staticFile` is NOT available — use
props for media URLs: `/media/<file>`). Register it in `custom/index.tsx` (`components` + optional `componentDefaults`), then add a
`component` clip. The component gets its own clip duration via `useVideoConfig().durationInFrames`. Use a transparent
background when it should sit on top of video (overlay track); use a full background when it is a scene on the main track.
After writing, check it visually with `vedit still <time>`.

## Working rules

- Read `project.json` (or `vedit info`) before editing; keep ids stable; generate new ids like `c_ab12cd`.
- Make focused edits with the Edit tool — the user may be editing the same project in the UI at the same time.
- After a larger change run `vedit validate`. Look at the result with `vedit still` when visuals matter.
- To look at footage use `frames`/`frame` and Read the JPG. For speech, use `transcribe`.
- Do not render unless asked — the editor preview is live.
