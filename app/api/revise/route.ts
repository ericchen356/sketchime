import { NextResponse } from 'next/server'
import { GeminiError, resolveKey, reviseText } from '@/lib/server/gemini'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { instruction?: string; apiKey?: string }
    const instruction = body.instruction?.trim()
    if (!instruction) {
      return NextResponse.json({ error: 'Missing instruction.' }, { status: 400 })
    }

    const revised = await reviseText(instruction, resolveKey(body.apiKey))
    return NextResponse.json({ revised })
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500
    const message = e instanceof Error ? e.message : 'Revision failed.'
    return NextResponse.json({ error: message }, { status })
  }
}
