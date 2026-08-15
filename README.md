# sketchime

A multi-clip storyboard tool for hand-drawn 2D animation. Draw keyframes on an
infinite canvas, direct each transition through a four-step board, and render
5-second interpolated clips with Gemini/Veo.

```bash
npm install
cp .env.example .env.local     # add your Gemini key (optional — see below)
npm run dev
```

Everything lives in session memory. There is no database, no accounts, and
nothing is written to disk — closing the tab discards the board.

## How it works

1. **Add a clip.** It gets a start keyframe (Image A) and an end keyframe (Image B).
2. **Draw them** in the full-screen canvas, with the other keyframe showing
   through as an onion skin.
3. **Run the board** — four directors, in strict order. Each one *looks at your
   two keyframes*, says what it sees, and keeps asking until it's satisfied.
4. **Compile** the prompt, optionally have Gemini tighten it, then generate.

### The board actually looks at your drawing

Each board member is a vision agent. It receives both rendered keyframes, opens
with an observation citing something concrete in them, then asks a question whose
three options are written *for that drawing* — the choices differ between a
bouncing ball and a character turning. Option D is always a write-in.

It does not stop after one question. It keeps asking follow-ups until it declares
itself **satisfied**, at which point it commits a **directive** — one or two
imperative sentences that go into the compiled prompt verbatim. Only then does
the next member take over. Follow-ups are capped at `MAX_TURNS_PER_AGENT` (4), and
the agent is told how many turns remain so it commits rather than opening a line
of questioning it can't finish.

Without an API key the board degrades honestly: it falls back to the spec's fixed
questions and options, single-turn, and labels itself `offline` so you know
nobody looked at your frames.

### Continuity chaining

Adding a clip after an existing one does not *copy* the previous end frame — the
two clips reference the **same frame object**. Editing that drawing from either
side moves both, which is what keeps the cut invisible, and it survives redoing
or re-editing a clip.

The timeline marks each join. **Linked** joins can be split (`unlink` forks the
frame into two independent copies, so no work is lost and the clips can diverge).

**Reordering deliberately does not re-chain.** Dragging clip 3 to the front would
have to overwrite one of two boundary drawings to keep the chain intact, silently
destroying work. Instead the link breaks, the seam is marked **cut**, and you can
re-link it explicitly — with a confirmation, since that *is* the destructive move.

### Shared framing

Both keyframes of a clip are rasterised through one shared 16:9 world box. Render
them to their own tight crops and the model reads the crop difference as camera
movement, so the subject appears to jump between the first and last frame.

## Gemini setup

Two ways to supply a key, checked in this order:

1. **`GEMINI_API_KEY` in `.env.local`** — preferred. The key stays server-side and
   never reaches the browser.
2. **The in-app Settings dialog** — held in `sessionStorage`, gone when the tab
   closes. Convenient for local use.

Model ids are overridable with `GEMINI_VIDEO_MODEL` and `GEMINI_TEXT_MODEL`.
Every provider-specific detail lives in `lib/server/gemini.ts`.

> **Verify before you rely on it:** keyframe interpolation needs a Veo model that
> accepts a `lastFrame` (Veo 3.1+); earlier Veo models take a start image only.
> The text and vision paths are confirmed reaching the live API; the video request and
> response shapes are written to Google's documented contract but have **not**
> been exercised against a real key here. The response parser searches the
> operation payload for a video URI rather than assuming one path, so a shape
> change degrades to a clear error rather than a wrong field.

The browser never talks to Google directly — `/api/veo` and `/api/revise` proxy
everything, including the finished video download (its URL needs the key).

## Canvas controls

| | |
|---|---|
| `d` / `e` / `t` / `m` | pen, eraser, text, pan |
| `e` again | flip the eraser between **stroke** and **pixel** |
| `c` / `g` | colour & brush panel / onion skin |
| `1`–`9` | palette colours |
| `w` / `s` | brush bigger / smaller |
| wheel, ctrl/⌘+wheel, middle-drag | pan, zoom about the cursor, pan anywhere |
| `0` | fit the drawing to the screen |
| `⌘/ctrl+Z` | undo |

**Stroke** erase removes a whole stroke on contact. **Pixel** erase rubs out only
the points under the cursor and *splits* the stroke around the hole — still
vector, so fragments stay crisp at any zoom.

## Architecture

```
lib/ink.ts          stroke model: perfect-freehand outlines, bounds, splitStroke
lib/camera.ts       every screen<->world conversion, grid, fit, zoom-at-cursor
lib/render.ts       sketch -> PNG through a shared clip box
lib/board.ts        the four board steps + offline fallback
lib/compile.ts      Stage 2 master compiler + revision brief
lib/storyboard.ts   chaining, seams, link/unlink, reorder, frame GC
lib/server/gemini.ts  ALL provider-specific detail, server-only:
                      vision board agents, prompt revision, Veo interpolation
components/         SketchLayer (canvas) · Canvas (surface) · Rail (tools)
                    Studio (app) · Timeline · BoardSurvey · ClipDetail
```

Three things carry most of the weight:

- **`SketchLayer`** is a fully-controlled `<canvas>` that knows nothing about
  coordinates — it takes a `toLocal` callback and reports finished strokes. The
  in-progress stroke lives in a ref and redraws are rAF-coalesced, which is what
  keeps drawing fast.
- **`lib/camera.ts`** owns all space math. The `.world` div carries a CSS
  `translate() scale()` and `screenToWorld` is its exact hand-written inverse.
- **Frames are referenced, never embedded.** That single decision is what makes
  continuity chaining work.

### Other things that are load-bearing

- The ink canvas is not infinite — it is a viewport-sized world rect that follows
  the camera, redrawn with its own top-left as the drawing origin. Resizing a
  canvas wipes it, so any size change must come through `resizeKey`.
- The dot grid is driven from the camera (`gridPattern`), or it sits frozen while
  the world moves under it.
- `Canvas` advances its own sketch mirror *before* the owner re-renders. One
  pointermove delivers many coalesced erase samples in a tick; without that, only
  the last would apply.
- Undo is snapshot-based and capped at 100. An eraser drag snapshots once, so the
  whole drag undoes as one — and Clear is undoable for the same reason.

## Credit

Board-agent design — a structured-JSON conversation loop driven by a
satisfied/not-satisfied flag — is adapted from
[Jeff15321/Stu3dio-HackTheNorth2025](https://github.com/Jeff15321/Stu3dio-HackTheNorth2025).


The canvas, ink pipeline and camera are adapted from the `maobi` product in
[101011101/backinthe6ix](https://github.com/101011101/backinthe6ix). That repo
publishes no licence, so treat reuse accordingly.
