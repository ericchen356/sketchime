import { NextResponse } from 'next/server'
import {
  fetchVideo,
  GeminiError,
  pollVideo,
  resolveKey,
  startVideo
} from '@/lib/server/gemini'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Body {
  action?: 'start' | 'poll' | 'fetch'
  apiKey?: string
  // start
  prompt?: string
  imageA?: string
  imageB?: string
  // poll
  operation?: string
  // fetch
  uri?: string
}

/**
 * One route, three actions, because they share key resolution and error
 * shaping. Generation is long-running: the client starts it, polls, then asks
 * us to proxy the finished bytes (the download URL needs the key, which must
 * never reach the browser).
 */
export async function POST(req: Request): Promise<NextResponse | Response> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  try {
    const key = resolveKey(body.apiKey)

    if (body.action === 'start') {
      if (!body.prompt?.trim()) {
        return NextResponse.json({ error: 'Missing prompt.' }, { status: 400 })
      }
      if (!body.imageA || !body.imageB) {
        return NextResponse.json(
          { error: 'Both keyframes are required for interpolation.' },
          { status: 400 }
        )
      }
      const operation = await startVideo(
        { prompt: body.prompt, imageA: body.imageA, imageB: body.imageB },
        key
      )
      return NextResponse.json({ operation })
    }

    if (body.action === 'poll') {
      if (!body.operation) {
        return NextResponse.json({ error: 'Missing operation name.' }, { status: 400 })
      }
      return NextResponse.json(await pollVideo(body.operation, key))
    }

    if (body.action === 'fetch') {
      if (!body.uri) return NextResponse.json({ error: 'Missing video uri.' }, { status: 400 })
      const upstream = await fetchVideo(body.uri, key)
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') ?? 'video/mp4',
          'Cache-Control': 'no-store'
        }
      })
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500
    const message = e instanceof Error ? e.message : 'Video request failed.'
    return NextResponse.json({ error: message }, { status })
  }
}
