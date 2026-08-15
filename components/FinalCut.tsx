'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { canStitch, stitchClips, type StitchProgress } from '@/lib/stitch'
import { CLIP_SECONDS, type Storyboard } from '@/lib/types'

interface Props {
  storyboard: Storyboard
}

/**
 * The finished sequence: watch the clips back to back, or save them as one
 * file.
 *
 * Preview and export are deliberately separate. Previewing is instant and
 * lossless - it just plays each clip in turn - whereas exporting re-encodes in
 * real time. Making people wait through an encode just to check the order would
 * be the wrong default.
 */
export function FinalCut({ storyboard }: Props): React.JSX.Element | null {
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [progress, setProgress] = useState<StitchProgress | null>(null)
  const [output, setOutput] = useState<{ url: string; extension: string; bytes: number } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cancelled = useRef(false)
  const outputRef = useRef<string | null>(null)

  // Timeline order, not render order: the sequence is what the user arranged.
  const rendered = storyboard.clips.filter((c) => c.videoUrl)
  const missing = storyboard.clips.length - rendered.length
  const urls = rendered.map((c) => c.videoUrl as string)

  // A stitched file outlives React state unless explicitly revoked.
  useEffect(() => {
    return () => {
      if (outputRef.current) URL.revokeObjectURL(outputRef.current)
    }
  }, [])

  // Any change to the clip set makes an existing export stale.
  const signature = urls.join('|')
  useEffect(() => {
    setOutput((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.url)
        outputRef.current = null
      }
      return null
    })
  }, [signature])

  /* ---------- preview ---------- */

  const playFrom = useCallback(
    (i: number) => {
      const v = videoRef.current
      if (!v || i >= urls.length) {
        setPlaying(false)
        return
      }
      setIndex(i)
      v.src = urls[i]
      void v.play().catch(() => setPlaying(false))
    },
    [urls]
  )

  const startPreview = (): void => {
    setPlaying(true)
    playFrom(0)
  }

  /* ---------- export ---------- */

  const exportSequence = useCallback(async () => {
    if (urls.length === 0) return
    cancelled.current = false
    setError(null)
    setProgress({ done: 0, total: urls.length, current: 0 })

    try {
      const { blob, extension } = await stitchClips(urls, {
        onProgress: setProgress,
        isCancelled: () => cancelled.current
      })
      const url = URL.createObjectURL(blob)
      outputRef.current = url
      setOutput({ url, extension, bytes: blob.size })
    } catch (e) {
      if (!cancelled.current) {
        setError(e instanceof Error ? e.message : 'Could not join the clips.')
      }
    } finally {
      setProgress(null)
    }
  }, [urls])

  if (storyboard.clips.length === 0) return null

  const totalSeconds = rendered.length * CLIP_SECONDS
  const supported = canStitch()

  return (
    <section className="card">
      <header className="section-head">
        <h2>
          <Icon name="film" size={17} />
          The whole thing
          <span className="section-meta">
            {rendered.length} of {storyboard.clips.length} clip
            {storyboard.clips.length === 1 ? '' : 's'} ready · {totalSeconds}s
          </span>
        </h2>
      </header>

      {rendered.length === 0 ? (
        <p className="empty">
          Nothing to watch yet. Make your first clip above and it will show up here, ready to play
          end to end.
        </p>
      ) : (
        <>
          {missing > 0 && (
            <p className="field-hint">
              {missing} clip{missing === 1 ? '' : 's'} not made yet, so {missing === 1 ? 'it' : 'they'}{' '}
              will be skipped. The order follows your storyboard.
            </p>
          )}

          <div className="cut-pills">
            {rendered.map((c, i) => {
              const n = storyboard.clips.findIndex((x) => x.id === c.id) + 1
              return (
                <span
                  key={c.id}
                  className={`cut-pill ${playing && i === index ? 'cut-pill-on' : ''}`}
                  title={c.intent || `Clip ${n}`}
                >
                  {n}
                </span>
              )
            })}
          </div>

          {/* Preview: plays each clip in turn by swapping the source. No
              encoding, so it is instant and lossless. */}
          <video
            ref={videoRef}
            className="clip-video"
            playsInline
            controls={!playing}
            onEnded={() => playFrom(index + 1)}
          />

          <div className="cta-row">
            <button className="btn" onClick={startPreview} disabled={playing}>
              <Icon name="play" size={15} />
              {playing ? `Playing clip ${index + 1}…` : 'Play it all'}
            </button>

            {progress ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span className="cta-note" aria-live="polite">
                  Joining clip {progress.current + 1} of {progress.total} — this happens in real
                  time, so give it about {totalSeconds} seconds.
                </span>
                <button
                  className="btn btn-small"
                  onClick={() => {
                    cancelled.current = true
                  }}
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void exportSequence()}
                disabled={!supported}
                title={
                  supported
                    ? 'Join every finished clip into one file you can save'
                    : 'This browser cannot record video'
                }
              >
                <Icon name="download" size={15} />
                {output ? 'Build it again' : 'Save as one video'}
              </button>
            )}
          </div>

          {!supported && (
            <p className="notice notice-warn">
              <Icon name="alert" size={16} />
              This browser cannot record video, so clips can be watched here but not saved as one
              file. Chrome or Edge will work.
            </p>
          )}

          {error && (
            <p className="notice notice-error">
              <Icon name="alert" size={16} />
              {error}
            </p>
          )}

          {output && (
            <div className="cut-out">
              <video className="clip-video" src={output.url} controls loop playsInline />
              <a
                className="btn btn-primary"
                href={output.url}
                download={`sketchime.${output.extension}`}
              >
                <Icon name="download" size={15} />
                Download ({(output.bytes / 1_000_000).toFixed(1)} MB)
              </a>
              <p className="field-hint">
                Re-encoded from the individual clips, so it is very slightly softer than the
                originals.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
