'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from './Canvas'
import { Timeline } from './Timeline'
import { BoardSurvey } from './BoardSurvey'
import { ClipDetail } from './ClipDetail'
import { FinalCut } from './FinalCut'
import { SettingsDialog } from './SettingsDialog'
import { ConfirmDialog, type Confirmation } from './ConfirmDialog'
import { Icon } from './Icon'
import { compilePrompt, revisionInstruction } from '@/lib/compile'
import { BOARD_H, BOARD_W, renderClipFrames } from '@/lib/render'
import { isEmpty } from '@/lib/ink'
import {
  describeFrame,
  fetchConfig,
  generateClip,
  loadApiKey,
  revisePrompt,
  saveApiKey,
  type ServerConfig
} from '@/lib/gemini-client'
import {
  addClip,
  clipsUsingFrame,
  copyFrameInto,
  effectiveEndMode,
  endModeReason,
  emptyStoryboard,
  getSketch,
  invalidate,
  linkSeam,
  moveClip,
  removeClip,
  setFrameSketch,
  unlinkSeam,
  updateClip
} from '@/lib/storyboard'
import { SAVE_DEBOUNCE_MS } from '@/lib/persist'
import { allClipIds, boardMeta, deleteBoard, loadBoard, saveBoard } from '@/lib/boards'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  clearVideos,
  deleteVideo,
  getVideo,
  pruneVideos,
  putVideo
} from '@/lib/videoStore'
import type { BoardThreads, Sketch, Storyboard } from '@/lib/types'

/** Which frame the full-screen canvas is editing, if any. */
interface Editing {
  clipId: string
  side: 'start' | 'end'
}

interface Props {
  /** Which board to edit. Also its localStorage key. */
  boardId: string
}

export function Studio({ boardId }: Props): React.JSX.Element {
  const [storyboard, setStoryboard] = useState<Storyboard>(emptyStoryboard)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [boardFor, setBoardFor] = useState<string | null>(null)
  /** The rendered keyframes the crew is currently looking at. */
  const [boardImages, setBoardImages] = useState<{ imageA: string; imageB: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** The one pending "are you sure", if any. */
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /**
   * Whether saved work has been read back yet. Load happens in an effect (
   * localStorage does not exist during server render), and until it finishes the
   * storyboard is the empty initial value - persisting THAT would wipe the very
   * work we are trying to restore. So saving is gated on this flag.
   */
  const [restored, setRestored] = useState(false)
  const [boardName, setBoardName] = useState('')
  const router = useRouter()
  const [saveWarning, setSaveWarning] = useState<string | null>(null)

  /** Live mirror, so handlers can read the current board without listing it as
   * a dependency (and without re-binding on every stroke). */
  const storyboardRef = useRef(storyboard)
  storyboardRef.current = storyboard

  /** Clips the user has asked to cancel; polling loops check this. */
  const cancelled = useRef<Set<string>>(new Set())
  /** Blob URLs we created, so they can be revoked instead of leaking. */
  const objectUrls = useRef<Set<string>>(new Set())

  useEffect(() => {
    setApiKey(loadApiKey())
    fetchConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  // Restore previously saved work. Runs once, after mount.
  useEffect(() => {
    setBoardName(boardMeta(boardId)?.name ?? 'Board')
    const saved = loadBoard(boardId)
    if (saved && (saved.clips.length > 0 || Object.keys(saved.frames).length > 0)) {
      setStoryboard(saved)
      // Land on the first clip rather than an empty inspector. The right-hand
      // column is where all the work happens, and "pick something" is a worse
      // first impression than simply showing the obvious default.
      if (saved.clips[0]) setSelectedId(saved.clips[0].id)
      setToast(
        `Welcome back — ${saved.clips.length} clip${saved.clips.length === 1 ? '' : 's'} restored.`
      )
    }
    setRestored(true)

    // Reattach saved videos. Done after the storyboard is in place and
    // asynchronously, because IndexedDB is async and the drawings should appear
    // immediately rather than waiting on megabytes of video.
    if (saved) {
      const ids = saved.clips.map((c) => c.id)
      void (async () => {
        for (const id of ids) {
          const blob = await getVideo(id)
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          objectUrls.current.add(url)
          // Only now is the clip genuinely 'done' - restored as 'ready' first,
          // so a video that fails to come back never shows a broken player.
          setStoryboard((sb) => updateClip(sb, id, { videoUrl: url, status: 'done' }))
        }
        // Drop videos for clips that no longer exist, or they orphan forever.
        // Prune against EVERY board's clips, not just this one - pruning on the
        // open board alone would delete other boards' rendered videos, each of
        // which cost real money to generate.
        void pruneVideos(allClipIds())
      })()
    }
  }, [])

  // Persist on change, debounced: drawing produces a state update per stroke and
  // serialising the whole board on each one would stutter the canvas.
  useEffect(() => {
    if (!restored) return
    const t = setTimeout(() => {
      const result = saveBoard(boardId, storyboard)
      // Only surface a problem. A silent save failure is the exact thing this
      // feature exists to prevent, so it must be visible and stay visible.
      setSaveWarning(result.warning ?? null)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [storyboard, restored, boardId])

  /**
   * Bring every stored prompt up to date with the current compiler, once.
   * Prompts are cached on the clip, so a compiler change (say, stronger
   * anti-crossfade wording) would otherwise only reach clips edited afterwards
   * - and the panel would show text that no longer matches what gets sent.
   */
  useEffect(() => {
    setStoryboard((sb) => {
      let next = sb
      let changed = false
      for (const c of sb.clips) {
        const prompt = compilePrompt(c, sb.styleNote, effectiveEndMode(sb, c.id))
        if (prompt && prompt !== c.prompt) {
          changed = true
          next = updateClip(next, c.id, {
            prompt,
            // Any earlier revision was written against the old text.
            revisedPrompt: undefined,
            useRevised: false
          })
        }
      }
      return changed ? next : sb
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Blob URLs outlive React state unless explicitly revoked.
  useEffect(() => {
    const urls = objectUrls.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const clips = storyboard.clips
  const selected = clips.find((c) => c.id === selectedId) ?? null
  const selectedIndex = clips.findIndex((c) => c.id === selectedId)
  const needsKey = !config?.hasServerKey && !apiKey

  /**
   * The prompt, derived rather than remembered. Compiling on every render costs
   * nothing (it is string assembly) and removes a whole class of bug: there is
   * no cached copy to go stale when the compiler improves, so what the panel
   * shows is always exactly what generation will send.
   */
  const endMode = selected ? effectiveEndMode(storyboard, selected.id) : 'guide'
  const livePrompt = useMemo(
    () => (selected ? compilePrompt(selected, storyboard.styleNote, endMode) : null),
    [selected, storyboard.styleNote, endMode]
  )

  /* ---------- storyboard edits ---------- */

  const handleAddClip = useCallback(() => {
    // Computed OUTSIDE the state updater on purpose. addClip mints fresh UUIDs,
    // and React StrictMode invokes updaters twice in development - doing this
    // inline would keep the second call's storyboard while having selected the
    // first call's (now discarded) clip id.
    const sb = storyboardRef.current
    const next = addClip(sb)
    const created = next.clips[next.clips.length - 1]

    setStoryboard(next)
    // Stay on the storyboard and just select the new clip. Jumping straight
    // into the canvas hides the work the user was looking at; they open the
    // drawing surface themselves by clicking a frame.
    setSelectedId(created.id)
  }, [])

  /** Any input change invalidates the compiled prompt, so recompile in place. */
  const recompile = useCallback((sb: Storyboard, clipId: string): Storyboard => {
    const clip = sb.clips.find((c) => c.id === clipId)
    if (!clip) return sb
    const prompt = compilePrompt(clip, sb.styleNote, effectiveEndMode(sb, clipId))
    return updateClip(sb, clipId, {
      prompt: prompt ?? undefined,
      // A recompile makes any earlier revision stale.
      revisedPrompt: prompt === clip.prompt ? clip.revisedPrompt : undefined,
      useRevised: prompt === clip.prompt ? clip.useRevised : false,
      ...invalidate({ ...clip, prompt: prompt ?? undefined })
    })
  }, [])

  const handleIntent = useCallback(
    (clipId: string, intent: string) => {
      setStoryboard((sb) => recompile(updateClip(sb, clipId, { intent }), clipId))
    },
    [recompile]
  )

  const handleBoardComplete = useCallback(
    (clipId: string, board: BoardThreads) => {
      setStoryboard((sb) => recompile(updateClip(sb, clipId, { board }), clipId))
      setBoardFor(null)
    },
    [recompile]
  )

  const handleStyleNote = useCallback((styleNote: string) => {
    setStoryboard((sb) => {
      // The style note is global, so every compiled prompt has to follow it.
      let next = { ...sb, styleNote }
      for (const c of next.clips) {
        const prompt = compilePrompt(c, styleNote, effectiveEndMode(next, c.id))
        next = updateClip(next, c.id, { prompt: prompt ?? undefined })
      }
      return next
    })
  }, [])

  const handleFrameChange = useCallback((frameId: string, sketch: Sketch) => {
    setStoryboard((sb) => setFrameSketch(sb, frameId, sketch))
  }, [])

  const handleDelete = useCallback(
    (clipId: string) => {
      const n = storyboardRef.current.clips.findIndex((c) => c.id === clipId) + 1
      setConfirmation({
        title: `Delete clip ${n}?`,
        body: (
          <p>
            Both of its drawings go with it, along with anything you have made from them. This
            cannot be undone.
          </p>
        ),
        confirmLabel: 'Delete this clip',
        danger: true,
        onConfirm: () => {
          // Release the in-memory blob as well as the stored copy. An object URL
          // pins its blob until it is revoked, and the set below is only drained
          // when the whole view unmounts - which, in a single-page session,
          // means never. Deleting several rendered clips would hold on to a few
          // megabytes each for the rest of the session. Regenerating already
          // revoked the URL it replaced; deleting did not.
          const url = storyboardRef.current.clips.find((c) => c.id === clipId)?.videoUrl
          if (url) {
            URL.revokeObjectURL(url)
            objectUrls.current.delete(url)
          }

          setStoryboard((sb) => removeClip(sb, clipId))
          setSelectedId((id) => (id === clipId ? null : id))
          // Otherwise the bytes linger on disk with nothing referencing them.
          void deleteVideo(clipId)
        }
      })
    },
    []
  )

  const handleLink = useCallback((index: number) => {
    setConfirmation({
      title: 'Join these clips back together?',
      body: (
        <p>
          Clip {index + 2} will take on clip {index + 1}&rsquo;s last drawing, so the two flow into
          each other with no visible jump. <b>Whatever is drawn on clip {index + 2}&rsquo;s own
          first frame will be thrown away.</b>
        </p>
      ),
      confirmLabel: 'Join them',
      danger: true,
      onConfirm: () => setStoryboard((sb) => linkSeam(sb, index))
    })
  }, [])

  const handleUnlink = useCallback((index: number) => {
    setStoryboard((sb) => unlinkSeam(sb, index))
    setToast('Split — the two clips now have separate drawings.')
  }, [])

  /**
   * Seed one keyframe from the other. Destructive to the target, so it asks
   * first whenever there is something to lose - there is no undo at this level,
   * only inside the canvas.
   */
  const handleCopyFrame = useCallback((clipId: string, from: 'start' | 'end') => {
    const sb = storyboardRef.current
    const clip = sb.clips.find((c) => c.id === clipId)
    if (!clip) return

    const fromId = from === 'start' ? clip.startFrameId : clip.endFrameId
    const toId = from === 'start' ? clip.endFrameId : clip.startFrameId
    if (isEmpty(getSketch(sb, fromId))) return

    const source = from === 'start' ? 'first' : 'last'
    const target = from === 'start' ? 'last' : 'first'

    if (!isEmpty(getSketch(sb, toId))) {
      setConfirmation({
        title: `Replace the ${target} frame?`,
        body: (
          <p>
            It will become a copy of the {source} frame, and what is drawn on it now will be
            thrown away.
          </p>
        ),
        confirmLabel: `Replace the ${target} frame`,
        danger: true,
        onConfirm: () => setStoryboard(copyFrameInto(storyboardRef.current, fromId, toId))
      })
      return
    }
    setStoryboard(copyFrameInto(sb, fromId, toId))
  }, [])

  /**
   * Open the crew room for a clip. The keyframes are rasterised HERE, once,
   * through the clip's shared box - every crew member then looks at exactly the
   * images the video model will receive, so their observations match the real
   * output.
   */
  const openBoard = useCallback((clipId: string) => {
    const sb = storyboardRef.current
    const clip = sb.clips.find((c) => c.id === clipId)
    if (!clip) return
    // The crew get a smaller render than the video model: enough to read a line
    // drawing, a fraction of the bytes and tokens.
    const { imageA, imageB } = renderClipFrames(
      getSketch(sb, clip.startFrameId),
      getSketch(sb, clip.endFrameId),
      BOARD_W,
      BOARD_H
    )
    setBoardImages({ imageA, imageB })
    setBoardFor(clipId)
  }, [])

  /* ---------- gemini ---------- */

  const handleRevise = useCallback(
    async (clipId: string, notes: string) => {
      const clip = storyboard.clips.find((c) => c.id === clipId)
      if (!clip?.prompt) return
      setBusy(true)
      try {
        const revised = await revisePrompt(revisionInstruction(clip.prompt, notes), apiKey)
        setStoryboard((sb) => updateClip(sb, clipId, { revisedPrompt: revised, useRevised: true }))
        setToast('Brief rewritten.')
      } catch (e) {
        setToast(e instanceof Error ? e.message : 'The rewrite did not work.')
      } finally {
        setBusy(false)
      }
    },
    [storyboard, apiKey]
  )

  const handleGenerate = useCallback(
    async (clipId: string) => {
      const sb = storyboardRef.current
      const clip = sb.clips.find((c) => c.id === clipId)
      if (!clip) return
      // Recompile HERE rather than trusting clip.prompt. A stored prompt was
      // produced by whatever the compiler said when it was last touched, so any
      // later improvement to the compiler would silently not apply to an
      // existing clip - you would click Render again and get the old wording.
      const mode = effectiveEndMode(sb, clipId)

      // In guide mode the end frame is NOT sent to the video model, so its
      // content has to reach the prompt as prose or the shot has no destination
      // at all. Generated on demand and cached on the clip.
      let described = clip.endDescription
      if (mode === 'guide' && !described?.trim()) {
        try {
          const { imageB: endShot } = renderClipFrames(
            getSketch(sb, clip.startFrameId),
            getSketch(sb, clip.endFrameId),
            BOARD_W,
            BOARD_H
          )
          described = await describeFrame(endShot, clip.intent, apiKey)
          setStoryboard((cur) => updateClip(cur, clipId, { endDescription: described }))
        } catch {
          // Not fatal: the clip still animates from the start frame, it just
          // has less direction. Better than blocking the render outright.
          described = undefined
        }
      }

      const fresh = compilePrompt({ ...clip, endDescription: described }, sb.styleNote, mode)
      // A revision made against an older prompt is stale too; only honour it
      // when the compiled text has not moved underneath it.
      const revisionStillValid = clip.useRevised && clip.revisedPrompt && fresh === clip.prompt
      const prompt = revisionStillValid ? clip.revisedPrompt : fresh ?? clip.prompt
      if (!prompt) return

      cancelled.current.delete(clipId)
      // Rasterise both keyframes through ONE shared box, so the model doesn't
      // read a crop difference as camera movement.
      const { imageA, imageB } = renderClipFrames(
        getSketch(sb, clip.startFrameId),
        getSketch(sb, clip.endFrameId)
      )

      setStoryboard((sb) =>
        updateClip(sb, clipId, { status: 'generating', error: undefined, operation: undefined })
      )

      try {
        const blob = await generateClip({
          prompt,
          imageA,
          // Withheld in guide mode - that omission IS the fix for the clip
          // settling onto a fixed final image.
          imageB: mode === 'exact' ? imageB : undefined,
          apiKey,
          onOperation: (operation) =>
            setStoryboard((sb) => updateClip(sb, clipId, { operation })),
          isCancelled: () => cancelled.current.has(clipId)
        })
        // Persist the bytes BEFORE anything else. A video is a real charge
        // against the user's quota, so losing it to a reload is worse than
        // losing a drawing.
        const saved = await putVideo(clipId, blob)

        const url = URL.createObjectURL(blob)
        objectUrls.current.add(url)
        setStoryboard((sb) => {
          const prev = sb.clips.find((c) => c.id === clipId)?.videoUrl
          if (prev) {
            URL.revokeObjectURL(prev)
            objectUrls.current.delete(prev)
          }
          return updateClip(sb, clipId, { status: 'done', videoUrl: url, error: undefined })
        })
        setToast(saved.ok ? 'Clip made and saved.' : 'Clip made.')
        if (!saved.ok) setSaveWarning(saved.error ?? null)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'That did not work.'
        const wasCancelled = cancelled.current.has(clipId)
        setStoryboard((sb) =>
          updateClip(sb, clipId, {
            status: wasCancelled ? 'ready' : 'error',
            error: wasCancelled ? undefined : message
          })
        )
        if (!wasCancelled) setToast(message)
      } finally {
        cancelled.current.delete(clipId)
      }
    },
    [apiKey]
  )

  const handleCancel = useCallback((clipId: string) => {
    cancelled.current.add(clipId)
    setToast('Stopping — the request may still be running on Google’s side.')
  }, [])

  /* ---------- canvas ---------- */

  const editingFrameId = useMemo(() => {
    if (!editing) return null
    const clip = clips.find((c) => c.id === editing.clipId)
    if (!clip) return null
    return editing.side === 'start' ? clip.startFrameId : clip.endFrameId
  }, [editing, clips])

  const editingClipIndex = editing ? clips.findIndex((c) => c.id === editing.clipId) : -1

  if (editing && editingFrameId) {
    const clip = clips[editingClipIndex]
    const otherId = editing.side === 'start' ? clip.endFrameId : clip.startFrameId
    const shared = clipsUsingFrame(storyboard, editingFrameId)

    return (
      <Canvas
        sketch={getSketch(storyboard, editingFrameId)}
        onChange={(next) => handleFrameChange(editingFrameId, next)}
        ghost={getSketch(storyboard, otherId)}
        ghostLabel={editing.side === 'start' ? 'the last frame' : 'the first frame'}
        header={
          <div className="canvas-bar">
            <button className="btn btn-small" onClick={() => setEditing(null)}>
              <Icon name="arrowLeft" size={15} />
              Storyboard
            </button>

            <span className="canvas-bar-sep" aria-hidden="true" />

            <span className="canvas-clip">Clip {editingClipIndex + 1}</span>

            <div className="segmented">
              <button
                className={`chip ${editing.side === 'start' ? 'chip-on' : ''}`}
                onClick={() => setEditing({ ...editing, side: 'start' })}
              >
                First frame
              </button>
              <button
                className={`chip ${editing.side === 'end' ? 'chip-on' : ''}`}
                onClick={() => setEditing({ ...editing, side: 'end' })}
              >
                Last frame
              </button>
            </div>

            {shared.length > 1 && (
              <span
                className="shared-badge"
                title="This drawing is shared with the clip next to it, so editing it changes both. That is what keeps the join invisible."
              >
                <Icon name="link" size={13} />
                Shared with {shared.length - 1} other clip
                {shared.length - 1 === 1 ? '' : 's'}
              </span>
            )}
          </div>
        }
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <Link href="/" className="brand-mark brand-home" aria-label="All boards" title="All boards">
            <Icon name="frames" size={16} />
          </Link>
          {boardName || 'SketchMotion'}
        </h1>

        <div className="topbar-actions">
          {needsKey && (
            <button className="btn btn-small" onClick={() => setSettingsOpen(true)}>
              <Icon name="key" size={15} />
              Connect Gemini
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      {clips.length === 0 ? (
        <Welcome onStart={handleAddClip} needsKey={needsKey} />
      ) : (
        <div className="workspace">
          <div className="lane">
            <Timeline
              storyboard={storyboard}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onEditFrame={(clipId, side) => setEditing({ clipId, side })}
              onAddClip={handleAddClip}
              onMoveClip={(from, to) => setStoryboard((sb) => moveClip(sb, from, to))}
              onLinkSeam={handleLink}
              onUnlinkSeam={handleUnlink}
              onCopyFrame={handleCopyFrame}
          onDeleteClip={handleDelete}
            />

            <FinalCut storyboard={storyboard} />
          </div>

          <aside className="inspector">
            {selected ? (
              <ClipDetail
                clip={selected}
                compiled={livePrompt}
                endMode={endMode}
                endModeReason={endModeReason(storyboard, selected.id)}
                onEndMode={(m) =>
                  setStoryboard((sb) => updateClip(sb, selected.id, { endFrameMode: m }))
                }
                videoModel={config?.videoModel}
                index={selectedIndex}
                storyboard={storyboard}
                busy={busy}
                onIntent={(text) => handleIntent(selected.id, text)}
                onEditFrame={(side) => setEditing({ clipId: selected.id, side })}
                onCopyFrame={(from) => handleCopyFrame(selected.id, from)}
                onOpenBoard={() => openBoard(selected.id)}
                onRevise={(notes) => void handleRevise(selected.id, notes)}
                onUseRevised={(use) =>
                  setStoryboard((sb) => updateClip(sb, selected.id, { useRevised: use }))
                }
                onGenerate={() => void handleGenerate(selected.id)}
                onCancel={() => handleCancel(selected.id)}
                onDelete={() => handleDelete(selected.id)}
              />
            ) : (
              <div className="inspector-empty">
                <Icon name="frames" size={36} />
                <p className="empty">Pick a clip on the left to work on it.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {boardFor && boardImages && (
        <BoardSurvey
          clipIndex={clips.findIndex((c) => c.id === boardFor)}
          initial={clips.find((c) => c.id === boardFor)?.board ?? {}}
          imageA={boardImages.imageA}
          imageB={boardImages.imageB}
          intent={clips.find((c) => c.id === boardFor)?.intent ?? ''}
          styleNote={storyboard.styleNote}
          apiKey={apiKey}
          offline={needsKey}
          onCancel={() => setBoardFor(null)}
          onComplete={(board) => handleBoardComplete(boardFor, board)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          apiKey={apiKey}
          config={config}
          styleNote={storyboard.styleNote}
          onApiKey={(k) => {
            setApiKey(k)
            saveApiKey(k)
          }}
          onStyleNote={handleStyleNote}
          onClearSaved={() =>
            setConfirmation({
              title: `Delete "${boardName}"?`,
              body: (
                <p>
                  This board&apos;s drawings and every video rendered from it go from this browser.
                  Your other boards are untouched. This cannot be undone.
                </p>
              ),
              confirmLabel: 'Delete board',
              danger: true,
              onConfirm: () => {
                // Videos are keyed by clip id in IndexedDB, so they have to be
                // removed explicitly or they linger unreferenced.
                storyboard.clips.forEach((c) => void deleteVideo(c.id))
                deleteBoard(boardId)
                router.push('/')
              }
            })
          }
          onConfig={setConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {confirmation && (
        <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      )}

      {saveWarning && (
        <div className="save-warning" role="alert">
          <Icon name="alert" size={16} />
          <span>{saveWarning}</span>
        </div>
      )}

      {/* Polite, and never given focus: a status message must not interrupt
          what someone is typing. */}
      <div aria-live="polite" aria-atomic="true">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  )
}

/**
 * First run. An empty tool is the hardest screen to design and the easiest to
 * get wrong: before this it said "No clips yet", which is a description of the
 * problem rather than a way out of it.
 */
function Welcome({
  onStart,
  needsKey
}: {
  onStart(): void
  needsKey: boolean
}): React.JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome-art" aria-hidden="true">
        <span className="welcome-sheet">
          <Icon name="pen" size={26} />
        </span>
        <Icon name="arrowRight" size={22} />
        <span className="welcome-sheet">
          <Icon name="pen" size={26} />
        </span>
      </div>

      {/* h2, not h1: the app name in the top bar is the page's h1, and two of
          them would leave a screen reader with no single page title. */}
      <h2>Draw two frames. Get the movement between them.</h2>

      <button className="btn btn-primary btn-large" onClick={onStart}>
        <Icon name="plus" size={18} />
        Start your first clip
      </button>

      {/* Three words, not three paragraphs. Someone on this screen has not
          drawn anything yet, so prose about how the crew works is answering a
          question they have not asked. The product explains itself once they
          are inside it. */}
      <div className="welcome-steps">
        <article className="welcome-step">
          <h3>
            <span className="step-num">1</span>
            Draw
          </h3>
          <p>A first and last frame.</p>
        </article>
        <article className="welcome-step">
          <h3>
            <span className="step-num">2</span>
            Direct
          </h3>
          <p>Answer a few questions about the shot.</p>
        </article>
        <article className="welcome-step">
          <h3>
            <span className="step-num">3</span>
            Watch
          </h3>
          <p>Five seconds, animated.</p>
        </article>
      </div>

      {needsKey && <p className="empty">Connect a Gemini key when you are ready to animate.</p>}
    </div>
  )
}
