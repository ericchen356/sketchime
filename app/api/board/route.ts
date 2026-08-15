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

  const started = Date.now()
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
        probes: body.probes ?? [],
        minTurns: Math.max(1, body.minTurns ?? 1),
        defaultDirective: body.defaultDirective ?? 'Keep the motion simple and consistent.',
        turnsRemaining: Math.max(1, body.turnsRemaining ?? 1),
        mustCommit: !!body.mustCommit
      },
      resolveKey(body.apiKey)
    )
    // Names the agent and what it decided, so a slow or stuck board can be read
    // straight off the server log instead of guessed at.
    console.log(
      `[board] ${body.role} turn ${(body.history?.length ?? 0) + 1}` +
        `${body.mustCommit ? ' (must commit)' : ''} -> ${
          result.satisfied ? 'COMMITTED' : 'asked a question'
        } in ${Date.now() - started}ms`
    )
    return NextResponse.json(result)
  } catch (e) {
    console.warn(
      `[board] ${body.role} FAILED after ${Date.now() - started}ms — ${
        e instanceof Error ? e.message : 'unknown'
      }`
    )
    const status = e instanceof GeminiError ? e.status : 500
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The board member failed to respond.' },
      { status }
    )
  }
}
