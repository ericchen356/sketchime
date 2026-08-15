'use client'

import { useState } from 'react'
import { FrameThumb } from './FrameThumb'
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

const STATUS_LABEL: Record<Clip['status'], string> = {
  draft: 'draft',
  ready: 'ready',
  generating: 'rendering…',
  done: 'rendered',
  error: 'failed'
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
  const total = storyboard.clips.length * CLIP_SECONDS

  const endDrag = (): void => {
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <section className="timeline">
      <header className="timeline-head">
        <h2>
          Storyboard
          <span className="timeline-meta">
            {storyboard.clips.length} clip{storyboard.clips.length === 1 ? '' : 's'} · {total}s
          </span>
        </h2>
        <button className="btn btn-primary" onClick={onAddClip}>
          + Clip
        </button>
      </header>

      {storyboard.clips.length === 0 ? (
        <p className="empty-note">
          No clips yet. Add one to draw its start and end keyframes — every clip interpolates
          between them over {CLIP_SECONDS} seconds.
        </p>
      ) : (
        <div className="strip">
          {storyboard.clips.map((clip, i) => {
            const start = getSketch(storyboard, clip.startFrameId)
            const end = getSketch(storyboard, clip.endFrameId)
            // Both thumbs share the clip's export box, so the timeline shows the
            // same framing the video model will receive.
            const box = clipBox(start, end)
            const seam = joins.find((s) => s.index === i)
            const done = answeredCount(clip.board)

            return (
              <div className="strip-cell" key={clip.id}>
                <article
                  className={`clip-card ${selectedId === clip.id ? 'clip-card-on' : ''} ${
                    dragOver === i && dragFrom !== null && dragFrom !== i ? 'clip-card-target' : ''
                  } ${dragFrom === i ? 'clip-card-dragging' : ''}`}
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
                  <div className="clip-top">
                    <span className="clip-index">{i + 1}</span>
                    <span className={`clip-status clip-status-${clip.status}`}>
                      {STATUS_LABEL[clip.status]}
                    </span>
                    <span className="clip-grip" title="Drag to reorder">
                      ⠿
                    </span>
                  </div>

                  <div className="clip-frames">
                    <button
                      className="frame-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditFrame(clip.id, 'start')
                      }}
                      title="Draw the start keyframe (Image A)"
                    >
                      <FrameThumb sketch={start} box={box} label="A" width={132} height={74} />
                    </button>
                    {/* The arrow doubles as the duplicate control: the common
                        move is "B starts as a copy of A, then something moves". */}
                    <button
                      className="frame-arrow"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCopyFrame(clip.id, 'start')
                      }}
                      disabled={isEmpty(start)}
                      title="Copy the start keyframe over the end keyframe, so you only redraw what moves"
                    >
                      <span aria-hidden="true">→</span>
                      <span className="frame-arrow-label">copy</span>
                    </button>
                    <button
                      className="frame-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditFrame(clip.id, 'end')
                      }}
                      title="Draw the end keyframe (Image B)"
                    >
                      <FrameThumb sketch={end} box={box} label="B" width={132} height={74} />
                    </button>
                  </div>

                  <div className="clip-foot">
                    <span className="board-pips" title={`${done} of 4 board steps answered`}>
                      {BOARD_STEPS.map((s) => (
                        <i key={s.id} className={isStepDone(clip.board[s.id]) ? 'pip pip-on' : 'pip'} />
                      ))}
                    </span>
                    <span className="clip-intent">{clip.intent.trim() || 'no motion intent yet'}</span>
                  </div>
                </article>

                {/* The join to the next clip. Linked means the two literally
                    share one drawing; broken means reordering split them. */}
                {seam && (
                  <div className={`seam ${seam.linked ? 'seam-linked' : 'seam-broken'}`}>
                    {seam.linked ? (
                      <button
                        className="seam-btn"
                        onClick={() => onUnlinkSeam(i)}
                        title="These clips share one keyframe. Split it into two independent drawings."
                      >
                        <span className="seam-icon">⛓</span>
                        linked
                      </button>
                    ) : (
                      <button
                        className="seam-btn"
                        onClick={() => onLinkSeam(i)}
                        title="These clips no longer share a keyframe. Re-link them (discards the next clip's start drawing)."
                      >
                        <span className="seam-icon">⚡</span>
                        cut
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
