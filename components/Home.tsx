'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FrameThumb } from './FrameThumb'
import { createBoard, deleteBoard, listBoards, loadBoard, renameBoard, type BoardMeta } from '@/lib/boards'
import { deleteVideo } from '@/lib/videoStore'
import { clipBox } from '@/lib/render'
import { getSketch } from '@/lib/storyboard'
import { CLIP_SECONDS, type Storyboard } from '@/lib/types'

interface Card extends BoardMeta {
  storyboard: Storyboard | null
}

/** Board list. Everything lives in this browser, so this is the whole library. */
export function Home(): React.JSX.Element {
  const router = useRouter()
  const [cards, setCards] = useState<Card[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // localStorage is unavailable during server render, so read after mount.
  const refresh = (): void => {
    setCards(listBoards().map((meta) => ({ ...meta, storyboard: loadBoard(meta.id) })))
  }
  useEffect(refresh, [])

  const open = (id: string): void => router.push(`/board/${id}`)

  const onCreate = (): void => {
    const meta = createBoard()
    open(meta.id)
  }

  const onDelete = (card: Card): void => {
    const ok = window.confirm(
      `Delete "${card.name}"?\n\nIts drawings and any rendered videos are removed from this browser. This cannot be undone.`
    )
    if (!ok) return
    // Videos live in IndexedDB keyed by clip id, so they have to go separately
    // or they linger with nothing referencing them.
    card.storyboard?.clips.forEach((c) => void deleteVideo(c.id))
    deleteBoard(card.id)
    refresh()
  }

  const commitRename = (id: string): void => {
    if (draft.trim()) renameBoard(id, draft)
    setRenaming(null)
    refresh()
  }

  return (
    <div className="home">
      <header className="app-head">
        <h1>Boards</h1>
        <button className="btn btn-primary" onClick={onCreate}>
          + New board
        </button>
      </header>

      {cards === null ? (
        <p className="empty-note">Loading your boards…</p>
      ) : cards.length === 0 ? (
        <div className="home-empty">
          <p className="empty-note">
            No boards yet. A board holds a sequence of clips — draw a start and end keyframe for
            each, direct it with the board of directors, then render and join them into one video.
          </p>
          <button className="btn btn-primary" onClick={onCreate}>
            Create your first board
          </button>
        </div>
      ) : (
        <div className="board-grid">
          {cards.map((card) => {
            const first = card.storyboard?.clips[0]
            const start = first ? getSketch(card.storyboard!, first.startFrameId) : null
            const end = first ? getSketch(card.storyboard!, first.endFrameId) : null
            const rendered = card.storyboard?.clips.filter((c) => c.videoUrl).length ?? 0

            return (
              <article key={card.id} className="board-card" onClick={() => open(card.id)}>
                <div className="board-cover">
                  {start && end ? (
                    <FrameThumb sketch={start} box={clipBox(start, end)} width={264} height={148} />
                  ) : (
                    <span className="board-cover-empty">empty board</span>
                  )}
                </div>

                <div className="board-body">
                  {renaming === card.id ? (
                    <input
                      className="field-input board-rename"
                      value={draft}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(card.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(card.id)
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <h2 className="board-name">{card.name}</h2>
                  )}

                  <p className="board-meta">
                    {card.clips} clip{card.clips === 1 ? '' : 's'} · {card.clips * CLIP_SECONDS}s
                    {rendered > 0 && ` · ${rendered} rendered`}
                    <br />
                    edited {new Date(card.updatedAt).toLocaleDateString()}{' '}
                    {new Date(card.updatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>

                  <div className="board-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-small"
                      onClick={() => {
                        setDraft(card.name)
                        setRenaming(card.id)
                      }}
                    >
                      Rename
                    </button>
                    <button className="btn btn-small btn-ghost" onClick={() => onDelete(card)}>
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

    </div>
  )
}
