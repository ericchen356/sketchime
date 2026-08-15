/**
 * Rendered clips, kept in IndexedDB.
 *
 * The storyboard itself lives in localStorage, which is fine for JSON but
 * useless here: it is string-only and capped around 5MB, while a single 5-second
 * 720p clip is already a few MB. IndexedDB stores Blobs natively and its quota
 * is typically hundreds of MB or more.
 *
 * Videos are expensive - each one is a real charge against the user's Gemini
 * quota - so losing them to a reload is far worse than losing a drawing.
 */

const DB_NAME = 'sketchmotion'
/** The database written under the app's previous name. Drained once, then
 * deleted; see `migrateBrand`. */
const OLD_DB_NAME = 'sketchime'
const STORE = 'videos'
const DB_VERSION = 1

interface StoredVideo {
  clipId: string
  blob: Blob
  savedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clipId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the video store.'))
  })
}

/**
 * Move any videos stored under the app's previous name into the new database.
 *
 * Worth the code because these are the one thing here that cost money: every
 * blob is a paid render, so letting the rename orphan them would be the most
 * expensive possible way to change a brand. Run once per page load, ahead of
 * the first read or write, and best-effort throughout — a failure leaves the
 * old database alone so the next load can try again.
 */
let migration: Promise<void> | null = null
function migrateBrand(): Promise<void> {
  if (!migration) migration = runBrandMigration().catch(() => {})
  return migration
}

async function runBrandMigration(): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  // Opened without a version so an existing database keeps its own. If it does
  // not exist this creates an empty one, which the store check below then
  // cleans up.
  const old = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(OLD_DB_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  if (!old) return

  if (!old.objectStoreNames.contains(STORE)) {
    // Never used, or already drained by an earlier run.
    old.close()
    indexedDB.deleteDatabase(OLD_DB_NAME)
    return
  }

  const records = await new Promise<StoredVideo[]>((resolve) => {
    const req = old.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as StoredVideo[])
    req.onerror = () => resolve([])
  })
  old.close()

  if (records.length > 0) {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        for (const r of records) tx.objectStore(STORE).put(r)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }

  // Only once everything is safely across.
  indexedDB.deleteDatabase(OLD_DB_NAME)
}

/** Wrap one transaction, always closing the connection afterwards. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  await migrateBrand()
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error ?? new Error('Video store request failed.'))
      tx.onabort = () => reject(tx.error ?? new Error('Video store transaction aborted.'))
    })
  } finally {
    db.close()
  }
}

export interface PutResult {
  ok: boolean
  error?: string
}

/** Save (or replace) the video for a clip. */
export async function putVideo(clipId: string, blob: Blob): Promise<PutResult> {
  try {
    const record: StoredVideo = { clipId, blob, savedAt: new Date().toISOString() }
    await withStore('readwrite', (s) => s.put(record))
    return { ok: true }
  } catch (e) {
    // Quota is the likely cause and the user can act on it, so say so rather
    // than failing quietly - a video that silently vanishes cost real money.
    const quota = e instanceof Error && /quota|storage/i.test(e.message)
    return {
      ok: false,
      error: quota
        ? 'Out of browser storage — this video will not survive a reload. Delete older clips in Settings.'
        : `Could not save the video locally: ${e instanceof Error ? e.message : 'unknown error'}`
    }
  }
}

export async function getVideo(clipId: string): Promise<Blob | null> {
  try {
    const rec = await withStore<StoredVideo | undefined>('readonly', (s) => s.get(clipId))
    return rec?.blob ?? null
  } catch {
    return null
  }
}

export async function deleteVideo(clipId: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(clipId))
  } catch {
    /* nothing useful to do */
  }
}

export async function clearVideos(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.clear())
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Drop videos whose clip no longer exists. Deleting a clip removes its video
 * directly, but a clip can also disappear because saved state was replaced or
 * failed validation, which would otherwise orphan megabytes indefinitely.
 */
export async function pruneVideos(liveClipIds: string[]): Promise<void> {
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    const live = new Set(liveClipIds)
    for (const key of keys) {
      if (typeof key === 'string' && !live.has(key)) await deleteVideo(key)
    }
  } catch {
    /* best effort */
  }
}

export interface VideoStoreInfo {
  count: number
  bytes: number
  /** Browser-reported quota, when available. */
  quotaBytes?: number
}

export async function videoStoreInfo(): Promise<VideoStoreInfo | null> {
  try {
    const all = await withStore<StoredVideo[]>('readonly', (s) => s.getAll())
    const info: VideoStoreInfo = {
      count: all.length,
      bytes: all.reduce((n, r) => n + (r.blob?.size ?? 0), 0)
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      if (est.quota) info.quotaBytes = est.quota
    }
    return info
  } catch {
    return null
  }
}

export function canStoreVideos(): boolean {
  return typeof indexedDB !== 'undefined'
}
