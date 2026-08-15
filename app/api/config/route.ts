import { NextResponse } from 'next/server'
import {
  GeminiError,
  hasServerKey,
  resolveKey,
  resolveTextModel,
  resolveVideoModel,
  TEXT_MODEL,
  TEXT_MODEL_OVERRIDE,
  VIDEO_MODEL,
  VIDEO_MODEL_OVERRIDE
} from '@/lib/server/gemini'

export const dynamic = 'force-dynamic'

/** Lets the UI tell the user whether a key is already configured server-side,
 * so it only nags for one when it actually needs one. Never returns the key. */
export function GET(): NextResponse {
  return NextResponse.json({
    hasServerKey: hasServerKey(),
    textModel: TEXT_MODEL,
    videoModel: VIDEO_MODEL,
    resolved: false
  })
}

/**
 * Same, but with a key: asks Google which models this key can ACTUALLY call and
 * reports the ones that were picked. Model ids move and older ones get closed
 * off to new keys, so "what will this key really use" is worth showing rather
 * than guessing at.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let apiKey: string | undefined
  try {
    ;({ apiKey } = (await req.json()) as { apiKey?: string })
  } catch {
    /* no body is fine - fall through to the env key */
  }

  try {
    const key = resolveKey(apiKey)
    // Text is strict: if this key cannot list models, the user needs to know
    // now rather than half-way through a board. Video is best-effort - Veo
    // access is a separate entitlement, and lacking it should not block the
    // board, which only needs the text model.
    const textModel = await resolveTextModel(key, true)
    const videoModel = await resolveVideoModel(key).catch(() => VIDEO_MODEL)
    return NextResponse.json({
      hasServerKey: hasServerKey(),
      textModel,
      videoModel,
      resolved: true,
      textOverridden: !!TEXT_MODEL_OVERRIDE,
      videoOverridden: !!VIDEO_MODEL_OVERRIDE
    })
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not resolve models.' },
      { status }
    )
  }
}
