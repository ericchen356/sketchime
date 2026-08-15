/**
 * Browser side of the Gemini integration. Talks only to our own routes - the
 * API key either lives in the server env or is passed through from the settings
 * dialog, and is never sent anywhere except our own origin.
 */

/** Session-only, per the no-persistence rule: cleared when the tab closes. */
const KEY_STORAGE = 'sketchime.gemini.key'

export function loadApiKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key.trim()) window.sessionStorage.setItem(KEY_STORAGE, key.trim())
    else window.sessionStorage.removeItem(KEY_STORAGE)
  } catch {
    /* private mode - the key just won't survive a reload */
  }
}

export interface ServerConfig {
  hasServerKey: boolean
  textModel: string
  videoModel: string
  /** False = these are just the preferred defaults; true = confirmed against
   * the key by asking Google what it can actually call. */
  resolved: boolean
  textOverridden?: boolean
  videoOverridden?: boolean
}

export async function fetchConfig(): Promise<ServerConfig> {
  const res = await fetch('/api/config', { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not read server config.')
  return (await res.json()) as ServerConfig
}

/** Ask which models this key can really use. Model ids get retired, and older
 * ones get closed to new keys while still working for existing ones, so the
 * answer differs per key and is worth checking rather than assuming. */
export async function resolveModels(apiKey: string): Promise<ServerConfig> {
  return postJson<ServerConfig>('/api/config', { apiKey })
}

async function postJson<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Without this a stalled request spins the UI forever with no error and
      // nothing to click. Better a definite failure than an indefinite wait.
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new Error(
      timedOut
        ? `No response after ${Math.round((timeoutMs ?? 0) / 1000)}s. The model may be busy — try again.`
        : 'Could not reach the server.'
    )
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`)
  return json
}

/** A board turn sends two PNGs and waits on a vision model; generous, but
 * finite. */
const BOARD_TIMEOUT_MS = 75_000

export async function revisePrompt(instruction: string, apiKey: string): Promise<string> {
  const { revised } = await postJson<{ revised: string }>('/api/revise', { instruction, apiKey })
  return revised
}

export interface GenerateInput {
  prompt: string
  imageA: string
  /** Omit to leave the ending unconstrained (guide mode). */
  imageB?: string
  apiKey: string
  /** Called with the operation name as soon as generation is accepted, so the
   * caller can persist it and survive a re-render. */
  onOperation?(name: string): void
  /** Cooperative cancellation - polling stops when this returns true. */
  isCancelled?(): boolean
}

/** How often to ask whether the render is done. Veo takes on the order of
 * minutes, so a tight poll would just burn quota. */
const POLL_MS = 8000
/** Give up after this long rather than polling forever on a stuck operation. */
const POLL_TIMEOUT_MS = 10 * 60 * 1000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Full generation lifecycle: start, poll to completion, then pull the bytes
 * through our proxy.
 *
 * Returns the BLOB, not just an object URL: the caller needs the bytes to
 * persist the video, and an object URL cannot be turned back into them once the
 * page reloads. The caller creates (and revokes) its own URL.
 */
export async function generateClip(input: GenerateInput): Promise<Blob> {
  const started = await postJson<{
    kind?: 'operation' | 'uri' | 'inline'
    operation?: string
    uri?: string
    data?: string
    mimeType?: string
  }>('/api/veo', {
    action: 'start',
    prompt: input.prompt,
    imageA: input.imageA,
    imageB: input.imageB,
    apiKey: input.apiKey
  })

  // Omni Flash renders synchronously, so the video may already be here and
  // there is nothing to poll for.
  if (started.kind === 'inline' && started.data) {
    return base64ToBlob(started.data, started.mimeType ?? 'video/mp4')
  }
  if (started.kind === 'uri' && started.uri) {
    return fetchVideoBlob(started.uri, input.apiKey)
  }

  const operation = started.operation
  if (!operation) throw new Error('The video model returned nothing to wait on.')
  input.onOperation?.(operation)

  const deadline = Date.now() + POLL_TIMEOUT_MS
  let uri: string | undefined

  for (;;) {
    if (input.isCancelled?.()) throw new Error('Cancelled.')
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the video (10 min). The operation may still finish.')
    }

    await sleep(POLL_MS)
    if (input.isCancelled?.()) throw new Error('Cancelled.')

    const res = await postJson<{ done: boolean; videoUri?: string; error?: string }>('/api/veo', {
      action: 'poll',
      operation,
      apiKey: input.apiKey
    })
    if (res.error) throw new Error(res.error)
    if (res.done) {
      uri = res.videoUri
      break
    }
  }

  if (!uri) throw new Error('Generation finished without a video.')
  return fetchVideoBlob(uri, input.apiKey)
}

/** Decode an inline base64 video without round-tripping through the network. */
function base64ToBlob(data: string, mimeType: string): Blob {
  const bytes = atob(data)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  return new Blob([buf], { type: mimeType })
}

/** Pull the finished video through our proxy - the download URL needs the API
 * key, which must not reach the browser. */
async function fetchVideoBlob(uri: string, apiKey: string): Promise<Blob> {
  const res = await fetch('/api/veo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'fetch', uri, apiKey })
  })
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(msg.error || `Video download failed (${res.status}).`)
  }
  return res.blob()
}

/* ---------- board agents ---------- */

export interface BoardTurnPayload {
  role: string
  topic: string
  objective: string
  briefQuestion: string
  intent: string
  styleNote: string
  imageA: string
  imageB: string
  history: { question: string; answer: string }[]
  defaultDirective: string
  probes: string[]
  fallbackOptions: { key: string; text: string }[]
  minTurns: number
  turnsRemaining: number
  /** Forbid another question; the agent must commit this turn. */
  mustCommit?: boolean
  apiKey: string
}

export interface BoardTurnReply {
  observation: string
  satisfied: boolean
  question?: string
  options?: { key: string; text: string }[]
  directive?: string
}

/**
 * Rough USD per second of 720p video, by model. Only used to warn the user what
 * a click will cost - Google is the source of truth for billing, and an unknown
 * model reports as unknown rather than guessing a number.
 */
const VIDEO_PRICE_PER_SEC: Record<string, number> = {
  // Omni Flash pricing was not published on the model page at time of writing,
  // so it is deliberately absent: the UI says "unknown" rather than inventing a
  // number for something that bills real money.
  'veo-3.1-lite-generate-preview': 0.05,
  'veo-3.1-fast-generate-preview': 0.1,
  'veo-3.1-generate-preview': 0.4
}

/** Estimated cost of one clip, or null when the model isn't in the table. */
export function estimateClipCost(model: string | undefined, seconds: number): number | null {
  const rate = model ? VIDEO_PRICE_PER_SEC[model] : undefined
  return rate === undefined ? null : rate * seconds
}

/** Describe a keyframe in prose. In guide mode this is the only way the end
 * frame's content reaches the video model. */
export async function describeFrame(
  image: string,
  intent: string,
  apiKey: string
): Promise<string> {
  const { description } = await postJson<{ description: string }>(
    '/api/describe',
    { image, intent, apiKey },
    BOARD_TIMEOUT_MS
  )
  return description
}

/** Ask one board member for its next move: another question, or its directive. */
export async function askBoard(payload: BoardTurnPayload): Promise<BoardTurnReply> {
  return postJson<BoardTurnReply>('/api/board', payload, BOARD_TIMEOUT_MS)
}
