/**
 * Join the rendered clips into one video, in the browser.
 *
 * Approach: draw each clip into an offscreen canvas in sequence and record the
 * canvas stream with MediaRecorder. That is a re-encode, so it costs some
 * quality and runs in real time (a 4-clip board takes ~20s) - but it needs no
 * dependency, no server, and no cross-origin headers. The alternative,
 * ffmpeg.wasm, is a ~25MB download and requires COOP/COEP headers to get
 * SharedArrayBuffer, which is a lot of machinery for concatenating four files.
 *
 * The `<video>` elements read blob: URLs from this same page, so nothing leaves
 * the browser and no key is involved.
 */

/** Output size. Matches the render size the video model was asked for. */
export const OUT_W = 1280
export const OUT_H = 720
export const OUT_FPS = 30

export interface StitchProgress {
  /** Clips finished so far. */
  done: number
  total: number
  /** Index currently being recorded. */
  current: number
}

export interface StitchOptions {
  onProgress?(p: StitchProgress): void
  /** Polled between and during clips so a long stitch can be abandoned. */
  isCancelled?(): boolean
}

export interface StitchResult {
  blob: Blob
  /** File extension matching the codec actually used. */
  extension: string
}

/** MediaRecorder support varies by browser; take the best available. */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

export function canStitch(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    pickMimeType() !== null &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

/** Load a clip and wait until it can actually be drawn. */
function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.src = url
    // Muted + playsInline is what allows programmatic play() without a gesture.
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadeddata = () => resolve(v)
    v.onerror = () => reject(new Error('A clip could not be loaded for stitching.'))
  })
}

/**
 * Play one clip through, drawing every frame onto the canvas. Resolves when the
 * clip ends.
 *
 * Letterboxed rather than cropped: clips should already be 16:9, but a mismatch
 * should lose black bars, not the top of someone's drawing.
 */
function drawClip(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  isCancelled?: () => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const scale = Math.min(OUT_W / video.videoWidth, OUT_H / video.videoHeight)
    const w = video.videoWidth * scale
    const h = video.videoHeight * scale
    const x = (OUT_W - w) / 2
    const y = (OUT_H - h) / 2

    let raf = 0
    const stop = (): void => cancelAnimationFrame(raf)

    const tick = (): void => {
      if (isCancelled?.()) {
        stop()
        video.pause()
        reject(new Error('Cancelled.'))
        return
      }
      // White, not black: these clips are white-paper animation, so any
      // letterbox band should disappear into the artwork rather than frame it.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, OUT_W, OUT_H)
      ctx.drawImage(video, x, y, w, h)
      raf = requestAnimationFrame(tick)
    }

    video.onended = () => {
      // One last draw so the final frame is definitely in the recording, then
      // let a couple of frames flush before moving on.
      ctx.drawImage(video, x, y, w, h)
      stop()
      setTimeout(resolve, 80)
    }
    video.onerror = () => {
      stop()
      reject(new Error('A clip failed during playback.'))
    }

    video.currentTime = 0
    void video.play().then(() => {
      raf = requestAnimationFrame(tick)
    }).catch(reject)
  })
}

/**
 * Concatenate clips, in the order given, into a single recording.
 * The caller owns the returned blob.
 */
export async function stitchClips(urls: string[], opts: StitchOptions = {}): Promise<StitchResult> {
  if (urls.length === 0) throw new Error('There are no rendered clips to join.')

  const mimeType = pickMimeType()
  if (!mimeType) throw new Error('This browser cannot record video (MediaRecorder unavailable).')

  const canvas = document.createElement('canvas')
  canvas.width = OUT_W
  canvas.height = OUT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not open a drawing context for stitching.')

  // Paper-white first frame, so the recording never opens on a transparent
  // canvas and never flashes black before the first clip appears.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, OUT_W, OUT_H)

  // Load everything up front: a mid-stitch load stall would be recorded as a
  // frozen frame in the finished video.
  const videos: HTMLVideoElement[] = []
  for (const url of urls) videos.push(await loadVideo(url))

  const stream = canvas.captureStream(OUT_FPS)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start(200)
  try {
    for (let i = 0; i < videos.length; i++) {
      opts.onProgress?.({ done: i, total: videos.length, current: i })
      await drawClip(ctx, videos[i], opts.isCancelled)
    }
    opts.onProgress?.({ done: videos.length, total: videos.length, current: videos.length - 1 })
  } finally {
    // Stop even on cancel/failure, or the stream and its tracks leak.
    if (recorder.state !== 'inactive') recorder.stop()
    await finished
    stream.getTracks().forEach((t) => t.stop())
    videos.forEach((v) => {
      v.pause()
      v.removeAttribute('src')
      v.load()
    })
  }

  return {
    blob: new Blob(chunks, { type: mimeType }),
    extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
  }
}
