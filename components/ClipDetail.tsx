'use client'

import { useState } from 'react'
import { FrameThumb } from './FrameThumb'
import { Icon } from './Icon'
import { BOARD_STEPS, crewInitials, crewName } from '@/lib/board'
import { answeredCount, isBoardComplete, isStepDone } from '@/lib/compile'
import { CLIP_SECONDS, type Clip, type EndFrameMode, type Storyboard } from '@/lib/types'
import { estimateClipCost } from '@/lib/gemini-client'
import { clipBox } from '@/lib/render'
import { getSketch } from '@/lib/storyboard'
import { isEmpty } from '@/lib/ink'

interface Props {
  clip: Clip
  /**
   * Freshly compiled prompt for this clip, recomputed by the owner on every
   * render. The clip also caches a copy, but a cache goes stale the moment the
   * compiler changes - and then the panel shows one thing while generation
   * sends another. This is the authoritative text.
   */
  compiled: string | null
  /** Resolved video model, for the cost estimate. */
  videoModel?: string
  /** How this clip's end frame is used, and why. */
  endMode: EndFrameMode
  endModeReason: string
  onEndMode(mode: EndFrameMode | undefined): void
  index: number
  storyboard: Storyboard
  busy: boolean
  onIntent(text: string): void
  onEditFrame(side: 'start' | 'end'): void
  onCopyFrame(from: 'start' | 'end'): void
  onOpenBoard(): void
  onRevise(notes: string): void
  onUseRevised(use: boolean): void
  onGenerate(): void
  onCancel(): void
  onDelete(): void
}

/**
 * Everything you do to one clip, laid out as the three things you actually do
 * in the order you do them: draw it, say what happens, render it.
 *
 * The numbered stages are the app's whole navigational model. Before this the
 * same controls existed as a flat stack of unlabelled sections, so nothing on
 * screen answered "what do I do next" — you had to already know the pipeline.
 * Everything that belongs to the machinery rather than the task (the exact
 * prompt text, the end-frame constraint, the revision pass) now lives behind
 * one disclosure at the bottom.
 */
export function ClipDetail({
  clip,
  compiled,
  videoModel,
  endMode,
  endModeReason,
  onEndMode,
  index,
  storyboard,
  busy,
  onIntent,
  onEditFrame,
  onCopyFrame,
  onOpenBoard,
  onRevise,
  onUseRevised,
  onGenerate,
  onCancel,
  onDelete
}: Props): React.JSX.Element {
  const [notes, setNotes] = useState('')
  const [copied, setCopied] = useState(false)

  const start = getSketch(storyboard, clip.startFrameId)
  const end = getSketch(storyboard, clip.endFrameId)
  const box = clipBox(start, end)
  const startBlank = isEmpty(start)
  const endBlank = isEmpty(end)
  const drawn = (startBlank ? 0 : 1) + (endBlank ? 0 : 1)

  const answered = answeredCount(clip.board)
  const crewDone = isBoardComplete(clip.board)

  // A revision was written against whatever the prompt said at the time; if the
  // compiled text has moved since, the revision no longer matches it.
  const revisionStale = !!clip.revisedPrompt && clip.prompt !== compiled
  const prompt =
    clip.useRevised && clip.revisedPrompt && !revisionStale ? clip.revisedPrompt : compiled

  // Generation needs a compiled prompt and two frames that actually contain
  // something to interpolate between. Stated as things to go and do, not as a
  // list of failed preconditions.
  const blockers: string[] = []
  if (startBlank) blockers.push('Draw the first frame')
  if (endBlank) blockers.push('Draw the last frame')
  if (!crewDone) blockers.push(`Finish with your crew (${answered} of 4 done)`)

  const rendering = clip.status === 'generating'
  const cost = estimateClipCost(videoModel, CLIP_SECONDS)

  /** Which stage the eye should go to. Exactly one is highlighted. */
  const stage = drawn < 2 ? 1 : !crewDone ? 2 : 3

  const copy = async (): Promise<void> => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked - the text below is still selectable */
    }
  }

  const stageClass = (n: number, complete: boolean): string =>
    `stage${stage === n ? ' stage-active' : ''}${complete ? ' stage-complete' : ''}`

  return (
    <section className="inspect" aria-label={`Clip ${index + 1}`}>
      <header className="inspect-head">
        <div>
          <h2>Clip {index + 1}</h2>
          <p className="inspect-sub">{CLIP_SECONDS} seconds of animation</p>
        </div>
        <button
          className="icon-btn"
          onClick={onDelete}
          disabled={busy}
          title="Delete this clip"
          aria-label={`Delete clip ${index + 1}`}
        >
          <Icon name="trash" />
        </button>
      </header>

      {/* ---------- 1 · draw ---------- */}

      <div className={stageClass(1, drawn === 2)}>
        <div className="stage-head">
          <span className="stage-num" aria-hidden="true">
            {drawn === 2 ? <Icon name="check" size={13} /> : 1}
          </span>
          <h3 className="stage-title">Draw the two frames</h3>
          <span className="stage-state">
            {drawn === 2 ? 'Both drawn' : `${drawn} of 2 drawn`}
          </span>
        </div>

        <div className="frame-pair">
          <button className="frame-slot" onClick={() => onEditFrame('start')}>
            <FrameThumb sketch={start} box={box} width={170} height={96} emptyLabel="Empty" />
            <span className="frame-slot-label">
              First frame
              <Icon name="pen" size={13} />
            </span>
          </button>
          <button className="frame-slot" onClick={() => onEditFrame('end')}>
            <FrameThumb sketch={end} box={box} width={170} height={96} emptyLabel="Empty" />
            <span className="frame-slot-label">
              Last frame
              <Icon name="pen" size={13} />
            </span>
          </button>
        </div>

        {/* Only worth saying while it is still the useful next move. */}
        {!startBlank && endBlank && (
          <button className="btn btn-small" onClick={() => onCopyFrame('start')}>
            <Icon name="copy" size={15} />
            Start the last frame as a copy
          </button>
        )}
      </div>

      {/* ---------- 2 · direct ---------- */}

      <div className={stageClass(2, crewDone)}>
        <div className="stage-head">
          <span className="stage-num" aria-hidden="true">
            {crewDone ? <Icon name="check" size={13} /> : 2}
          </span>
          <h3 className="stage-title">Say what happens</h3>
          <span className="stage-state">{answered} of 4</span>
        </div>

        <label className="field">
          <span className="field-label">What happens between the two frames?</span>
          <textarea
            className="field-input"
            rows={2}
            placeholder="The cat leaps off the fence and lands in a crouch"
            value={clip.intent}
            onChange={(e) => onIntent(e.target.value)}
          />
        </label>

        <ul className="crew-list">
          {BOARD_STEPS.map((s) => {
            const thread = clip.board[s.id]
            const done = isStepDone(thread)
            return (
              <li key={s.id} className={`crew-row${done ? ' crew-done' : ''}`}>
                <span className="crew-avatar" aria-hidden="true">
                  {done ? <Icon name="check" size={13} /> : crewInitials(s.role)}
                </span>
                <span>
                  <span className="crew-name">{crewName(s.role)}</span>
                  {done ? (
                    <span className="crew-said"> — {thread!.directive}</span>
                  ) : thread?.turns.length ? (
                    <span className="crew-pending"> — mid-conversation</span>
                  ) : (
                    <span className="crew-pending"> — hasn’t weighed in yet</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>

        <button
          className={`btn${stage === 2 ? ' btn-primary' : ''}`}
          onClick={onOpenBoard}
          disabled={drawn < 2}
          title={drawn < 2 ? 'Your crew needs both frames to look at first' : undefined}
        >
          <Icon name="crew" size={16} />
          {crewDone ? 'Revisit your crew' : answered > 0 ? 'Carry on with your crew' : 'Talk to your crew'}
        </button>
      </div>

      {/* ---------- 3 · render ---------- */}

      <div className={stageClass(3, clip.status === 'done')}>
        <div className="stage-head">
          <span className="stage-num" aria-hidden="true">
            {clip.status === 'done' ? <Icon name="check" size={13} /> : 3}
          </span>
          <h3 className="stage-title">Make the animation</h3>
          {clip.status === 'done' && <span className="stage-state">Done</span>}
        </div>

        {clip.error && (
          <p className="notice notice-error">
            <Icon name="alert" size={16} />
            {clip.error}
          </p>
        )}

        {rendering ? (
          <div className="cta-row">
            <span className="spinner" aria-hidden="true" />
            <span className="cta-note">Rendering — this usually takes a few minutes.</span>
            <button className="btn btn-small" onClick={onCancel}>
              Stop
            </button>
          </div>
        ) : blockers.length > 0 ? (
          <ul className="blockers">
            {blockers.map((b) => (
              <li key={b}>
                <Icon name="alert" size={14} />
                {b}
              </li>
            ))}
          </ul>
        ) : (
          <div className="cta-row">
            <button className="btn btn-primary" onClick={onGenerate} disabled={busy}>
              <Icon name={clip.videoUrl ? 'refresh' : 'sparkle'} size={16} />
              {clip.videoUrl ? 'Render again' : 'Make this clip'}
            </button>
            {/* Rendering is billed per go, and "render again" is a fresh charge
                rather than a retry — so say the price before the click. */}
            <span className="cta-note tabular">
              {cost === null ? `${CLIP_SECONDS} seconds` : `about $${cost.toFixed(2)}`}
            </span>
          </div>
        )}

        {clip.videoUrl && (
          <video className="clip-video" src={clip.videoUrl} controls loop playsInline />
        )}
      </div>

      {/* ---------- everything else ---------- */}

      <details className="adv">
        <summary className="adv-summary">
          <Icon name="chevron" size={16} />
          Fine-tuning
        </summary>

        <div className="adv-body">
          <div className="field">
            <div className="row-between">
              <span className="field-label">How the clip ends</span>
              <div className="segmented">
                <button
                  className={`chip ${endMode === 'guide' ? 'chip-on' : ''}`}
                  onClick={() => onEndMode(clip.endFrameMode === 'guide' ? undefined : 'guide')}
                >
                  Let it run on
                </button>
                <button
                  className={`chip ${endMode === 'exact' ? 'chip-on' : ''}`}
                  onClick={() => onEndMode(clip.endFrameMode === 'exact' ? undefined : 'exact')}
                >
                  Land exactly
                </button>
              </div>
            </div>
            <p className="field-hint">
              {endMode === 'exact'
                ? 'The clip finishes on exactly your last drawing. The movement may visibly settle to hit it.'
                : 'Your last drawing steers the action, but the clip is free to finish mid-movement — smoother, though it will not land exactly on your drawing.'}{' '}
              Chosen for you because {endModeReason}.
              {clip.endFrameMode && ' Click the highlighted option again to go back to automatic.'}
            </p>
            {endMode === 'guide' && clip.endDescription && (
              <p className="field-hint">
                <b>Where it is heading:</b> {clip.endDescription}
              </p>
            )}
          </div>

          {compiled ? (
            <div className="field">
              <div className="row-between">
                <span className="field-label">The exact brief we send</span>
                <div className="foot-actions">
                  {clip.revisedPrompt && !revisionStale && (
                    <div className="segmented">
                      <button
                        className={`chip ${!clip.useRevised ? 'chip-on' : ''}`}
                        onClick={() => onUseRevised(false)}
                      >
                        Mine
                      </button>
                      <button
                        className={`chip ${clip.useRevised ? 'chip-on' : ''}`}
                        onClick={() => onUseRevised(true)}
                      >
                        Rewritten
                      </button>
                    </div>
                  )}
                  <button className="btn btn-small" onClick={copy}>
                    <Icon name="copy" size={14} />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {revisionStale && (
                <p className="field-hint">
                  The earlier rewrite was based on an older version of this brief, so it has been
                  set aside. Ask for another if you want one.
                </p>
              )}

              <pre className="prompt-well">{prompt}</pre>

              <div className="revise-row">
                <input
                  className="field-input"
                  placeholder="Anything to emphasise?"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <button className="btn btn-small" onClick={() => onRevise(notes)} disabled={busy}>
                  <Icon name="sparkle" size={14} />
                  Rewrite
                </button>
              </div>
            </div>
          ) : (
            <p className="empty">
              The brief is written once all four crew members have weighed in.
            </p>
          )}
        </div>
      </details>
    </section>
  )
}
