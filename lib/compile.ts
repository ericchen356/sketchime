import { BOARD_STEPS } from './board'
import {
  CLIP_FPS,
  CLIP_SECONDS,
  type BoardStep,
  type BoardThread,
  type BoardThreads,
  type Clip
} from './types'

/** The default when the user hasn't described their own style. */
export const DEFAULT_STYLE_NOTE =
  'raw hand-drawn 2D sketch: visible pen strokes, uneven line weight, flat colour, no fill shading'

/** A step counts only once its agent has stopped asking and committed. */
export function isStepDone(thread: BoardThread | undefined): boolean {
  return !!thread?.satisfied && !!thread.directive?.trim()
}

export function isBoardComplete(board: BoardThreads): boolean {
  return BOARD_STEPS.every((s) => isStepDone(board[s.id]))
}

export function answeredCount(board: BoardThreads): number {
  return BOARD_STEPS.filter((s) => isStepDone(board[s.id])).length
}

/**
 * A directive is an instruction to a video model. Anything that reads as a
 * question is not one - it is almost certainly the board's own prompt text
 * leaking through a fallback, and shipping it would tell the model nothing.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (t.endsWith('?')) return true
  return /^(how|what|which|should|would|do|does|can|is|are|where|when|why)\b/i.test(t)
}

/**
 * What a step contributes to the prompt, sanitised. Applied at COMPILE time, not
 * just at capture time, so a board answered before this check existed is still
 * repaired rather than baking a question into the prompt forever.
 */
export function stepDirective(board: BoardThreads, step: BoardStep): string {
  const raw = board[step.id]?.directive?.trim() ?? ''
  if (!raw || looksLikeQuestion(raw) || raw === step.question) return step.defaultDirective
  return raw.endsWith('.') ? raw : `${raw}.`
}

/**
 * Stage 2: the Master Compiler. Turns the four board directives plus the user's
 * motion intent into the final image-to-video prompt.
 *
 * The five bracketed sections are fixed and ordered - they are the contract the
 * spec defines, and a video model reads them positionally as much as
 * semantically. Steps 1-3 are combined into one EASING & MOTION line and step 4
 * becomes ENVIRONMENT & EFFECTS, exactly as the spec directs.
 *
 * Returns null when any agent is still consulting: a half-finished board must
 * never silently produce a prompt with missing direction.
 */
export function compilePrompt(clip: Clip, styleNote: string): string | null {
  if (!isBoardComplete(clip.board)) return null

  const [director, cinematographer, animator, artDirector] = BOARD_STEPS.map((s) =>
    stepDirective(clip.board, s)
  )

  const style = styleNote.trim() || DEFAULT_STYLE_NOTE
  const intent = clip.intent.trim()

  const lines = [
    `[ART STYLE & INTEGRITY]: Strictly retain 2D hand-drawn ${style}. Preserve the exact stroke weight, line quality, medium and colour palette present in the Start and End frames. Clean background, strict stroke fidelity, zero 3D, zero photorealism, no relighting, no shading passes, no gradients.`,

    `[KEYFRAME TRANSITION]: Transition smoothly from the Start Frame (Image A pose/state) to the End Frame (Image B pose/state) over ${CLIP_SECONDS} seconds. The first frame must match Image A exactly and the final frame must match Image B exactly.${
      intent ? ` Motion intent: ${intent}.` : ''
    } Where intermediate features or anatomical structures are missing between the keyframes, draw them in using the exact stroke weight and drawing style of the source sketch.`,

    `[EASING & MOTION]: ${director} ${cinematographer} ${animator}`.replace(/\s+/g, ' ').trim(),

    `[ENVIRONMENT & EFFECTS]: ${artDirector}`,

    `[OUTPUT PARAMETERS]: ${CLIP_SECONDS}-second video clip, silent, ${CLIP_FPS}fps smooth 2D cartoon interpolation.`
  ]

  return lines.join('\n\n')
}

/** Which prompt actually goes to the video model. */
export function activePrompt(clip: Clip): string | undefined {
  return clip.useRevised && clip.revisedPrompt ? clip.revisedPrompt : clip.prompt
}

/**
 * The brief handed to Gemini when the user asks for a revision pass. It is
 * deliberately strict: the model may only tighten wording, never re-negotiate
 * the board's decisions or the fixed section structure.
 */
export function revisionInstruction(prompt: string, notes: string): string {
  return [
    'You are a prompt editor for a 2D hand-drawn animation pipeline.',
    'Rewrite the image-to-video prompt below so it reads more clearly and cinematically to a generative video model.',
    '',
    'HARD RULES — breaking any of these makes the output unusable:',
    '- Keep the five bracketed sections, their exact names, and their order.',
    '- Do not change the meaning of any creative decision already made.',
    `- Do not change the duration (${CLIP_SECONDS} seconds), frame rate (${CLIP_FPS}fps), or the silent, 2D, hand-drawn constraints.`,
    '- Never introduce 3D, photorealism, relighting, shading or gradients.',
    '- Output ONLY the rewritten prompt. No preamble, no commentary, no markdown fences.',
    notes.trim() ? `\nExtra direction from the user: ${notes.trim()}` : '',
    '',
    '--- PROMPT TO REVISE ---',
    prompt
  ]
    .filter(Boolean)
    .join('\n')
}
