'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { canStitch, stitchClips, type StitchProgress } from '@/lib/stitch'
import { CLIP_SECONDS, type Storyboard } from '@/lib/types'

interface Props {
  storyboard: Storyboard
}

/**
 * The finished sequence: watch the clips back to back, or export them as one
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
    <section className="final-cut">
      <header className="detail-head">
        <h2>
          Final cut
          <span className="detail-meta">
            {rendered.length} of {storyboard.clips.length} clip
            {storyboard.clips.length === 1 ? '' : 's'} rendered · {totalSeconds}s
          </span>
        </h2>
      </header>

      {rendered.length === 0 ? (
        <p className="empty-note">
          Nothing to join yet — render at least one clip and it will appear here.
        </p>
      ) : (
        <>
          {missing > 0 && (
            <p className="hint-note">
              {missing} clip{missing === 1 ? '' : 's'} not rendered yet and will be skipped. The
              sequence follows your timeline order.
            </p>
          )}

          <div className="cut-strip">
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

          <div className="generate-row">
            <button className="btn" onClick={startPreview} disabled={playing}>
              {playing ? `Playing clip ${index + 1}…` : '▶ Play sequence'}
            </button>

            {progress ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span className="generating-note">
                  Joining clip {progress.current + 1} of {progress.total} — this runs in real time,
                  so it takes about {totalSeconds}s.
                </span>
                <button
                  className="btn"
                  onClick={() => {
                    cancelled.current = true
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void exportSequence()}
                disabled={!supported}
                title={
                  supported
                    ? 'Join every rendered clip into one downloadable file'
                    : 'This browser cannot record video'
                }
              >
                {output ? 'Rebuild single file' : 'Export single file'}
              </button>
            )}
          </div>

          {!supported && (
            <p className="hint-note">
              This browser has no MediaRecorder support, so clips can be previewed but not exported.
              Chrome or Edge will work.
            </p>
          )}

          {error && <p className="error-note">{error}</p>}

          {output && (
            <div className="cut-output">
              <video className="clip-video" src={output.url} controls loop playsInline />
              <a className="btn btn-primary" href={output.url} download={`sketchime.${output.extension}`}>
                Download .{output.extension} ({(output.bytes / 1_000_000).toFixed(1)} MB)
              </a>
              <p className="hint-note">
                Re-encoded from the individual clips, so quality is slightly below the originals.
                Like everything else here, it is lost on reload — download it if you want to keep
                it.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
