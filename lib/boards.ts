import { loadStoryboard as loadLegacy, packStoryboard, unpackStoryboard } from './persist'
import type { Storyboard } from './types'

/**
 * Multiple storyboards, in localStorage.
 *
 * Layout: one small index of metadata, plus one key per board. Boards are kept
 * separate rather than in a single blob so saving the open board does not
 * rewrite every other board on every stroke - and so one corrupt board cannot
 * take the rest down with it.
 */
const INDEX_KEY = 'sketchmotion.boards'
const BOARD_PREFIX = 'sketchmotion.board.'
/**
 * The same keys under the app's previous name. Renaming the app renamed these
 * with it, so anything already in a browser has to be carried across or the
 * library silently comes back empty. See `migrateBrand`.
 */
const OLD_INDEX_KEY = 'sketchime.boards'
const OLD_BOARD_PREFIX = 'sketchime.board.'
/** The single-board key used before boards existed. Migrated once, then left
 * alone rather than deleted, so a downgrade does not lose the work.
 *
 * This one keeps the old brand on purpose: it names a key that was written in
 * the past, and a legacy key that does not match the legacy finds nothing. */
const LEGACY_KEY = 'sketchime.storyboard'
const INDEX_VERSION = 1

export interface BoardMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** Denormalised so the home page can list boards without parsing each one. */
  clips: number
}

interface BoardIndex {
  version: number
  boards: BoardMeta[]
}

const newId = (): string => crypto.randomUUID()
const boardKey = (id: string): string => `${BOARD_PREFIX}${id}`

/**
 * Carry localStorage across the rename from sketchime to SketchMotion.
 *
 * Board bodies move one at a time and the index moves last, which makes this
 * both idempotent and crash-safe: a failure part-way through leaves the old
 * index in place, so the next load simply resumes with whatever is left. Only
 * one board is ever duplicated at a time, which matters because localStorage
 * is capped around 5MB and a board can be megabytes on its own.
 */
let brandMigrated = false
function migrateBrand(): void {
  if (brandMigrated || typeof window === 'undefined') return
  brandMigrated = true
  try {
    const ls = window.localStorage
    // Nothing to do once the index has moved, or if there was never an old one.
    if (ls.getItem(INDEX_KEY) !== null || ls.getItem(OLD_INDEX_KEY) === null) return

    for (const key of Object.keys(ls)) {
      if (!key.startsWith(OLD_BOARD_PREFIX)) continue
      const body = ls.getItem(key)
      if (body === null) continue
      ls.setItem(BOARD_PREFIX + key.slice(OLD_BOARD_PREFIX.length), body)
      ls.removeItem(key)
    }

    // Last, so an interrupted run is detected and repeated rather than leaving
    // an index that points at boards which have not moved yet.
    const index = ls.getItem(OLD_INDEX_KEY)
    if (index !== null) {
      ls.setItem(INDEX_KEY, index)
      ls.removeItem(OLD_INDEX_KEY)
    }
  } catch {
    /* best effort - a failed migration leaves the old keys untouched */
  }
}

function readIndex(): BoardIndex {
  if (typeof window === 'undefined') return { version: INDEX_VERSION, boards: [] }
  migrateBrand()
  try {
    const raw = window.localStorage.getItem(INDEX_KEY)
    if (!raw) return { version: INDEX_VERSION, boards: [] }
    const parsed = JSON.parse(raw) as BoardIndex
    if (parsed?.version !== INDEX_VERSION || !Array.isArray(parsed.boards)) {
      return { version: INDEX_VERSION, boards: [] }
    }
    // Drop anything malformed rather than rendering a broken card.
    return {
      version: INDEX_VERSION,
      boards: parsed.boards.filter(
        (b): b is BoardMeta => !!b && typeof b.id === 'string' && typeof b.name === 'string'
      )
    }
  } catch {
    return { version: INDEX_VERSION, boards: [] }
  }
}

function writeIndex(index: BoardIndex): boolean {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    return true
  } catch {
    return false
  }
}

/**
 * Newest-edited first, which is the order people actually want.
 *
 * createdAt breaks ties: ISO timestamps only go to milliseconds, so two boards
 * touched in the same tick would otherwise fall back to insertion order, which
 * is arbitrary and looks like a bug.
 */
export function listBoards(): BoardMeta[] {
  // migrateLegacy reads the index, and readIndex runs the rename migration
  // first, so the pre-boards import cannot run against a half-renamed library.
  migrateLegacy()
  return readIndex().boards.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt)
  )
}

export function createBoard(name?: string): BoardMeta {
  const index = readIndex()
  const now = new Date().toISOString()
  const meta: BoardMeta = {
    id: newId(),
    name: name?.trim() || `Board ${index.boards.length + 1}`,
    createdAt: now,
    updatedAt: now,
    clips: 0
  }
  index.boards.push(meta)
  writeIndex(index)
  return meta
}

export function loadBoard(id: string): Storyboard | null {
  if (typeof window === 'undefined') return null
  // Deep links open a board without listing them first, so this path has to
  // trigger the rename migration too.
  migrateBrand()
  try {
    const raw = window.localStorage.getItem(boardKey(id))
    if (!raw) return null
    return unpackStoryboard(JSON.parse(raw))
  } catch {
    return null
  }
}

export interface SaveResult {
  ok: boolean
  bytes?: number
  warning?: string
}

export function saveBoard(id: string, sb: Storyboard): SaveResult {
  if (typeof window === 'undefined') return { ok: false }

  let json: string
  try {
    json = JSON.stringify(packStoryboard(sb))
  } catch {
    return { ok: false, warning: 'Could not serialise this board.' }
  }

  try {
    window.localStorage.setItem(boardKey(id), json)
  } catch {
    return {
      ok: false,
      bytes: json.length,
      warning:
        'Out of local storage space — this board is NOT being saved. Delete a board or clear saved work in Settings.'
    }
  }

  // Keep the index in step so the home page shows an accurate clip count and
  // sort order without opening every board.
  const index = readIndex()
  const meta = index.boards.find((b) => b.id === id)
  if (meta) {
    meta.updatedAt = new Date().toISOString()
    meta.clips = sb.clips.length
    writeIndex(index)
  }

  return {
    ok: true,
    bytes: json.length,
    warning:
      json.length > 3_500_000
        ? 'This board is close to the browser storage limit; further drawing may stop saving.'
        : undefined
  }
}

export function renameBoard(id: string, name: string): void {
  const index = readIndex()
  const meta = index.boards.find((b) => b.id === id)
  if (!meta) return

  // A blank or unchanged name is not an edit. Bumping updatedAt anyway would
  // reorder the library on an action that changed nothing.
  const next = name.trim()
  if (!next || next === meta.name) return

  meta.name = next
  meta.updatedAt = new Date().toISOString()
  writeIndex(index)
}

export function deleteBoard(id: string): void {
  const index = readIndex()
  index.boards = index.boards.filter((b) => b.id !== id)
  writeIndex(index)
  try {
    window.localStorage.removeItem(boardKey(id))
  } catch {
    /* nothing useful to do */
  }
}

export function boardMeta(id: string): BoardMeta | null {
  return readIndex().boards.find((b) => b.id === id) ?? null
}

/**
 * Every clip id across EVERY board.
 *
 * Video pruning uses this. Pruning against only the open board would delete the
 * rendered videos belonging to all the others - an expensive mistake, since each
 * one cost real money to generate.
 */
export function allClipIds(): string[] {
  const ids: string[] = []
  for (const meta of readIndex().boards) {
    const sb = loadBoard(meta.id)
    if (sb) ids.push(...sb.clips.map((c) => c.id))
  }
  return ids
}

/** Total bytes across the index and every board. */
export function boardsBytes(): number {
  if (typeof window === 'undefined') return 0
  let total = 0
  try {
    total += window.localStorage.getItem(INDEX_KEY)?.length ?? 0
    for (const meta of readIndex().boards) {
      total += window.localStorage.getItem(boardKey(meta.id))?.length ?? 0
    }
  } catch {
    /* best effort */
  }
  return total
}

/**
 * Import work saved before boards existed, once, so upgrading does not appear
 * to delete someone's storyboard. The legacy key is left in place: harmless,
 * and it means a rollback still finds the work.
 */
function migrateLegacy(): void {
  if (typeof window === 'undefined') return
  const index = readIndex()
  if (index.boards.length > 0) return

  let legacyRaw: string | null = null
  try {
    legacyRaw = window.localStorage.getItem(LEGACY_KEY)
  } catch {
    return
  }
  if (!legacyRaw) return

  const sb = loadLegacy()
  if (!sb || (sb.clips.length === 0 && Object.keys(sb.frames).length === 0)) return

  const meta = createBoard('My first board')
  saveBoard(meta.id, sb)
}
