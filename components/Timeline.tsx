'use client'

import { useState } from 'react'
import { FrameThumb } from './FrameThumb'
import { Icon } from './Icon'
import { answeredCount, isStepDone } from '@/lib/compile'
import { clipBox } from '@/lib/render'
import { getSketch, seams } from '@/lib/storyboard'
import { isEmpty } from '@/lib/ink'
import { BOARD_STEPS } from '@/lib/board'
import { CLIP_SECONDS, type Clip, type Storyboard } from '@/lib/types'

interface Props {
  storyboard: Storyboard
  selectedId: string | null
  onSelect(clipId: string): void
  onEditFrame(clipId: string, side: 'start' | 'end'): void
  onAddClip(): void
  onMoveClip(from: number, to: number): void
  onLinkSeam(index: number): void
  onUnlinkSeam(index: number): void
  onCopyFrame(clipId: string, from: 'start' | 'end'): void
}

/**
 * Plain-language status. The previous labels were the internal state machine's
 * own names (draft / ready / done), which describe the data rather than
 * telling anyone what to do about it.
 */
const STATUS: Record<Clip['status'], string> = {
  draft: 'In progress',
  ready: 'Ready to render',
  generating: 'Rendering…',
  done: 'Rendered',
  error: 'Didn’t work'
}

export function Timeline({
  storyboard,
  selectedId,
  onSelect,
  onEditFrame,
  onAddClip,
  onMoveClip,
  onLinkSeam,
  onUnlinkSeam,
  onCopyFrame
}: Props): React.JSX.Element {
  /** Index being dragged, and the index it is currently hovering over. Both are
   * local: a reorder only reaches the storyboard on drop. */
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const joins = seams(storyboard)
  const clips = storyboard.clips
  const total = clips.length * CLIP_SECONDS

  const endDrag = (): void => {
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <section className="section">
      <header className="section-head">
        <h2>
          Storyboard
          <span className="section-meta">
            {clips.length} clip{clips.length === 1 ? '' : 's'} · {total} seconds
          </span>
        </h2>
        {/* Also in the header, not only at the end of the strip: once there are
            enough clips to scroll, the ghost card at the far end is off-screen
            and the most common action in the app becomes invisible. */}
        <button className="btn btn-small" onClick={onAddClip}>
          <Icon name="plus" size={15} />
          Add a clip
        </button>
      </header>

      <div className="strip">
        {clips.map((clip, i) => {
          const start = getSketch(storyboard, clip.startFrameId)
          const end = getSketch(storyboard, clip.endFrameId)
          // Both thumbs share the clip's export box, so the storyboard shows
          // the same framing the video model will receive.
          const box = clipBox(start, end)
          const seam = joins.find((s) => s.index === i)
          const done = answeredCount(clip.board)

          return (
            <div className="strip-cell" key={clip.id}>
              <article
                className={`clip-card${selectedId === clip.id ? ' clip-card-on' : ''}${
                  dragOver === i && dragFrom !== null && dragFrom !== i ? ' clip-card-target' : ''
                }${dragFrom === i ? ' clip-card-dragging' : ''}`}
                draggable
                onClick={() => onSelect(clip.id)}
                onDragStart={(e) => {
                  setDragFrom(i)
                  e.dataTransfer.effectAllowed = 'move'
                  // Firefox refuses to start a drag without payload.
                  e.dataTransfer.setData('text/plain', String(i))
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOver(i)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom !== null && dragFrom !== i) onMoveClip(dragFrom, i)
                  endDrag()
                }}
                onDragEnd={endDrag}
              >
                <div className="clip-head">
                  {/* The number is the keyboard route into the card. Clicking
                      anywhere selects, but a pointer-only affordance is not a
                      control, so the one thing that must be reachable by Tab
                      is a real button. */}
                  <button
                    className="clip-num"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(clip.id)
                    }}
                    aria-label={`Open clip ${i + 1}`}
                    aria-current={selectedId === clip.id ? 'true' : undefined}
                  >
                    {i + 1}
                  </button>

                  <span className={`status status-${clip.status}`}>
                    <span className="status-dot" aria-hidden="true" />
                    {STATUS[clip.status]}
                  </span>

                  {/* Drag to reorder, or focus and use the arrow keys. A
                      drag-only reorder is unreachable without a pointer. */}
                  <button
                    className="clip-grip"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' && i > 0) {
                        e.preventDefault()
                        onMoveClip(i, i - 1)
                      } else if (e.key === 'ArrowRight' && i < clips.length - 1) {
                        e.preventDefault()
                        onMoveClip(i, i + 1)
                      }
                    }}
                    aria-label={`Reorder clip ${i + 1}. Press the left or right arrow key to move it.`}
                  >
                    <Icon name="grip" size={16} />
                  </button>
                </div>

                <div className="clip-frames">
                  <button
                    className="frame-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditFrame(clip.id, 'start')
                    }}
                    aria-label={`Draw the first frame of clip ${i + 1}`}
                  >
                    <FrameThumb
                      sketch={start}
                      box={box}
                      caption="First frame"
                      width={118}
                      height={66}
                    />
                  </button>

                  {/* The arrow doubles as the duplicate control: the common
                      move is "the last frame starts as a copy of the first,
                      then something moves". */}
                  <button
                    className="frame-copy"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCopyFrame(clip.id, 'start')
                    }}
                    disabled={isEmpty(start)}
                    title="Copy the first frame onto the last one, so you only redraw what moves"
                    aria-label="Copy the first frame onto the last one"
                  >
                    <Icon name="arrowRight" size={17} />
                  </button>

                  <button
                    className="frame-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditFrame(clip.id, 'end')
                    }}
                    aria-label={`Draw the last frame of clip ${i + 1}`}
                  >
                    <FrameThumb
                      sketch={end}
                      box={box}
                      caption="Last frame"
                      width={118}
                      height={66}
                    />
                  </button>
                </div>

                <div className="clip-foot">
                  <span className="pips" title={`${done} of 4 crew members have weighed in`}>
                    {BOARD_STEPS.map((s) => (
                      <i
                        key={s.id}
                        className={isStepDone(clip.board[s.id]) ? 'pip pip-on' : 'pip'}
                        aria-hidden="true"
                      />
                    ))}
                    {/* A title attribute on a span is not reliably announced,
                        and four coloured dots say nothing on their own. */}
                    <span className="visually-hidden">
                      {done} of 4 crew members have weighed in.
                    </span>
                  </span>
                  <span
                    className={`clip-intent${clip.intent.trim() ? '' : ' clip-intent-blank'}`}
                    title={clip.intent.trim() || undefined}
                  >
                    {clip.intent.trim() || 'Nothing described yet'}
                  </span>
                </div>
              </article>

              {/* The join to the next clip. Linked means the two literally
                  share one drawing; a cut means reordering split them. */}
              {seam && (
                <div className="seam">
                  {seam.linked ? (
                    <button
                      className="seam-btn seam-linked"
                      onClick={() => onUnlinkSeam(i)}
                      title="These two clips share a drawing, so the cut between them is invisible. Click to split them into separate drawings."
                    >
                      <Icon name="link" size={17} />
                      Flows on
                    </button>
                  ) : (
                    <button
                      className="seam-btn seam-broken"
                      onClick={() => onLinkSeam(i)}
                      title="These two clips no longer share a drawing, so there will be a visible jump. Click to join them again."
                    >
                      <Icon name="cut" size={17} />
                      Hard cut
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <button className="add-card" onClick={onAddClip}>
          <Icon name="plus" size={22} />
          Add a clip
        </button>
      </div>
    </section>
  )
}
