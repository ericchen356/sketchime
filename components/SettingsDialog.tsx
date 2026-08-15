'use client'

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { resolveModels, type ServerConfig } from '@/lib/gemini-client'
import { savedInfo } from '@/lib/persist'
import { videoStoreInfo, type VideoStoreInfo } from '@/lib/videoStore'

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
  // IndexedDB is async, so unlike the localStorage summary this has to load.
  const [videos, setVideos] = useState<VideoStoreInfo | null>(null)
  useEffect(() => {
    void videoStoreInfo().then(setVideos)
  }, [])
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkedOk, setCheckedOk] = useState(false)

  /** Save, then immediately ask Google which models this key can call - a bad
   * key or a retired model shows up here rather than mid-way through a clip. */
  const saveAndCheck = async (): Promise<void> => {
    onApiKey(draft)
    setChecking(true)
    setCheckError(null)
    setCheckedOk(false)
    try {
      onConfig(await resolveModels(draft))
      setCheckedOk(true)
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Could not check that key.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {/* ---------- connection ---------- */}

      <div className="setting-group">
        <span className="field-label">Gemini key</span>
        <p className="field-hint">
          {config?.hasServerKey
            ? 'A key is already set up on the server, so everything works without doing anything here. A key you paste below takes over for this tab — useful if the server’s one has run out.'
            : 'Needed to talk to your crew and to make animations. Drawing works without one. It is kept in this tab only, and is gone when you close it.'}
        </p>

        <div className="key-row">
          <input
            className="field-input"
            type={reveal ? 'text' : 'password'}
            placeholder="AIza…"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            aria-label="Gemini API key"
            onChange={(e) => {
              setDraft(e.target.value)
              setCheckedOk(false)
            }}
          />
          <button className="btn" onClick={() => setReveal((r) => !r)}>
            {reveal ? 'Hide' : 'Show'}
          </button>
          <button className="btn btn-primary" onClick={() => void saveAndCheck()} disabled={checking}>
            {checking ? 'Checking…' : 'Save and check'}
          </button>
        </div>

        {checkError && (
          <p className="notice notice-error">
            <Icon name="alert" size={16} />
            {checkError}
          </p>
        )}
        {checkedOk && !checkError && (
          <p className="notice notice-info">
            <Icon name="check" size={16} />
            That key works — you are all set.
          </p>
        )}
      </div>

      {/* ---------- style ---------- */}

      <div className="setting-group">
        <label className="field">
          <span className="field-label">Your drawing style</span>
          <p className="field-hint">
            Describe how your drawings look, in your own words. It is folded into every clip, so
            the whole thing comes out looking like one piece.
          </p>
          <textarea
            className="field-input"
            rows={3}
            placeholder="Ballpoint pen on lined paper, scratchy uneven lines, nothing filled in"
            value={styleNote}
            onChange={(e) => onStyleNote(e.target.value)}
          />
        </label>
      </div>

      {/* ---------- saved work ---------- */}

      <div className="setting-group">
        <span className="field-label">Your saved work</span>
        {saved ? (
          <>
            <p className="field-hint">
              {saved.clips} clip{saved.clips === 1 ? '' : 's'} saved in this browser (
              {(saved.bytes / 1024).toFixed(0)} KB of drawings), last saved{' '}
              {new Date(saved.savedAt).toLocaleString()}.
              {videos && videos.count > 0
                ? ` ${videos.count} finished video${videos.count === 1 ? '' : 's'} saved too (${(
                    videos.bytes /
                    1_000_000
                  ).toFixed(1)} MB${
                    videos.quotaBytes
                      ? ` of roughly ${(videos.quotaBytes / 1_000_000_000).toFixed(1)} GB available`
                      : ''
                  }).`
                : ' No finished videos saved yet.'}{' '}
              Both come back when you reload.
            </p>
            <div>
              <button className="btn btn-small" onClick={onClearSaved}>
                <Icon name="trash" size={14} />
                Delete saved work{videos && videos.count > 0 ? ' and videos' : ''}
              </button>
            </div>
          </>
        ) : (
          <p className="field-hint">
            Nothing saved yet. Your storyboard is saved to this browser automatically as you draw.
          </p>
        )}
      </div>

      {/* ---------- the machinery ----------
          Model ids and environment variables matter to whoever deploys this,
          and to nobody else. One click away, not in everyone's face. */}
      <details className="adv">
        <summary className="adv-summary">
          <Icon name="chevron" size={16} />
          Technical details
        </summary>
        <div className="adv-body">
          {config ? (
            <>
              <p className="model-line">
                <span>{config.resolved ? 'Confirmed for this key.' : 'Preferred, not yet confirmed.'}</span>
                <span>
                  Text: <code>{config.textModel}</code>
                  {config.textOverridden && ' (env override)'}
                </span>
                <span>
                  Video: <code>{config.videoModel}</code>
                  {config.videoOverridden && ' (env override)'}
                </span>
              </p>
              <p className="field-hint">
                Models are discovered at runtime rather than hardcoded, because ids get retired and
                one key can call a different set from the next. Pin a specific one with{' '}
                <code>GEMINI_TEXT_MODEL</code> or <code>GEMINI_VIDEO_MODEL</code>. For a
                deployment, set <code>GEMINI_API_KEY</code> in <code>.env.local</code> so the key
                never reaches the browser at all.
              </p>
            </>
          ) : (
            <p className="field-hint">Could not reach the server for model information.</p>
          )}
        </div>
      </details>
    </Modal>
  )
}
