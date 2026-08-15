import type { BoardOption, BoardStep, BoardStepId } from './types'

/**
 * Stage 1: the Board of Directors. Four steps, run in strict sequential order,
 * each with exactly one question and exactly three tailored options. Option D is
 * never listed here because it is structural, not content: it is always the
 * custom write-in, and the survey UI appends it to every step.
 *
 * The wording is verbatim from the pipeline spec - these are the canonical
 * option texts the Stage 2 compiler quotes back to the video model, so editing
 * them changes generated output.
 */
export const BOARD_STEPS: BoardStep[] = [
  {
    id: 'director',
    order: 1,
    role: 'The Director',
    topic: 'Transition Timing & Easing',
    objective: 'Determine pacing, speed, and motion acceleration between keyframes.',
    question: 'How should the movement progress from the Start frame to the End frame?',
    options: [
      { key: 'A', text: 'Linear & constant speed throughout the 5 seconds' },
      { key: 'B', text: 'Ease-In: Start slowly, then accelerate fast towards the end frame' },
      { key: 'C', text: 'Ease-Out: Burst into motion quickly, then gently settle into the end frame' }
    ],
    compilesInto: 'easing'
  },
  {
    id: 'cinematographer',
    order: 2,
    role: 'The Cinematographer',
    topic: 'Framing & Camera Trajectory',
    objective: 'Determine spatial movement and camera tracking during the transition.',
    question: 'How should the camera or spatial framing react during the transition?',
    options: [
      { key: 'A', text: 'Fixed camera: Keep drawing canvas static while subject moves across screen' },
      { key: 'B', text: 'Pan/Follow camera: Track the moving subject from Start frame to End frame' },
      { key: 'C', text: 'Dynamic zoom: Zoom in or out smoothly to match scale changes between keyframes' }
    ],
    compilesInto: 'camera'
  },
  {
    id: 'animator',
    order: 3,
    role: 'The Lead Animator',
    topic: 'Morphing & Cartoon Physics',
    objective:
      'Resolve missing intermediate features and define squash-and-stretch cartoon physics.',
    question: 'How should character shapes transform between the two keyframes?',
    options: [
      { key: 'A', text: 'Exaggerated cartoon squash, stretch, and morph between keyframe poses' },
      { key: 'B', text: 'Rigid joint movement: Rotate limbs smoothly without deforming line art' },
      { key: 'C', text: 'Frame-by-frame snappy action with secondary motion (hair/clothing sway)' }
    ],
    compilesInto: 'physics'
  },
  {
    id: 'artDirector',
    order: 4,
    role: 'The Art Director',
    topic: 'In-Between Canvas & Backdrop',
    objective: 'Decide on canvas backdrop rules and transition motion effects.',
    question: 'How should background and in-between visual details be handled?',
    options: [
      { key: 'A', text: 'Keep canvas completely blank/clean throughout the transition' },
      { key: 'B', text: 'Add dynamic action lines/motion blurs to emphasize movement' },
      { key: 'C', text: 'Morph background elements seamlessly if backgrounds differ between frames' }
    ],
    compilesInto: 'environment'
  }
]

/** Label shown on the always-present fourth choice. */
export const CUSTOM_OPTION_LABEL = 'Other: [Custom Text Input]'

/**
 * Offline fallback. With no API key there is no agent to look at the drawing,
 * so the board degrades to exactly the spec's canonical wording: one fixed
 * question per step, the three fixed options, no follow-ups.
 *
 * This is a real fallback, not a simulation - the thread is flagged `offline`
 * so the UI can say the agent never saw the drawing.
 */
export function offlineTurn(step: BoardStep): {
  observation: string
  question: string
  options: BoardOption[]
} {
  return {
    observation:
      'Offline — no API key, so nobody looked at your frames. These are the standard options.',
    question: step.question,
    options: step.options
  }
}

/** With no agent to write one, the chosen option text IS the directive. */
export function offlineDirective(step: BoardStep, answerText: string): string {
  const text = answerText.trim()
  return text.endsWith('.') ? text : `${text}.`
}

export const BOARD_STEP_IDS: BoardStepId[] = BOARD_STEPS.map((s) => s.id)

export function stepAt(index: number): BoardStep | undefined {
  return BOARD_STEPS[index]
}
