'use client'

import { useState } from 'react'
import { BOARD_STEPS } from '@/lib/board'
import { activePrompt, answeredCount, isBoardComplete, isStepDone } from '@/lib/compile'
import { CLIP_SECONDS, type Clip, type Storyboard } from '@/lib/types'
import { getSketch } from '@/lib/storyboard'
import { isEmpty } from '@/lib/ink'

interface Props {
  clip: Clip
  index: number
  storyboard: Storyboard
  busy: boolean
  onIntent(text: string): void
  onOpenBoard(): void
  onRevise(notes: string): void
  onUseRevised(use: boolean): void
  onGenerate(): void
  onCancel(): void
  onDelete(): void
}

export function ClipDetail({
  clip,
  index,
  storyboard,
  busy,
  onIntent,
  onOpenBoard,
  onRevise,
  onUseRevised,
  onGenerate,
  onCancel,
  onDelete
}: Props): React.JSX.Element {
  const [notes, setNotes] = useState('')
  const [copied, setCopied] = useState(false)

  const complete = isBoardComplete(clip.board)
  const prompt = activePrompt(clip)
  const startBlank = isEmpty(getSketch(storyboard, clip.startFrameId))
  const endBlank = isEmpty(getSketch(storyboard, clip.endFrameId))

  // Generation needs a compiled prompt and two frames that actually contain
  // something to interpolate between.
  const blockers: string[] = []
  if (startBlank) blockers.push('start keyframe is empty')
  if (endBlank) blockers.push('end keyframe is empty')
  if (!complete) blockers.push(`board incomplete (${answeredCount(clip.board)}/4)`)

  const copy = async (): Promise<void> => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked - the textarea below is still selectable */
    }
  }

  return (
    <section className="detail">
      <header className="detail-head">
        <h2>
          Clip {index + 1}
          <span className="detail-meta">{CLIP_SECONDS}s interpolation</span>
        </h2>
        <button className="btn btn-ghost" onClick={onDelete} disabled={busy}>
          Delete clip
        </button>
      </header>

      <label className="field">
        <span className="field-label">Motion intent</span>
        <textarea
          className="field-input"
          rows={2}
          placeholder="What happens between the two frames? e.g. the cat leaps off the fence and lands crouched"
          value={clip.intent}
          onChange={(e) => onIntent(e.target.value)}
        />
      </label>

      <div className="board-summary">
        <div className="board-summary-head">
          <span className="field-label">Board of Directors</span>
          <button className="btn btn-small" onClick={onOpenBoard}>
            {complete ? 'Revisit board' : `Run board (${answeredCount(clip.board)}/4)`}
          </button>
        </div>
        <ul className="answer-list">
          {BOARD_STEPS.map((s) => {
            const thread = clip.board[s.id]
            const done = isStepDone(thread)
            return (
              <li key={s.id} className={done ? 'answered' : ''}>
                <span className="answer-role">{s.role}</span>
                <span className="answer-text">
                  {done ? (
                    thread!.directive
                  ) : thread?.turns.length ? (
                    <i>still consulting — {thread.turns.length} question(s) asked</i>
                  ) : (
                    <i>not yet consulted</i>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {clip.prompt ? (
        <div className="prompt-block">
          <div className="prompt-head">
            <span className="field-label">Compiled prompt</span>
            <div className="prompt-actions">
              {clip.revisedPrompt && (
                <div className="toggle-group">
                  <button
                    className={`chip ${!clip.useRevised ? 'chip-on' : ''}`}
                    onClick={() => onUseRevised(false)}
                  >
                    original
                  </button>
                  <button
                    className={`chip ${clip.useRevised ? 'chip-on' : ''}`}
                    onClick={() => onUseRevised(true)}
                  >
                    revised
                  </button>
                </div>
              )}
              <button className="btn btn-small" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <pre className="prompt-text">{prompt}</pre>

          <div className="revise-row">
            <input
              className="field-input"
              placeholder="Optional note for the revision pass (e.g. emphasise the anticipation beat)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button className="btn btn-small" onClick={() => onRevise(notes)} disabled={busy}>
              Revise with Gemini
            </button>
          </div>
        </div>
      ) : (
        <p className="empty-note">
          Answer all four board steps to compile the prompt for this clip.
        </p>
      )}

      {clip.error && <p className="error-note">{clip.error}</p>}

      <div className="generate-row">
        {clip.status === 'generating' ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <span className="generating-note">
              Rendering with Veo — this usually takes a few minutes.
            </span>
            <button className="btn" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={onGenerate}
              disabled={blockers.length > 0 || busy}
            >
              {clip.videoUrl ? 'Regenerate video' : 'Generate video'}
            </button>
            {blockers.length > 0 && <span className="blocker-note">Needs: {blockers.join(' · ')}</span>}
          </>
        )}
      </div>

      {clip.videoUrl && (
        <video className="clip-video" src={clip.videoUrl} controls loop playsInline />
      )}
    </section>
  )
}
