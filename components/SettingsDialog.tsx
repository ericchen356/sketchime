'use client'

import { useState } from 'react'
import { resolveModels, type ServerConfig } from '@/lib/gemini-client'
import { savedInfo } from '@/lib/persist'

interface Props {
  apiKey: string
  config: ServerConfig | null
  styleNote: string
  onApiKey(key: string): void
  onStyleNote(note: string): void
  onClearSaved(): void
  onConfig(config: ServerConfig): void
  onClose(): void
}

export function SettingsDialog({
  apiKey,
  config,
  styleNote,
  onApiKey,
  onStyleNote,
  onClearSaved,
  onConfig,
  onClose
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState(apiKey)
  const [reveal, setReveal] = useState(false)
  const [checking, setChecking] = useState(false)
  // Read once on open: it only changes when the user clears it from here.
  const [saved] = useState(() => savedInfo())
  const [checkError, setCheckError] = useState<string | null>(null)

  /** Save, then immediately ask Google which models this key can call - a bad
   * key or a retired model shows up here rather than mid-way through a board. */
  const saveAndCheck = async (): Promise<void> => {
    onApiKey(draft)
    setChecking(true)
    setCheckError(null)
    try {
      onConfig(await resolveModels(draft))
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Could not verify the key.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="modal-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="board-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <label className="field">
          <span className="field-label">Gemini API key</span>
          {config?.hasServerKey ? (
            <p className="hint-note">
              A key is configured on the server (<code>GEMINI_API_KEY</code>) and is used by
              default. Anything you enter here <b>overrides</b> it for this tab — useful when the
              server&apos;s key is stale or out of quota.
            </p>
          ) : (
            <p className="hint-note">
              Kept in this tab&apos;s session memory only — never written to disk, gone when the tab
              closes. For a deployment, set <code>GEMINI_API_KEY</code> in <code>.env.local</code>{' '}
              instead so the key never reaches the browser.
            </p>
          )}
          <div className="key-row">
            <input
              className="field-input"
              type={reveal ? 'text' : 'password'}
              placeholder="AIza…"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn btn-small" onClick={() => setReveal((r) => !r)}>
              {reveal ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn btn-small btn-primary"
              onClick={() => void saveAndCheck()}
              disabled={checking}
            >
              {checking ? 'Checking…' : 'Save & check'}
            </button>
          </div>
        </label>

        <label className="field">
          <span className="field-label">Art style note</span>
          <p className="hint-note">
            Folded into every clip&apos;s prompt so the whole board renders consistently. Describe
            your medium and line quality.
          </p>
          <textarea
            className="field-input"
            rows={3}
            placeholder="e.g. ballpoint pen on lined paper, scratchy uneven lines, no fills"
            value={styleNote}
            onChange={(e) => onStyleNote(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">Saved work</span>
          {saved ? (
            <>
              <p className="hint-note">
                {saved.clips} clip{saved.clips === 1 ? '' : 's'} saved in this browser (
                {(saved.bytes / 1024).toFixed(0)} KB), last written{' '}
                {new Date(saved.savedAt).toLocaleString()}. Your drawings come back when you
                reload. Rendered videos do not — those live only in the page.
              </p>
              <button className="btn btn-small btn-ghost" onClick={onClearSaved}>
                Delete saved work
              </button>
            </>
          ) : (
            <p className="hint-note">
              Nothing saved yet. Your storyboard is written to this browser automatically as you
              draw.
            </p>
          )}
        </div>

        {checkError && <p className="error-note">{checkError}</p>}

        {config && (
          <p className="hint-note">
            {config.resolved ? (
              <>
                <b>Confirmed for this key</b> — text: <code>{config.textModel}</code>
                {config.textOverridden && ' (env override)'}, video:{' '}
                <code>{config.videoModel}</code>
                {config.videoOverridden && ' (env override)'}.
              </>
            ) : (
              <>
                Preferred models — text: <code>{config.textModel}</code>, video:{' '}
                <code>{config.videoModel}</code>. Save a key to confirm what it can actually call;
                the app picks the best available automatically.
              </>
            )}{' '}
            Force a specific one with <code>GEMINI_TEXT_MODEL</code> /{' '}
            <code>GEMINI_VIDEO_MODEL</code>.
          </p>
        )}
      </div>
    </div>
  )
}
