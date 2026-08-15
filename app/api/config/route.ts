import { NextResponse } from 'next/server'
import { hasServerKey, TEXT_MODEL, VIDEO_MODEL } from '@/lib/server/gemini'

export const dynamic = 'force-dynamic'

/** Lets the UI tell the user whether a key is already configured server-side,
 * so it only nags for one when it actually needs one. Never returns the key. */
export function GET(): NextResponse {
  return NextResponse.json({
    hasServerKey: hasServerKey(),
    textModel: TEXT_MODEL,
    videoModel: VIDEO_MODEL
  })
}
