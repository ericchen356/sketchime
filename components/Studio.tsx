'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from './Canvas'
import { Timeline } from './Timeline'
import { BoardSurvey } from './BoardSurvey'
import { ClipDetail } from './ClipDetail'
import { SettingsDialog } from './SettingsDialog'
import { compilePrompt, revisionInstruction } from '@/lib/compile'
import { BOARD_H, BOARD_W, renderClipFrames } from '@/lib/render'
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
import type { BoardThreads, Sketch, Storyboard } from '@/lib/types'

/** Which frame the full-screen canvas is editing, if any. */
interface Editing {
  clipId: string
  side: 'start' | 'end'
}

export function Studio(): React.JSX.Element {
  const [storyboard, setStoryboard] = useState<Storyboard>(emptyStoryboard)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [boardFor, setBoardFor] = useState<string | null>(null)
  /** The rendered keyframes the board is currently looking at. */
  const [boardImages, setBoardImages] = useState<{ imageA: string; imageB: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

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
        const prompt = compilePrompt(c, sb.styleNote)
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
    setSelectedId(created.id)
    // Straight into drawing: a new clip with two blank frames has nothing to
    // look at, so land the user where the work is. The first clip starts on A;
    // a chained clip's A is already drawn, so start on B.
    setEditing({ clipId: created.id, side: sb.clips.length === 0 ? 'start' : 'end' })
  }, [])

  /** Any input change invalidates the compiled prompt, so recompile in place. */
  const recompile = useCallback((sb: Storyboard, clipId: string): Storyboard => {
    const clip = sb.clips.find((c) => c.id === clipId)
    if (!clip) return sb
    const prompt = compilePrompt(clip, sb.styleNote)
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
        const prompt = compilePrompt(c, styleNote)
        next = updateClip(next, c.id, { prompt: prompt ?? undefined })
      }
      return next
    })
  }, [])

  const handleFrameChange = useCallback((frameId: string, sketch: Sketch) => {
    setStoryboard((sb) => setFrameSketch(sb, frameId, sketch))
  }, [])

  const handleDelete = useCallback((clipId: string) => {
    setStoryboard((sb) => removeClip(sb, clipId))
    setSelectedId((id) => (id === clipId ? null : id))
  }, [])

  const handleLink = useCallback((index: number) => {
    const ok = window.confirm(
      'Re-link these clips?\n\nThe next clip will adopt this clip’s end frame. Whatever is drawn on its own start frame will be discarded.'
    )
    if (ok) setStoryboard((sb) => linkSeam(sb, index))
  }, [])

  const handleUnlink = useCallback((index: number) => {
    setStoryboard((sb) => unlinkSeam(sb, index))
  }, [])

  /**
   * Open the board for a clip. The keyframes are rasterised HERE, once, through
   * the clip's shared box - every agent then looks at exactly the images the
   * video model will receive, so their observations match the real output.
   */
  const openBoard = useCallback((clipId: string) => {
    const sb = storyboardRef.current
    const clip = sb.clips.find((c) => c.id === clipId)
    if (!clip) return
    // Board agents get a smaller render than the video model: enough to read a
    // line drawing, a fraction of the bytes and tokens.
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
        setToast('Prompt revised.')
      } catch (e) {
        setToast(e instanceof Error ? e.message : 'Revision failed.')
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
      // existing clip - you would click Regenerate and get the old wording back.
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
        const url = await generateClip({
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
        objectUrls.current.add(url)
        setStoryboard((sb) => {
          const prev = sb.clips.find((c) => c.id === clipId)?.videoUrl
          if (prev) {
            URL.revokeObjectURL(prev)
            objectUrls.current.delete(prev)
          }
          return updateClip(sb, clipId, { status: 'done', videoUrl: url, error: undefined })
        })
        setToast(`Clip rendered.`)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Generation failed.'
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
    setToast('Cancelling — the request may still be running on Google’s side.')
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
        header={
          <div className="canvas-header">
            <button className="btn" onClick={() => setEditing(null)}>
              ← Storyboard
            </button>

            <div className="frame-switch">
              <button
                className={`chip ${editing.side === 'start' ? 'chip-on' : ''}`}
                onClick={() => setEditing({ ...editing, side: 'start' })}
              >
                A · start
              </button>
              <button
                className={`chip ${editing.side === 'end' ? 'chip-on' : ''}`}
                onClick={() => setEditing({ ...editing, side: 'end' })}
              >
                B · end
              </button>
            </div>

            <span className="canvas-title">
              Clip {editingClipIndex + 1}
              {shared.length > 1 && (
                <span
                  className="shared-badge"
                  title="This frame is shared with an adjacent clip — edits move both, which is what keeps the cut seamless."
                >
                  shared with {shared.length - 1} other clip
                  {shared.length - 1 === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </div>
        }
      />
    )
  }

  return (
    <div className="dashboard">
      <header className="app-head">
        <h1>
          sketchime
          <span className="app-sub">multi-clip storyboard · keyframe interpolation</span>
        </h1>
        <div className="app-actions">
          {!config?.hasServerKey && !apiKey && (
            <span className="warn-pill" title="Generation and revision need a Gemini API key">
              no API key
            </span>
          )}
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      <Timeline
        storyboard={storyboard}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onEditFrame={(clipId, side) => setEditing({ clipId, side })}
        onAddClip={handleAddClip}
        onMoveClip={(from, to) => setStoryboard((sb) => moveClip(sb, from, to))}
        onLinkSeam={handleLink}
        onUnlinkSeam={handleUnlink}
      />

      {selected ? (
        <ClipDetail
          clip={selected}
          compiled={livePrompt}
          endMode={endMode}
          endModeReason={selected ? endModeReason(storyboard, selected.id) : ''}
          onEndMode={(m) =>
            setStoryboard((sb) => updateClip(sb, selected.id, { endFrameMode: m }))
          }
          index={selectedIndex}
          storyboard={storyboard}
          busy={busy}
          onIntent={(text) => handleIntent(selected.id, text)}
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
        clips.length > 0 && <p className="empty-note">Select a clip to direct it.</p>
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
          offline={!config?.hasServerKey && !apiKey}
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
          onConfig={setConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
