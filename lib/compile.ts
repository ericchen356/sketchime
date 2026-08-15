import { BOARD_STEPS } from './board'
import {
  CLIP_FPS,
  CLIP_SECONDS,
  type BoardStep,
  type BoardThread,
  type BoardThreads,
  type Clip,
  type EndFrameMode
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
/**
 * The transition brief. The two modes are not variations in wording - they
 * describe fundamentally different jobs.
 *
 * 'exact': the end frame is pinned through the API, so the model MUST land on
 * it. The goal is to make it arrive there by moving rather than by dissolving.
 *
 * 'guide': the end frame is never sent to the video model. It is described in
 * prose instead, and the clip is explicitly permitted - encouraged - to run out
 * mid-motion. This is the only way to remove the end-of-clip settle, because a
 * supplied last frame is a constraint no prompt can talk its way around.
 */
function transitionSection(clip: Clip, intent: string, mode: EndFrameMode): string {
  const motion = intent ? ` Motion intent: ${intent}.` : ''

  if (mode === 'exact') {
    return `[KEYFRAME TRANSITION]: One continuous, unbroken take lasting ${CLIP_SECONDS} seconds. Begin exactly at the Start Frame (Image A pose/state) and move continuously until the subject arrives at the End Frame (Image B pose/state) precisely on the final frame.${motion}

The End Frame is the DESTINATION of the motion, not a separate shot pasted onto the end. The subject must physically travel into that final pose, so the last frame is simply where the movement finished. NEVER reach it by crossfade, dissolve, morph blend, ghosting, double exposure, opacity change, cut, snap or teleport.

Motion must be monotonic and continuous: the subject advances toward the end state and never drifts backwards, reverses direction, overshoots and returns, stalls, loops, re-times, or regresses toward the start pose. Distribute the movement across the entire ${CLIP_SECONDS} seconds so the final second is still real, decelerating motion settling into the end pose — not a static hold, and not a sudden correction to hit the target.

Where intermediate features or anatomical structures are missing between the keyframes, draw them in using the exact stroke weight and drawing style of the source sketch, so every in-between frame is a complete drawing rather than a blend of the two keyframes.`
  }

  const heading = clip.endDescription?.trim()

  return `[KEYFRAME TRANSITION]: One continuous, unbroken take lasting ${CLIP_SECONDS} seconds. Begin exactly at the supplied Start Frame and animate forward from it, keeping the same subject, drawing style, line weight and framing throughout.${motion}

DIRECTION OF TRAVEL${
    heading ? `: the action is heading toward this state — ${heading}` : ''
  }. Treat that strictly as a heading, NOT as a frame to reproduce. Do not compose, hold, settle into, cut to, or fade toward any specific target image. There is no required final pose.

The clip simply runs out while the action is still underway. Ending mid-motion is correct and preferred: the last frame must look like an ordinary frame of the movement, indistinguishable in character from the frames just before it. Never end on a freeze frame, a held pose, a fade, a crossfade, a dissolve or a slow-down into stillness.

Motion must be monotonic and continuous at a natural, even speed: the subject advances in one direction and never drifts backwards, reverses, overshoots and returns, stalls, loops, re-times or regresses toward the opening pose. Do not rush through the action early and then wait out the remaining time.

Where features or anatomical structures are missing or ambiguous, draw them in using the exact stroke weight and drawing style of the source sketch, so every frame is a complete drawing rather than a blend or a smear.`
}

export function compilePrompt(
  clip: Clip,
  styleNote: string,
  mode: EndFrameMode = 'guide'
): string | null {
  if (!isBoardComplete(clip.board)) return null

  const [director, cinematographer, animator, artDirector] = BOARD_STEPS.map((s) =>
    stepDirective(clip.board, s)
  )

  // Trailing punctuation is stripped because this is spliced into a sentence -
  // a note ending in "." would otherwise produce "..".
  const style = (styleNote.trim() || DEFAULT_STYLE_NOTE).replace(/[.\s]+$/, '')
  const intent = clip.intent.trim()

  const lines = [
    `[ART STYLE & INTEGRITY]: Strictly retain the hand-drawn 2D look of the source frames. Art direction: ${style}. Preserve the exact stroke weight, line quality, medium and colour palette present in the Start and End frames. Clean background, strict stroke fidelity, zero 3D, zero photorealism, no relighting, no shading passes, no gradients.`,

    transitionSection(clip, intent, mode),

    `[EASING & MOTION]: ${director} ${cinematographer} ${animator}`.replace(/\s+/g, ' ').trim(),

    `[ENVIRONMENT & EFFECTS]: ${artDirector}`,

    `[OUTPUT PARAMETERS]: ${CLIP_SECONDS}-second video clip, silent, ${CLIP_FPS}fps smooth 2D cartoon interpolation.`
  ]

  return lines.join('\n\n')
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
