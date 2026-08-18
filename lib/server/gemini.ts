/**
 * Server-side Gemini adapter. Everything provider-specific - base URL, model
 * ids, request shapes, response shapes - lives in this one file, so when Google
 * moves something there is exactly one place to change.
 *
 * Keys are never sent to the browser. A request may carry a key the user typed
 * into the in-app settings dialog (session-only, matching the no-persistence
 * rule); otherwise the server's own GEMINI_API_KEY env var is used. The env var
 * is strictly preferred so a deployed instance can hide the key entirely.
 */

/** Overridable so the retry/failover behaviour can be exercised against a fake
 * endpoint. Never point this anywhere untrusted - the API key goes with it. */
const BASE = process.env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Preferred text models, best first. This is a PREFERENCE list, not a hardcoded
 * choice: what a given key may actually call is discovered at runtime (see
 * resolveTextModel) and the first entry the key can see wins.
 *
 * Hardcoding one id does not survive contact with reality - Google retires
 * models and, worse, closes older ones to NEW keys while existing keys keep
 * working, so the same id succeeds for one user and 404s for another.
 */
const TEXT_MODEL_PREFERENCE = [
  // 3.1 Flash-Lite first by request. Note there is no plain `gemini-3.1-flash`
  // text model - the 3.1 line ships Flash-Lite for text/vision, and its other
  // Flash variants are live-audio, TTS and image generation.
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro'
]

/**
 * Preferred video models. Keyframe interpolation (a start image AND an end
 * image) is a Veo 3.1 feature - earlier Veo models accept only a single start
 * image and will reject or ignore `lastFrame`, so the fallbacks stay on 3.1+.
 *
 * CHEAPEST FIRST, deliberately. At 5 seconds a clip these cost roughly $0.25
 * (lite), $0.50 (fast) and $2.00 (standard) at 720p, and the premium tiers
 * mostly buy photorealism and cinematic detail - exactly what this pipeline's
 * prompt forbids. Defaulting to standard would charge 8x for capability the
 * [AVOID] line then suppresses. Override with GEMINI_VIDEO_MODEL for a
 * deliberately expensive final render.
 */
const VIDEO_MODEL_PREFERENCE = [
  // Omni Flash first, by request, for testing. It is a DIFFERENT API surface
  // (Interactions, synchronous) and takes only ONE image - so it cannot pin a
  // last frame at all. That suits guide mode and rules it out for chained
  // seams; see startVideo, which branches on the model id.
  'gemini-omni-flash-preview',
  'veo-3.1-lite-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview'
]

/** An explicit env override is honoured verbatim and skips discovery entirely -
 * if you name a model, you get that model, including its errors. */
export const TEXT_MODEL_OVERRIDE = process.env.GEMINI_TEXT_MODEL?.trim() || null
export const VIDEO_MODEL_OVERRIDE = process.env.GEMINI_VIDEO_MODEL?.trim() || null

/** What to show in the UI before any key has been used to discover the truth. */
export const TEXT_MODEL = TEXT_MODEL_OVERRIDE ?? TEXT_MODEL_PREFERENCE[0]
export const VIDEO_MODEL = VIDEO_MODEL_OVERRIDE ?? VIDEO_MODEL_PREFERENCE[0]

export class GeminiError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

/**
 * A key typed into settings WINS over the env var.
 *
 * The reverse (env-first) seems safer but is actively hostile: a stale key left
 * in .env.local silently shadows the one the user just pasted, and every
 * request keeps failing with an auth error against a key they cannot see and
 * did not choose. Explicit beats ambient - if someone takes the trouble to
 * enter a key, that is the key they mean. The env var remains the default for
 * deployments, where nobody types anything.
 */
export function resolveKey(userKey?: string): string {
  const key = userKey?.trim() || process.env.GEMINI_API_KEY
  if (!key) {
    throw new GeminiError(
      'No Gemini API key. Enter one in Settings, or set GEMINI_API_KEY in .env.local.',
      401
    )
  }
  return key
}

export function hasServerKey(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/**
 * Overloaded or flaky upstream: worth retrying, and worth trying a DIFFERENT
 * model, because saturation is per-model.
 */
export function isOverloaded(e: unknown): boolean {
  return e instanceof GeminiError && [500, 503, 504].includes(e.status)
}

/**
 * Rate limited / out of quota. Deliberately NOT treated like overload: quota is
 * billed per project, not per model, so retrying and failing over just burns
 * time and quota to arrive at the same answer. Veo in particular is commonly
 * unavailable on a free-tier key, and telling someone "everything is busy" when
 * they actually have no quota sends them to wait for a spike that will never
 * pass.
 */
export function isRateLimited(e: unknown): boolean {
  return e instanceof GeminiError && e.status === 429
}

export function isTransient(e: unknown): boolean {
  return isOverloaded(e)
}

/** Backoff between retries of the SAME model. Kept short because a person is
 * waiting on the other end of this; persistent overload fails over to a
 * different model instead (see withModel). */
const RETRY_DELAYS_MS = [1200, 3500]

/**
 * Per-attempt ceiling. node's fetch has NO default timeout, so a stalled
 * connection hangs forever: the request never completes, nothing appears in the
 * log, and the UI spins with no error. A board turn ships two PNGs, which is
 * exactly the kind of request that stalls. A definite failure beats an
 * indefinite wait - and a timeout is transient, so it retries and fails over
 * like any other blip.
 */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Board turns specifically. A healthy turn is 2-3s, so 20s is ~7x headroom and
 * still recovers fast when Google's backend hits a long tail.
 *
 * Ruled out as causes first: socket reuse (idle connections to this host answer
 * in <250ms even after 80s), and payload size (two sketch PNGs are ~1k image
 * tokens). What is left is upstream variance, and the honest response to that
 * is to give up quickly and retry rather than wait indefinitely.
 */
const BOARD_TIMEOUT_MS = 20_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function callOnce(
  path: string,
  key: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number }
): Promise<unknown> {
  const timeout = init?.timeoutMs ?? REQUEST_TIMEOUT_MS
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'x-goog-api-key': key,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout)
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    console.warn(
      `[gemini] ${timedOut ? 'TIMEOUT' : 'NETWORK'} ${path.split('?')[0]} after ${timeout}ms`
    )
    // 504 so it counts as transient: worth one retry, then a different model.
    throw new GeminiError(
      timedOut
        ? `Gemini did not respond within ${timeout / 1000}s.`
        : `Could not reach Gemini: ${e instanceof Error ? e.message : 'network error'}`,
      timedOut ? 504 : 502
    )
  }

  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }

  if (!res.ok) {
    // Google nests the useful part; surface it rather than a bare status code.
    const msg =
      (json as { error?: { message?: string } })?.error?.message ||
      (typeof json === 'object' && json && 'raw' in json ? String((json as { raw: string }).raw) : '') ||
      res.statusText
    // Logged as well as thrown: when a request fails over across models the
    // caller only sees the summary, and the individual reasons are what
    // actually explain it.
    console.warn(`[gemini] ${res.status} ${path.split('?')[0]} — ${String(msg).slice(0, 300)}`)
    throw new GeminiError(`Gemini ${res.status}: ${msg}`.slice(0, 600), res.status)
  }
  return json
}

/**
 * Every request goes through here. Transient failures - the "this model is
 * currently experiencing high demand" 503 in particular - are retried with
 * backoff rather than thrown at the user, because they usually clear in
 * seconds. Anything the caller can act on (bad key, bad request) fails
 * immediately.
 */
async function call(
  path: string,
  key: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number }
): Promise<unknown> {
  let last: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await callOnce(path, key, init)
    } catch (e) {
      last = e
      if (!isTransient(e) || attempt === RETRY_DELAYS_MS.length) throw e
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
  throw last
}

/* ---------- model discovery ---------- */

interface ListedModel {
  name: string
  supportedGenerationMethods?: string[]
}

/** Cached per key, for the life of the process. Discovery costs a round trip
 * and the answer does not change mid-session. Keyed by a short fingerprint so
 * the raw key is never used as a map key. */
const modelCache = new Map<string, { text?: string[]; video?: string[] }>()

const fingerprint = (key: string): string => `${key.slice(0, 6)}:${key.length}`

async function listModels(key: string): Promise<ListedModel[]> {
  const out: ListedModel[] = []
  let pageToken = ''

  // A key with many tuned models can page; two pages is plenty to find a base
  // model, and bounds the work if the token ever fails to advance.
  for (let page = 0; page < 3; page++) {
    const json = (await call(
      `/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      key
    )) as { models?: ListedModel[]; nextPageToken?: string }

    out.push(...(json.models ?? []))
    if (!json.nextPageToken) break
    pageToken = json.nextPageToken
  }
  return out
}

/** "models/gemini-3.7-flash" -> "gemini-3.7-flash" */
const bare = (name: string): string => name.replace(/^models\//, '')

/**
 * Pick the best model this key can actually call.
 *
 * Preference order first; if none of the preferred ids are visible, fall back to
 * ANY model the key can see that supports the required method and isn't an
 * obvious special-purpose variant. That last step is what keeps the app working
 * through a rename nobody told us about.
 */
async function resolve(
  key: string,
  kind: 'text' | 'video',
  preference: string[],
  method: string,
  match: RegExp,
  /** Strict callers need "confirmed" to MEAN confirmed, so a failed lookup
   * throws instead of quietly falling back. The settings check uses this; the
   * generation paths do not, so a transient blip doesn't block real work. */
  strict = false
): Promise<string[]> {
  const fp = fingerprint(key)
  const cached = modelCache.get(fp)?.[kind]
  if (cached?.length) return cached

  let available: ListedModel[]
  try {
    available = await listModels(key)
  } catch (e) {
    // A rejected key or a disabled API is the user's problem to fix and must
    // surface - falling back here would report a working model for a key that
    // cannot call anything. Only transient failures fall through.
    const status = e instanceof GeminiError ? e.status : 0
    if (strict || status === 400 || status === 401 || status === 403) throw e
    return preference
  }

  const usable = new Map<string, ListedModel>()
  for (const m of available) {
    if (!m.name) continue
    // Veo is not a generateContent model, so only filter on the method when the
    // API actually reports methods for that entry.
    const methods = m.supportedGenerationMethods
    if (methods && methods.length > 0 && !methods.includes(method)) continue
    usable.set(bare(m.name), m)
  }

  // The full ORDERED candidate list, not just a winner: an overloaded model
  // needs somewhere to fail over to, and re-deriving that per request would
  // mean re-listing models on every 503.
  const preferred = preference.filter((p) => usable.has(p))

  // Anything else the key can see that fits, newest-looking first, preferring
  // plain names over -lite / -preview / dated variants. This is what keeps the
  // app alive through a rename nobody announced.
  const discovered = [...usable.keys()]
    .filter((n) => match.test(n) && !preferred.includes(n))
    .sort((a, b) => {
      const score = (n: string): number =>
        (/-(lite|preview|exp|thinking)\b/.test(n) ? 1 : 0) + (/\d{3,}/.test(n) ? 1 : 0)
      return score(a) - score(b) || b.localeCompare(a)
    })

  const chosen = [...preferred, ...discovered]

  if (chosen.length === 0) {
    throw new GeminiError(
      `This API key cannot access any ${kind} model. Available: ${[...usable.keys()]
        .slice(0, 12)
        .join(', ') || '(none)'}`,
      403
    )
  }

  modelCache.set(fp, { ...modelCache.get(fp), [kind]: chosen })
  return chosen
}

/** Ordered fallbacks, best first. An override collapses this to one entry. */
export function textCandidates(key: string, strict = false): Promise<string[]> {
  if (TEXT_MODEL_OVERRIDE) return Promise.resolve([TEXT_MODEL_OVERRIDE])
  return resolve(
    key,
    'text',
    TEXT_MODEL_PREFERENCE,
    'generateContent',
    /^gemini-[\d.]+-(flash|pro)/,
    strict
  )
}

export function videoCandidates(key: string, strict = false): Promise<string[]> {
  if (VIDEO_MODEL_OVERRIDE) return Promise.resolve([VIDEO_MODEL_OVERRIDE])
  return resolve(key, 'video', VIDEO_MODEL_PREFERENCE, 'predictLongRunning', /^veo-/, strict)
}

export async function resolveTextModel(key: string, strict = false): Promise<string> {
  return (await textCandidates(key, strict))[0]
}

export async function resolveVideoModel(key: string, strict = false): Promise<string> {
  return (await videoCandidates(key, strict))[0]
}

/** A model that vanished mid-session invalidates the cache so the next call
 * re-discovers instead of failing forever. */
function forgetModel(key: string, kind: 'text' | 'video'): void {
  const fp = fingerprint(key)
  const entry = modelCache.get(fp)
  if (entry) modelCache.set(fp, { ...entry, [kind]: undefined })
}

/** True for the "this model is gone / not available to you" family of errors. */
function isModelGone(e: unknown): boolean {
  return (
    e instanceof GeminiError &&
    (e.status === 404 || e.status === 403) &&
    /model|not (available|found|supported)/i.test(e.message)
  )
}

/**
 * Run a call against the best available model, walking down the candidate list
 * when one is unusable.
 *
 * Two distinct failures both land here:
 *  - the model is GONE (404/403). The cache is dropped so the next request
 *    re-discovers rather than failing forever.
 *  - the model is OVERLOADED (503) and stayed overloaded through the retries in
 *    `call`. Another model is very unlikely to be saturated at the same moment,
 *    so moving down the list beats making the user wait and try again.
 *
 * An explicit env override collapses the list to one entry: naming a model
 * means you get that model, including its errors.
 */
async function withModel<T>(
  key: string,
  kind: 'text' | 'video',
  run: (model: string) => Promise<T>
): Promise<T> {
  /**
   * Video candidates are ordered CHEAPEST FIRST, so failing over walks UP in
   * price - a $0.25 render silently becoming a $2.00 one because the cheap
   * model was briefly busy is a surprise bill, not resilience. So overload does
   * not escalate for video; the user is told to retry or pick a tier
   * deliberately. Text models are within rounding error of each other, so they
   * fail over freely.
   */
  const escalateOnOverload = kind === 'text'
  const candidates = kind === 'text' ? await textCandidates(key) : await videoCandidates(key)
  let last: unknown

  const tried: string[] = []

  for (const model of candidates) {
    tried.push(model)
    try {
      return await run(model)
    } catch (e) {
      last = e

      // Quota is a project-level fact; another model does not have more of it.
      // Retrying or failing over just burns time to reach the same answer.
      if (isRateLimited(e)) throw e

      if (isModelGone(e)) {
        // A retired model leaves no choice but to move on, even for video.
        forgetModel(key, kind)
        console.warn(`[gemini] ${model} unavailable for ${kind}; trying the next candidate`)
        continue
      }

      if (isOverloaded(e)) {
        if (escalateOnOverload) continue
        // Video candidates are ordered cheapest-first, so "the next model" is a
        // pricier one. Silently turning a $0.25 render into a $2.00 one because
        // the cheap tier was briefly busy is a surprise bill, not resilience.
        throw new GeminiError(
          `${model} is busy. Not falling back to a pricier tier automatically — retry shortly, or set GEMINI_VIDEO_MODEL to pick one deliberately. (${
            e instanceof Error ? e.message : 'overloaded'
          })`,
          503
        )
      }

      throw e
    }
  }

  if (isOverloaded(last) || last === undefined) {
    // Keep the upstream wording. A generic "everything is busy" hides whether
    // this was overload, quota, or something else - which is exactly what makes
    // a failure undiagnosable from the outside.
    const detail = last instanceof Error ? last.message : 'no response'
    throw new GeminiError(
      `No ${kind} model would serve this request (tried ${tried.length}: ${tried.join(
        ', '
      )}). Last error — ${detail}`,
      503
    )
  }
  throw last
}

/* ---------- text: prompt revision ---------- */

export async function reviseText(instruction: string, key: string): Promise<string> {
  const json = (await withModel(key, 'text', (model) =>
    call(`/models/${model}:generateContent`, key, {
      method: 'POST',
      body: {
        contents: [{ role: 'user', parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0.4 }
      }
    })
  )) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }

  const blocked = json.promptFeedback?.blockReason
  if (blocked) throw new GeminiError(`Gemini blocked the request (${blocked}).`, 422)

  const out = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()

  if (!out) throw new GeminiError('Gemini returned an empty revision.', 502)
  // Models sometimes fence the answer despite being told not to.
  return out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
}

/* ---------- board agents: vision + conversation ---------- */

export interface BoardTurnRequest {
  role: string
  topic: string
  objective: string
  /** The spec's canonical question, given as the agent's brief rather than a
   * script - it must ask about THIS, but in terms of what it can actually see. */
  briefQuestion: string
  intent: string
  styleNote: string
  imageA: string
  imageB: string
  /** Prior exchanges in this agent's thread, oldest first. */
  history: { question: string; answer: string }[]
  /** Facets of the remit this member should work through. */
  probes: string[]
  /**
   * This step's canonical three options. Used only when a reply arrives without
   * a usable option list - the spec's own wording beats a generic Yes/No, which
   * would ask the user to choose between meaningless alternatives.
   */
  fallbackOptions?: { key: string; text: string }[]
  /** Questions it must ask before it may commit. */
  minTurns: number
  /** Safe instruction to fall back on. NEVER the brief question - see below. */
  defaultDirective: string
  turnsRemaining: number
  /** No more questions allowed - commit a directive on this turn. Enforced in
   * code below, not merely requested in the prompt. */
  mustCommit?: boolean
}

export interface BoardTurnResponse {
  observation: string
  satisfied: boolean
  question?: string
  options?: { key: string; text: string }[]
  directive?: string
}

/** Forces the agent to answer in a shape the UI can render without parsing prose. */
const BOARD_SCHEMA = {
  type: 'object',
  properties: {
    observation: { type: 'string' },
    satisfied: { type: 'boolean' },
    question: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, text: { type: 'string' } },
        required: ['key', 'text']
      }
    },
    directive: { type: 'string' }
  },
  required: ['observation', 'satisfied']
} as const

/**
 * The schema used while an agent still owes questions.
 *
 * It has NO `satisfied` and NO `directive` field, so committing is not
 * expressible - the model cannot decline to ask. Telling it not to commit was
 * tried and failed: every agent committed on turn one, was pushed back, and
 * committed again. Structured output is a contract, so the fix is to remove the
 * option from the contract rather than argue with the model about it.
 */
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    observation: { type: 'string' },
    question: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, text: { type: 'string' } },
        required: ['key', 'text']
      }
    }
  },
  required: ['observation', 'question', 'options']
} as const

/**
 * Last-resort directive when an agent is forced to commit and still gives
 * nothing usable: restate what the user actually chose. Blunt, but it is their
 * own words and it keeps the compiled prompt truthful.
 */
function summariseHistory(req: BoardTurnRequest): string {
  const answers = req.history.map((h) => h.answer.trim()).filter(Boolean)
  // Falling back to briefQuestion here was a bug: it put a QUESTION into the
  // prompt sent to the video model, where it directed nothing at all.
  // The route always supplies defaultDirective, but a directive is what ends up
  // in a paid video prompt - so never let a missing one become `undefined`
  // there.
  if (answers.length === 0) return req.defaultDirective || 'Keep the motion simple and consistent.'
  return answers.map((a) => (a.endsWith('.') ? a : `${a}.`)).join(' ')
}

/**
 * One turn of one board member. The agent is shown BOTH keyframes and keeps
 * asking follow-ups until it is satisfied it understands the shot - at which
 * point it stops asking and writes the directive that Stage 2 compiles in.
 *
 * `turnsRemaining` is passed into the prompt rather than only enforced in code:
 * an agent told it is on its last turn will commit to a directive instead of
 * opening a new line of questioning it cannot finish.
 */
export async function boardTurn(
  req: BoardTurnRequest,
  key: string
): Promise<BoardTurnResponse> {
  /**
   * While the agent still owes questions it is given a schema with no way to
   * say "satisfied", so it must ask. This replaced a politely-worded retry that
   * did not work: the logs showed every agent committing on turn one, being
   * pushed back, and committing again - two round trips to arrive at the same
   * unwanted answer.
   */
  const mustAsk = !req.mustCommit && req.history.length < req.minTurns
  return boardTurnOnce({ ...req, mustAsk }, key)
}

async function boardTurnOnce(
  req: BoardTurnRequest & { extraInstruction?: string; mustAsk?: boolean },
  key: string
): Promise<BoardTurnResponse> {
  const transcript = req.history.length
    ? req.history.map((h, i) => `Q${i + 1}: ${h.question}\nUser: ${h.answer}`).join('\n\n')
    : '(no questions asked yet)'

  const system = `You are ${req.role} on the board of a 2D hand-drawn animation studio. Your remit is ${req.topic}: ${req.objective}

You are looking at the two keyframes of a single 5-second clip. IMAGE 1 is the START frame (Image A). IMAGE 2 is the END frame (Image B). The animation must begin exactly at Image A and finish exactly at Image B.

The brief you must resolve is: "${req.briefQuestion}"

The user's stated motion intent: ${req.intent.trim() || '(none given — infer it from the drawings)'}
The drawing style: ${req.styleNote.trim() || '(raw hand-drawn sketch)'}

Conversation so far with the user:
${transcript}

Facets of your remit to work through, one per question, in whatever order suits the shot:
${(req.probes ?? []).map((p) => `- ${p}`).join('\n')}

${
    req.mustCommit
      ? 'THIS IS YOUR FINAL TURN. Do NOT ask another question. Set satisfied=true and write your directive now, using your best reading of the answers above.'
      : req.mustAsk
        ? `This is question ${req.history.length + 1} of at least ${req.minTurns}. You are ASKING this turn - there is no way to finish yet, so put your effort into making the question worth asking.`
        : `You have asked ${req.history.length} question(s), which meets the minimum. Ask another if anything in your remit is still genuinely undecided, otherwise commit.`
  }

HOW TO WORK:
- Look at the two images first. "observation" must cite something concrete and specific you can actually see in them (a subject, a pose change, a position shift, a scale change, what is drawn in one frame but not the other). Never write a generic observation that would fit any drawing.
- ASSUME NOTHING. Every creative decision inside your remit must come from the user, not from you. If you find yourself thinking "they probably want X", that is a question you have not asked yet.
- Ask ONE question per turn, with EXACTLY THREE options keyed "A", "B", "C", and set satisfied=false.
- Questions must be SPECIFIC and grounded in this drawing. Name the actual thing you can see — the subject, the limb, the object, the part of frame. "How should the camera react?" is worthless; "The player is on the left and the goal is on the right — should the camera hold wide so both stay in frame, or track him rightward?" is a real question.
- Options must be concrete alternatives that would visibly differ on screen, and mutually exclusive. Never offer vague or overlapping choices, and never repeat an option the user already rejected.
- Work through your listed facets. Each new question should open a DIFFERENT facet rather than re-asking the same one in other words.
- Do not ask about anything outside your remit; another board member covers it.
- Do not re-ask something the user already answered above.
- Only once you have asked at least ${req.minTurns} questions AND genuinely have no remaining ambiguity in your remit may you set satisfied=true and write "directive".
- "directive" is one or two imperative sentences telling a video model exactly how to handle your remit for this shot. Reference what is actually in the frames. It is inserted verbatim into a prompt, so no preamble, no markdown, no mention of the user or this conversation.
- Never propose 3D, photorealism, relighting, shading or gradients. The output stays flat 2D hand-drawn line art.

Answer as JSON matching the schema. When satisfied=true, omit question and options. When satisfied=false, omit directive.${
    req.extraInstruction ? `\n\n${req.extraInstruction}` : ''
  }`

  const json = (await withModel(key, 'text', (model) =>
    call(`/models/${model}:generateContent`, key, {
      method: 'POST',
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'IMAGE 1 — START frame (Image A):' },
              { inlineData: { mimeType: 'image/png', data: req.imageA } },
              { text: 'IMAGE 2 — END frame (Image B):' },
              { inlineData: { mimeType: 'image/png', data: req.imageB } },
              {
                text: req.history.length
                  ? 'Given the answers above, either ask your next question or commit to your directive.'
                  : 'Study both frames, then ask your first question.'
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.6,
          responseMimeType: 'application/json',
          responseSchema: req.mustAsk ? QUESTION_SCHEMA : BOARD_SCHEMA
          // No thinking_level here on purpose. It was tried and rejected with
          // `Unknown name "thinking_level"` on this endpoint, and it bought
          // nothing anyway: gemini-3.1-flash-lite already defaults to minimal
          // thinking. Do not re-add a generationConfig field without checking it
          // against the live API first - an unknown field fails the WHOLE
          // request, so a speculative addition breaks a working path outright.
        }
      },
      timeoutMs: BOARD_TIMEOUT_MS
    })
  )) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    promptFeedback?: { blockReason?: string }
  }

  const blocked = json.promptFeedback?.blockReason
  if (blocked) throw new GeminiError(`Gemini blocked the request (${blocked}).`, 422)

  const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  if (!raw) throw new GeminiError('The board member returned nothing.', 502)

  let parsed: BoardTurnResponse
  try {
    parsed = JSON.parse(raw) as BoardTurnResponse
  } catch {
    throw new GeminiError('The board member returned malformed JSON.', 502)
  }

  // Normalise before it reaches the UI. A satisfied turn with no directive, or
  // an unsatisfied turn with no usable question, would both strand the user.
  const options = (parsed.options ?? [])
    .filter((o) => o?.text?.trim())
    .slice(0, 3)
    .map((o, i) => ({ key: ['A', 'B', 'C'][i], text: o.text.trim() }))

  // Answering under QUESTION_SCHEMA there is no `satisfied` field at all, so a
  // missing one means "asking", not "finished".
  if (req.mustAsk) {
    return {
      observation: parsed.observation?.trim() ?? '',
      satisfied: false,
      question: parsed.question?.trim() || req.briefQuestion,
      // A malformed option list would leave the user with nothing to click, so
      // fall back to this step's own canonical choices.
      options: options.length === 3 ? options : (req.fallbackOptions ?? []).slice(0, 3)
    }
  }

  // HARD STOP. The prompt asks the agent to commit; this guarantees it. Without
  // this the follow-up loop is unbounded and a chatty agent can keep a user
  // answering questions indefinitely.
  if (req.mustCommit && !parsed.satisfied) {
    return {
      observation: parsed.observation?.trim() ?? '',
      satisfied: true,
      directive: parsed.directive?.trim() || summariseHistory(req)
    }
  }

  if (!parsed.satisfied && (!parsed.question?.trim() || options.length < 3)) {
    // The agent wanted to continue but produced an unusable question. Treat it
    // as done rather than showing an empty prompt with no way forward.
    return {
      observation: parsed.observation ?? '',
      satisfied: true,
      directive: parsed.directive?.trim() || req.defaultDirective
    }
  }

  if (parsed.satisfied && !parsed.directive?.trim()) {
    throw new GeminiError('The board member finished without a directive.', 502)
  }

  return {
    observation: parsed.observation?.trim() ?? '',
    satisfied: parsed.satisfied,
    question: parsed.question?.trim(),
    options,
    directive: parsed.directive?.trim()
  }
}

/* ---------- describing a frame ---------- */

/**
 * Describe a drawn keyframe in prose.
 *
 * In 'guide' mode the video model never sees the end frame, so this text is the
 * ENTIRE channel through which the intended destination reaches it. Kept short
 * and physical: a video model acts on what is depicted, not on adjectives.
 */
export async function describeFrame(image: string, intent: string, key: string): Promise<string> {
  const system = `You describe a single moment from a hand-drawn 2D animation.

Write ONE or TWO plain sentences stating what is depicted: where the subject is, what pose it holds, and what has just happened or is about to happen. Present tense.

RULES:
- Describe only what you can actually see. Invent nothing.
- Be concrete and physical: positions, poses, contact, direction of travel. No mood, no style adjectives, no interpretation.
- Never mention drawing, sketching, lines, paper, frames, images, or the storyboard itself.
- No preamble, no markdown. Output the description only.${
    intent.trim() ? `\n\nFor context, the shot is meant to show: ${intent.trim()}` : ''
  }`

  const json = (await withModel(key, 'text', (model) =>
    call(`/models/${model}:generateContent`, key, {
      method: 'POST',
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/png', data: image } },
              { text: 'Describe this moment.' }
            ]
          }
        ],
        generationConfig: { temperature: 0.3 }
      },
      timeoutMs: BOARD_TIMEOUT_MS
    })
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }

  const out = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  if (!out) throw new GeminiError('Could not describe the end frame.', 502)
  return out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
}

/* ---------- video: keyframe interpolation ---------- */

export interface StartVideoInput {
  prompt: string
  /** Bare base64 PNG (no data: prefix). */
  imageA: string
  /** End frame. Omit to leave the ending unconstrained - see the note at the
   * `lastFrame` call site below. */
  imageB?: string
  aspectRatio?: string
  negativePrompt?: string
}

/**
 * Kick off generation. Veo is long-running: this returns an operation name that
 * must be polled. `lastFrame` is what makes it an interpolation between two
 * keyframes rather than an open-ended animation from one.
 */
/** The style constraints we want enforced. Sent as `negativePrompt` when the
 * model supports it, and folded into the prompt text when it does not - the
 * constraint matters more than the mechanism. */
const DEFAULT_NEGATIVE = [
  // Style guards.
  '3D render',
  'photorealistic',
  'live action',
  'lighting shifts',
  'gradients',
  'soft shading',
  'text overlays',
  'watermark',
  // Transition guards. The failure mode these exist for: the model animates
  // freely, then dissolves onto the target last frame instead of moving into
  // it. Naming the artefacts explicitly is the strongest lever available,
  // because a negative prompt is weighted more heavily than prose.
  'crossfade',
  'dissolve',
  'fade in',
  'fade out',
  'morph blend',
  'ghosting',
  'double exposure',
  'onion skin overlay',
  'jump cut',
  'snap to pose',
  'freeze frame',
  'looping motion',
  'reversed motion',
  'stuttering'
].join(', ')

/**
 * Which optional parameter a "not supported" 400 is complaining about.
 * Google phrases it as: `negativePrompt` isn't supported by this model.
 */
function unsupportedParam(e: unknown): string | null {
  if (!(e instanceof GeminiError) || e.status !== 400) return null
  const m = e.message.match(/[`"']?(\w+)[`"']?\s+(?:isn't|is not)\s+supported/i)
  return m ? m[1] : null
}

/**
 * What a start request produced. Veo is long-running and returns an operation
 * to poll; Omni Flash answers synchronously with the video itself, either
 * inline or behind a file URI. Callers branch on `kind` rather than assuming.
 */
export type StartResult =
  | { kind: 'operation'; operation: string }
  | { kind: 'uri'; uri: string }
  | { kind: 'inline'; data: string; mimeType: string }

const OMNI_PREFIX = 'gemini-omni'
export const isOmniModel = (model: string): boolean => model.startsWith(OMNI_PREFIX)

/**
 * Gemini Omni Flash, via the Interactions API.
 *
 * A completely different surface from Veo: POST /interactions, a flat `input`
 * array of typed parts, and a synchronous reply containing a `steps` timeline.
 * Notably it takes only ONE image, so there is no last-frame pinning here at
 * all - which suits guide mode exactly, and rules it out for chained seams.
 */
async function startOmni(
  model: string,
  input: StartVideoInput,
  key: string
): Promise<StartResult> {
  const prompt = `${input.prompt}\n\n[AVOID]: ${input.negativePrompt ?? DEFAULT_NEGATIVE}.`

  const json = (await call('/interactions', key, {
    method: 'POST',
    body: {
      model,
      input: [
        { type: 'image', data: input.imageA, mime_type: 'image/png' },
        { type: 'text', text: prompt }
      ],
      response_format: {
        type: 'video',
        aspect_ratio: input.aspectRatio ?? '16:9'
      }
    },
    // Synchronous generation, so this waits for the whole render rather than
    // for an acknowledgement.
    timeoutMs: 5 * 60 * 1000
  })) as {
    steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string; uri?: string }[] }[]
    status?: string
  }

  // Walk the timeline for the first video part, rather than assuming its index:
  // the steps list also carries user_input and thought entries.
  for (const step of json.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.type !== 'video') continue
      if (part.uri) return { kind: 'uri', uri: part.uri }
      if (part.data) return { kind: 'inline', data: part.data, mimeType: part.mime_type ?? 'video/mp4' }
    }
  }

  throw new GeminiError(
    `Omni Flash returned no video (status: ${json.status ?? 'unknown'}). See lib/server/gemini.ts if the response shape has changed.`,
    502
  )
}

export async function startVideo(input: StartVideoInput, key: string): Promise<StartResult> {
  // Optional knobs, dropped one at a time as the API rejects them. Veo revisions
  // differ in which they accept, and hardcoding a set that works today just
  // moves the 400 to the next person's model.
  const optional: Record<string, unknown> = {
    aspectRatio: input.aspectRatio ?? '16:9',
    negativePrompt: input.negativePrompt ?? DEFAULT_NEGATIVE,
    personGeneration: 'allow_adult'
  }

  const send = (): Promise<unknown> =>
    withModel(key, 'video', (model) =>
      // Two entirely different APIs behind one call site.
      isOmniModel(model)
        ? startOmni(model, input, key)
        : call(`/models/${model}:predictLongRunning`, key, {
        method: 'POST',
        body: {
          instances: [
            {
              // If negativePrompt got dropped, its content moves into the prompt
              // so "no 3D, no photorealism" is still actually asked for.
              prompt:
                'negativePrompt' in optional
                  ? input.prompt
                  : `${input.prompt}\n\n[AVOID]: ${input.negativePrompt ?? DEFAULT_NEGATIVE}.`,
              image: { bytesBase64Encoded: input.imageA, mimeType: 'image/png' },
              // `lastFrame` is a HARD constraint: supply it and Veo must land on
              // that exact image, reconciling any divergence with a snap, a
              // regression or a fade. Only sent when the caller genuinely needs
              // the clip pinned - i.e. when a following clip starts from it.
              ...(input.imageB
                ? { lastFrame: { bytesBase64Encoded: input.imageB, mimeType: 'image/png' } }
                : {})
            }
          ],
            parameters: { ...optional }
          }
        })
    )

  let json: unknown
  // One pass per optional parameter, worst case.
  for (let attempt = 0; ; attempt++) {
    try {
      json = await send()
      break
    } catch (e) {
      const param = unsupportedParam(e)
      if (!param || !(param in optional) || attempt > Object.keys(optional).length) throw e
      delete optional[param]
    }
  }

  // Omni already returned the finished video; Veo returned an operation name.
  const result = json as Partial<StartResult> & { name?: string }
  if (result.kind) return result as StartResult
  if (result.name) return { kind: 'operation', operation: result.name }
  throw new GeminiError('The video model returned neither an operation nor a video.', 502)
}

export interface PollResult {
  done: boolean
  videoUri?: string
  error?: string
}

/**
 * Walk an operation response for a video URI. The exact nesting has moved
 * between Veo revisions, so rather than hard-coding one path this searches the
 * response for the first plausible video reference. Tolerant by design: a
 * layout change should degrade to "not found", never to a wrong field.
 */
function findVideoUri(node: unknown, depth = 0): string | undefined {
  if (depth > 8 || node === null || typeof node !== 'object') return undefined

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findVideoUri(item, depth + 1)
      if (found) return found
    }
    return undefined
  }

  const obj = node as Record<string, unknown>
  // A video reference is a `video`/`_self` object carrying a uri, or a bare
  // uri/videoUri string alongside a mime type.
  for (const k of ['uri', 'videoUri', 'url']) {
    const v = obj[k]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }
  for (const v of Object.values(obj)) {
    const found = findVideoUri(v, depth + 1)
    if (found) return found
  }
  return undefined
}

export async function pollVideo(operation: string, key: string): Promise<PollResult> {
  // Operation names come back fully qualified ("models/.../operations/..."),
  // so they are appended to the base directly.
  const path = operation.startsWith('/') ? operation : `/${operation}`
  const json = (await call(path, key)) as {
    done?: boolean
    error?: { message?: string }
    response?: unknown
  }

  if (!json.done) return { done: false }
  if (json.error) return { done: true, error: json.error.message ?? 'Generation failed.' }

  const uri = findVideoUri(json.response)
  if (!uri) {
    return {
      done: true,
      error:
        'Generation finished but no video URI was found in the response. The Veo response shape may have changed — see lib/server/gemini.ts.'
    }
  }
  return { done: true, videoUri: uri }
}

/**
 * Fetch the finished video server-side. The download URL needs the API key, and
 * the key must not reach the browser, so the bytes are proxied through us.
 */
export async function fetchVideo(uri: string, key: string): Promise<Response> {
  if (!/^https:\/\/[a-z0-9.-]*googleapis\.com\//i.test(uri)) {
    // Never let a caller turn this endpoint into an open proxy.
    throw new GeminiError('Refusing to fetch a video from a non-Google host.', 400)
  }
  const res = await fetch(uri, { headers: { 'x-goog-api-key': key }, cache: 'no-store' })
  if (!res.ok) {
    throw new GeminiError(`Video download failed: ${res.status} ${res.statusText}`, res.status)
  }
  return res
}
