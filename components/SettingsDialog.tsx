'use client'

import { useState } from 'react'
import type { ServerConfig } from '@/lib/gemini-client'

interface Props {
  apiKey: string
  config: ServerConfig | null
  styleNote: string
  onApiKey(key: string): void
  onStyleNote(note: string): void
  onClose(): void
}

export function SettingsDialog({
  apiKey,
  config,
  styleNote,
  onApiKey,
  onStyleNote,
  onClose
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState(apiKey)
  const [reveal, setReveal] = useState(false)

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
              A key is already configured on the server (<code>GEMINI_API_KEY</code>), and it takes
              precedence. You don&apos;t need to enter anything here.
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
              onClick={() => {
                onApiKey(draft)
                onClose()
              }}
            >
              Save
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

        {config && (
          <p className="hint-note">
            Models — text: <code>{config.textModel}</code>, video: <code>{config.videoModel}</code>.
            Override with <code>GEMINI_TEXT_MODEL</code> / <code>GEMINI_VIDEO_MODEL</code>.
          </p>
        )}
      </div>
    </div>
  )
}
