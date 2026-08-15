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

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Text model, used for the prompt-revision pass. */
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash'

/**
 * Video model. Keyframe interpolation (a start image AND an end image) is a Veo
 * 3.1 feature - earlier Veo models accept only a single start image and will
 * reject or ignore `lastFrame`. Override with GEMINI_VIDEO_MODEL if Google
 * renames the preview.
 */
export const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL ?? 'veo-3.1-generate-preview'

export class GeminiError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

/** Env var wins over a user-supplied key, so a hosted deployment can keep the
 * key entirely server-side. */
export function resolveKey(userKey?: string): string {
  const key = process.env.GEMINI_API_KEY || userKey?.trim()
  if (!key) {
    throw new GeminiError(
      'No Gemini API key. Set GEMINI_API_KEY in .env.local, or enter a key in the app settings.',
      401
    )
  }
  return key
}

export function hasServerKey(): boolean {
  return !!process.env.GEMINI_API_KEY
}

async function call(
  path: string,
  key: string,
  init?: { method?: string; body?: unknown }
): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'x-goog-api-key': key,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store'
  })

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
    throw new GeminiError(`Gemini ${res.status}: ${msg}`.slice(0, 600), res.status)
  }
  return json
}

/* ---------- text: prompt revision ---------- */

export async function reviseText(instruction: string, key: string): Promise<string> {
  const json = (await call(`/models/${TEXT_MODEL}:generateContent`, key, {
    method: 'POST',
    body: {
      contents: [{ role: 'user', parts: [{ text: instruction }] }],
      generationConfig: { temperature: 0.4 }
    }
  })) as {
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
  turnsRemaining: number
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

You have ${req.turnsRemaining} question(s) left before you MUST commit.

HOW TO WORK:
- Look at the two images first. "observation" must cite something concrete and specific you can actually see in them (a subject, a pose change, a position shift, a scale change, what is drawn in one frame but not the other). Never write a generic observation that would fit any drawing.
- If you genuinely still need information to direct your remit well, set satisfied=false and ask ONE question, with EXACTLY THREE options keyed "A", "B", "C". The options must be written for THIS drawing — name what you see in them. Never offer generic textbook choices.
- Do not ask about anything outside your remit; another board member covers it.
- Do not re-ask something the user already answered above.
- If the answers so far are enough, or you have 1 turn left, set satisfied=true and write "directive".
- "directive" is one or two imperative sentences telling a video model exactly how to handle your remit for this shot. Reference what is actually in the frames. It is inserted verbatim into a prompt, so no preamble, no markdown, no mention of the user or this conversation.
- Never propose 3D, photorealism, relighting, shading or gradients. The output stays flat 2D hand-drawn line art.

Answer as JSON matching the schema. When satisfied=true, omit question and options. When satisfied=false, omit directive.`

  const json = (await call(`/models/${TEXT_MODEL}:generateContent`, key, {
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
        responseSchema: BOARD_SCHEMA
      }
    }
  })) as {
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

  if (!parsed.satisfied && (!parsed.question?.trim() || options.length < 3)) {
    // The agent wanted to continue but produced an unusable question. Treat it
    // as done rather than showing an empty prompt with no way forward.
    return {
      observation: parsed.observation ?? '',
      satisfied: true,
      directive: parsed.directive?.trim() || req.briefQuestion
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

/* ---------- video: keyframe interpolation ---------- */

export interface StartVideoInput {
  prompt: string
  /** Bare base64 PNG (no data: prefix). */
  imageA: string
  imageB: string
  aspectRatio?: string
  negativePrompt?: string
}

/**
 * Kick off generation. Veo is long-running: this returns an operation name that
 * must be polled. `lastFrame` is what makes it an interpolation between two
 * keyframes rather than an open-ended animation from one.
 */
export async function startVideo(input: StartVideoInput, key: string): Promise<string> {
  const json = (await call(`/models/${VIDEO_MODEL}:predictLongRunning`, key, {
    method: 'POST',
    body: {
      instances: [
        {
          prompt: input.prompt,
          image: { bytesBase64Encoded: input.imageA, mimeType: 'image/png' },
          lastFrame: { bytesBase64Encoded: input.imageB, mimeType: 'image/png' }
        }
      ],
      parameters: {
        aspectRatio: input.aspectRatio ?? '16:9',
        negativePrompt:
          input.negativePrompt ??
          '3D render, photorealistic, live action, lighting shifts, gradients, soft shading, text overlays, watermark',
        personGeneration: 'allow_adult'
      }
    }
  })) as { name?: string }

  if (!json.name) throw new GeminiError('Gemini did not return an operation name.', 502)
  return json.name
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
