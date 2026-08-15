# sketchime

A multi-clip storyboard tool for hand-drawn 2D animation. Draw keyframes on an
infinite canvas, direct each transition through a four-person crew, and render
5-second interpolated clips with Gemini/Veo.

```bash
npm install
cp .env.example .env.local     # add your Gemini key (optional — see below)
npm run dev
```

There is no database and no accounts. Drawings are kept in this browser's
localStorage and finished videos in IndexedDB, so a reload does not lose your
work; nothing leaves the machine except what is sent to Gemini.

### How it works

1. **Add a clip.** It gets a **first frame** and a **last frame**.
2. **Draw them** in the full-screen canvas, with the other frame showing through
   as an onion skin. Most last frames start as a copy of the first with one
   thing moved — the storyboard's `→` and the canvas's `shift+D` both do that
   copy for you.
3. **Talk to your crew** — four specialists, in strict order. Each one *looks at
   your two drawings*, says what it sees, and keeps asking until it's satisfied.
4. **Make the clip.** The brief is compiled from what the crew settled on, and
   the estimated cost is shown next to the button, before the click.

The interface follows those steps literally: the storyboard runs down the left,
and the clip you have selected opens on the right as three numbered stages —
*draw*, *say what happens*, *make the animation* — with the current one lifted
out of the stack. Everything that belongs to the machinery rather than the task
(the compiled prompt, the end-frame constraint, the Gemini rewrite pass) sits
behind a **Fine-tuning** disclosure at the bottom of that panel, and model ids
and environment variables behind **Technical details** in Settings.

### The crew actually looks at your drawing

Each crew member is a vision agent. It receives both rendered keyframes, opens
with an observation citing something concrete in them, then asks a question whose
three options are written *for that drawing* — the choices differ between a
bouncing ball and a character turning. Option D is always a write-in.

It does not stop after one question. It keeps asking follow-ups until it declares
itself **satisfied**, at which point it commits a **directive** — one or two
imperative sentences that go into the compiled prompt verbatim. Only then does
the next member take over.

Follow-ups are capped at `MAX_TURNS_PER_AGENT` (4), and the cap is *enforced in
code* on both the client and the server — telling the agent about it in the
prompt is not enough, since a chatty one simply ignores it. Past the limit the
reply is rewritten into a commit whatever it says. **That's enough, decide** cuts
the questioning short at any point.

Every step also carries a neutral `defaultDirective` for the case where an agent
commits without producing anything usable. That slot used to fall back to the
step's own brief *question*, which then travelled into the prompt sent to the
video model, where it directed nothing at all. Compiled directives are sanitised
for question-shaped text on the way out, so a board answered before that check
existed is repaired rather than baking the question in forever.

Without an API key the crew degrades honestly: it falls back to the spec's fixed
questions and options, single-turn, and wears an **Offline** badge so you know
nobody looked at your frames.

### Continuity chaining

Adding a clip after an existing one does not *copy* the previous end frame — the
two clips reference the **same frame object**. Editing that drawing from either
side moves both, which is what keeps the cut invisible, and it survives redoing
or re-editing a clip.

The storyboard marks each join between two clips. A join labelled **Flows on**
can be split — that forks the frame into two independent copies, so no work is
lost and the clips can diverge.

**Reordering deliberately does not re-chain.** Dragging clip 3 to the front would
have to overwrite one of two boundary drawings to keep the chain intact, silently
destroying work. Instead the link breaks, the join is marked **Hard cut**, and
you can join them again explicitly — with a confirmation, since that *is* the
destructive move.

### Guide vs exact end frames

Veo's `lastFrame` is a **hard constraint**: supply it and the model must land on
that exact image, so when its natural motion diverges from the target it
reconciles by snapping, regressing or fading in the final second. No amount of
prompt wording talks it out of that — the only way out is to not send the frame.

So each clip has an end-frame mode, shown and overridable under **Fine-tuning**
in the clip panel as *how the clip ends*:

- **`exact`** — "Land exactly" — pins the frame. Required wherever clips are
  chained, because clip N's last frame has to *be* clip N+1's first frame or the
  cut shows.
- **`guide`** — "Let it run on" — withholds the image and lets the clip run out
  mid-motion. The end frame still steers the action: a vision model turns it into
  prose via `/api/describe`, and that description is the entire channel through
  which the intended destination reaches the video model.

The default is derived per seam rather than set globally: a clip whose end frame
is shared with the next clip is pinned, and an unchained one is free to end
mid-motion. Each mode compiles a different transition brief — they are different
jobs, not different wording.

### Shared framing

Both keyframes of a clip are rasterised through one shared 16:9 world box. Render
them to their own tight crops and the model reads the crop difference as camera
movement, so the subject appears to jump between the first and last frame.

The crew get the same pair at 768×432 rather than full size — a vision model
reading "what is drawn and what moved" needs far less than 720p for flat line
art, and the crew runs four agents over several turns each.

## Gemini setup

Two ways to supply a key:

1. **The in-app Settings dialog** — held in `sessionStorage`, gone when the tab
   closes. **This wins** if both are present. Env-first looks safer but is
   hostile: a stale key in `.env.local` silently shadows the one you just
   pasted, and every request fails against a key you can't see and didn't
   choose.
2. **`GEMINI_API_KEY` in `.env.local`** — the default for deployments, where
   nobody types anything. The key stays server-side and never reaches the
   browser.

**Save & check** in Settings asks Google which models the key can actually call
and reports back what it picked.

### Models are discovered, not hardcoded

Hardcoding one model id does not survive contact with the API: ids get retired,
and older ones get closed to *new* keys while existing keys keep working — so
the same id succeeds for one person and 404s for another. Text and video each
carry an ordered preference list, and what a given key can really call is
discovered at runtime through `/models` and cached per key.

Every request retries transient failures with short backoff, then walks down the
candidate list. Two deliberate exceptions:

- **Rate limiting never fails over.** Quota is per project, not per model, so
  retrying just burns time to reach the same answer. Veo in particular is often
  unavailable on a free-tier key, and reporting "everything is busy" would send
  you to wait for a spike that never passes.
- **Video never escalates on overload.** Its list is ordered *cheapest first*, so
  the next model up is a pricier one — silently turning a $0.25 render into a
  $2.00 one because the cheap tier was briefly busy is a surprise bill, not
  resilience. Set `GEMINI_VIDEO_MODEL` to choose a tier deliberately.

`GEMINI_VIDEO_MODEL` and `GEMINI_TEXT_MODEL` collapse discovery to one entry:
name a model and you get that model, including its errors. `GEMINI_API_BASE`
repoints the endpoint for testing the failover paths — never aim it anywhere
untrusted, the API key goes with it. Every provider-specific detail lives in
`lib/server/gemini.ts`.

Two video backends sit behind one call site. **Veo** is long-running and returns
an operation to poll; it is the only one that can pin a `lastFrame`, so chained
seams require it. **Gemini Omni Flash** is a different API surface entirely
(`/interactions`, synchronous, one image only) — it cannot pin an end frame at
all, which suits `guide` mode and rules it out for chaining.

> **Verify before you rely on it:** the text and vision paths are confirmed
> reaching the live API. The video request and response shapes follow Google's
> documented contract but have **not** been exercised against a real key here.
> The parsers search for a video URI rather than assuming one path, so a shape
> change degrades to a clear error rather than a wrong field. Optional Veo
> parameters are dropped one at a time as the API rejects them, since revisions
> differ in which they accept.

The browser never talks to Google directly — `/api/board`, `/api/describe`,
`/api/revise`, `/api/veo` and `/api/config` proxy everything, including the
finished video download (its URL needs the key).

## Canvas controls

| | |
|---|---|
| `d` / `e` / `t` / `m` | pen, eraser, text, pan |
| `e` again | flip the eraser between **stroke** and **pixel** |
| `c` / `g` | colour & brush panel / onion skin |
| `shift+D` | copy the other keyframe's ink into this one (additive, one undo) |
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
lib/storyboard.ts   chaining, seams, link/unlink, reorder, frame GC,
                    end-frame mode per seam
lib/server/gemini.ts  ALL provider-specific detail, server-only: model discovery
                      and failover, vision board agents, frame description,
                      prompt revision, Veo + Omni Flash video
lib/persist.ts      storyboard -> localStorage, defensively read back
lib/videoStore.ts   finished videos -> IndexedDB (too big for localStorage)
lib/stitch.ts       join the rendered clips into one downloadable file
app/api/            board · describe · revise · veo · config (all proxies)
app/globals.css     the design tokens, then everything styled from them
components/         SketchLayer (canvas) · Canvas (surface) · Rail (tools)
                    Studio (shell) · Timeline (storyboard) · ClipDetail (the
                    three-stage panel) · BoardSurvey (crew room) · FinalCut
                    Modal · ConfirmDialog · SettingsDialog · FrameThumb · Icon
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
- **The prompt is compiled on every render, not cached on the clip.** It is
  string assembly, so recomputing costs nothing, and it removes a whole class of
  bug: a stored prompt is whatever the compiler said when the clip was last
  touched, so an improvement to the compiler would reach new clips only — the
  panel would show one thing while generation sent another. Generation
  recompiles too.
- Copying a keyframe clones strokes with fresh ids and copied point arrays. Two
  frames about to be edited apart must never end up aliasing each other.

## The design system

Everything visual comes from a token declared at the top of `app/globals.css`.
There are no raw colours below that block, which is what makes the dark theme a
list of overrides rather than a second stylesheet to keep in sync.

Two rules there are load-bearing rather than cosmetic:

- **The artboard is pinned light in both themes.** Ink is drawn in dark palette
  colours and exported onto white, so a dark drawing surface would both hide the
  drawing and misrepresent the render. Only the chrome around it themes.
- **The focus ring is defined once, on `:focus-visible`, and never removed.** A
  control you can reach with Tab but cannot see is unusable, and it is the first
  thing a restyle tends to break.

Icons are one family (`components/Icon.tsx`), drawn on a single 20×20 grid at
stroke 1.5 — no text glyphs standing in for icons, since those render
differently on every platform and cannot be themed.

`.claude/skills/` holds [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
installed project-scoped with `npx ui-ux-pro-max-cli init --ai claude`. It is
searchable design guidance for agents working on this UI; the search script needs
Python 3 and no external dependencies. Nothing in the app imports it.

## Credit

Board-agent design — a structured-JSON conversation loop driven by a
satisfied/not-satisfied flag — is adapted from
[Jeff15321/Stu3dio-HackTheNorth2025](https://github.com/Jeff15321/Stu3dio-HackTheNorth2025).


The canvas, ink pipeline and camera are adapted from the `maobi` product in
[101011101/backinthe6ix](https://github.com/101011101/backinthe6ix). That repo
publishes no licence, so treat reuse accordingly.
