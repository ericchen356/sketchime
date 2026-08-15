'use client'

import { useCallback, useEffect, useId, useRef } from 'react'
import { Icon } from './Icon'

interface Props {
  title: string
  /** Small line above the title, for context like "Clip 2". */
  eyebrow?: React.ReactNode
  /** One quiet line below the title. Belongs in the header rather than the
   * body so it cannot collide with whatever the body starts with. */
  subtitle?: React.ReactNode
  /** Extra content in the header, right of the title block. */
  aside?: React.ReactNode
  /** Widen for content that needs it (the crew room). */
  wide?: boolean
  onClose(): void
  children: React.ReactNode
  footer?: React.ReactNode
  /** Push the first footer control to the left edge — for a "Back / Cancel"
   * that should not sit next to the action it undoes. */
  footerSplit?: boolean
}

const FOCUSABLE =
  'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * The one dialog shell. Every modal in the app goes through it so they all
 * behave the same way: Escape closes, a click on the scrim closes, focus is
 * trapped while open and handed back to whatever opened it on the way out.
 *
 * Those last two are the reason this exists rather than each dialog rolling its
 * own markup — a dialog you can tab out of, into the page behind it, is
 * unusable with a keyboard and there is no way to tell from looking at it.
 */
export function Modal({
  title,
  eyebrow,
  subtitle,
  aside,
  wide,
  onClose,
  children,
  footer,
  footerSplit
}: Props): React.JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null)
  const headingId = useId()
  /** Whatever had focus before we opened, so it can be given back. */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    // Focus the panel itself rather than its first control: landing on "Close"
    // or on a text field both misrepresent what the dialog is for, and a screen
    // reader reads the dialog's label from here.
    panel.current?.focus()
    return () => opener.current?.focus?.()
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return

      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      // Wrap at both ends. Without this, Tab walks out of the dialog and into
      // the page behind the scrim, which is invisible to the user.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose]
  )

  return (
    <div
      className="scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={panel}
      >
        <header className="modal-head">
          <div className="modal-titles">
            {eyebrow && <p className="modal-eyebrow">{eyebrow}</p>}
            <h2 id={headingId}>{title}</h2>
            {subtitle && <p className="modal-topic">{subtitle}</p>}
          </div>
          {aside}
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">{children}</div>

        {footer && (
          <footer className={`modal-foot${footerSplit ? ' modal-foot-split' : ''}`}>{footer}</footer>
        )}
      </div>
    </div>
  )
}
