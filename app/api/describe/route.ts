import { NextResponse } from 'next/server'
import { describeFrame, GeminiError, resolveKey } from '@/lib/server/gemini'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Turn a keyframe into prose. Used for the end frame in 'guide' mode, where the
 * image itself is deliberately withheld from the video model and this text is
 * the only way its content gets across.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { image?: string; intent?: string; apiKey?: string }
    if (!body.image) {
      return NextResponse.json({ error: 'No frame to describe.' }, { status: 400 })
    }
    const description = await describeFrame(body.image, body.intent ?? '', resolveKey(body.apiKey))
    return NextResponse.json({ description })
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not describe the frame.' },
      { status }
    )
  }
}
