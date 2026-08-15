'use client'

import { Modal } from './Modal'

export interface Confirmation {
  title: string
  /** One or two short paragraphs. Say what will be lost, in plain words. */
  body: React.ReactNode
  /** Label the button with the action, never "OK" — people click buttons, not
   * dialogs, and "OK" tells them nothing about what they are agreeing to. */
  confirmLabel: string
  /** Red confirm button, for anything that destroys work. */
  danger?: boolean
  onConfirm(): void
}

interface Props {
  confirmation: Confirmation
  onClose(): void
}

/**
 * Replaces `window.confirm`. The native one cannot be styled, ignores the
 * app's language and renders as a browser-chrome alert bolted to the top of the
 * window — which reads as an error even when the answer is a routine yes.
 */
export function ConfirmDialog({ confirmation, onClose }: Props): React.JSX.Element {
  const { title, body, confirmLabel, danger, onConfirm } = confirmation

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Keep it as it is
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="prose">{body}</div>
    </Modal>
  )
}
