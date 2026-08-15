import { NextResponse } from 'next/server'
import { boardTurn, GeminiError, resolveKey, type BoardTurnRequest } from '@/lib/server/gemini'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = Partial<BoardTurnRequest> & { apiKey?: string }

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  if (!body.role || !body.briefQuestion) {
    return NextResponse.json({ error: 'Missing board step definition.' }, { status: 400 })
  }
  if (!body.imageA || !body.imageB) {
    return NextResponse.json(
      { error: 'The board needs both keyframes to look at.' },
      { status: 400 }
    )
  }

  try {
    const result = await boardTurn(
      {
        role: body.role,
        topic: body.topic ?? '',
        objective: body.objective ?? '',
        briefQuestion: body.briefQuestion,
        intent: body.intent ?? '',
        styleNote: body.styleNote ?? '',
        imageA: body.imageA,
        imageB: body.imageB,
        history: body.history ?? [],
        turnsRemaining: Math.max(1, body.turnsRemaining ?? 1)
      },
      resolveKey(body.apiKey)
    )
    return NextResponse.json(result)
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The board member failed to respond.' },
      { status }
    )
  }
}
