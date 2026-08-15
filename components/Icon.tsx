/**
 * One icon family for the whole app.
 *
 * Everything is drawn on the same 20x20 grid at stroke 1.5 with round caps, so
 * the tool rail, the storyboard cards and the dialogs all read as one set. That
 * consistency is the point: the app previously mixed hand-drawn SVGs in the
 * rail with text glyphs elsewhere (a braille grip, a chain link, a lightning
 * bolt, a multiplication sign for close), which render differently on every
 * platform and cannot be themed.
 *
 * Icons are decorative by default (`aria-hidden`) because they nearly always
 * sit beside a visible label. Pass a `title` only for the rare standalone icon
 * that carries meaning on its own.
 */

export type IconName =
  | 'pen'
  | 'eraser'
  | 'text'
  | 'hand'
  | 'undo'
  | 'trash'
  | 'plus'
  | 'settings'
  | 'close'
  | 'grip'
  | 'link'
  | 'cut'
  | 'arrowRight'
  | 'arrowLeft'
  | 'play'
  | 'download'
  | 'check'
  | 'alert'
  | 'sparkle'
  | 'chevron'
  | 'copy'
  | 'crew'
  | 'refresh'
  | 'film'
  | 'frames'
  | 'key'
  | 'more'
  | 'onion'
  | 'director'
  | 'camera'
  | 'motion'
  | 'palette'

interface Props {
  name: IconName
  /** Rendered size in px. The grid is 20, so 20 is 1:1. */
  size?: number
  /** Supply only when the icon is the sole content of a meaningful element. */
  title?: string
  className?: string
}

export function Icon({ name, size = 18, title, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {PATHS[name]}
    </svg>
  )
}

const PATHS: Record<IconName, React.JSX.Element> = {
  pen: (
    <>
      <path d="M13.4 3.6l3 3L7.9 15.1l-3.9.9.9-3.9z" />
      <path d="M11.9 5.1l3 3" />
    </>
  ),
  eraser: (
    <>
      <rect x="3.4" y="7.6" width="12" height="7" rx="1.6" transform="rotate(-40 9.4 11.1)" />
      <path d="M6 16.5h10.5" />
    </>
  ),
  text: <path d="M4.5 5.5V4h11v1.5M10 4v12M7.5 16h5" />,
  hand: <path d="M10 3.2v7M7.4 5v5.2M12.6 5.2v5M15 7.6v4.2a5 5 0 0 1-5 5 5 5 0 0 1-5-5V9" />,
  undo: (
    <>
      <path d="M6.5 7.5H12a4 4 0 0 1 0 8H7" />
      <path d="M9 4.5l-3.2 3L9 10.5" />
    </>
  ),
  trash: <path d="M4.5 6h11M8 6V4.4h4V6M6 6l.7 9.2a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" />,
  plus: <path d="M10 4.6v10.8M4.6 10h10.8" />,
  settings: (
    <>
      <path d="M3.5 6.5h5M11.5 6.5h5M3.5 13.5h2M8.5 13.5h8" />
      <circle cx="10" cy="6.5" r="1.9" />
      <circle cx="7" cy="13.5" r="1.9" />
    </>
  ),
  close: <path d="M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8" />,
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="7.6" cy="5.4" r="1.15" />
      <circle cx="12.4" cy="5.4" r="1.15" />
      <circle cx="7.6" cy="10" r="1.15" />
      <circle cx="12.4" cy="10" r="1.15" />
      <circle cx="7.6" cy="14.6" r="1.15" />
      <circle cx="12.4" cy="14.6" r="1.15" />
    </g>
  ),
  link: (
    <>
      <path d="M8.3 11.7a2.8 2.8 0 0 0 4 0l2.3-2.3a2.8 2.8 0 0 0-4-4l-.9.9" />
      <path d="M11.7 8.3a2.8 2.8 0 0 0-4 0L5.4 10.6a2.8 2.8 0 0 0 4 4l.9-.9" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="14.4" r="1.8" />
      <circle cx="14" cy="14.4" r="1.8" />
      <path d="M7.3 13.1L14.6 4.6M12.7 13.1L5.4 4.6" />
    </>
  ),
  arrowRight: <path d="M4 10h11.4M11.4 6.2L15.6 10l-4.2 3.8" />,
  arrowLeft: <path d="M16 10H4.6M8.6 6.2L4.4 10l4.2 3.8" />,
  play: <path d="M6.8 4.9l8.4 5.1-8.4 5.1z" fill="currentColor" strokeLinejoin="round" />,
  download: <path d="M10 3.6v8.6M6.7 9.2L10 12.4l3.3-3.2M4.2 16h11.6" />,
  check: <path d="M4.6 10.4l3.5 3.5 7.3-7.8" />,
  alert: (
    <>
      <path d="M10 3.4L2.9 16.2h14.2z" />
      <path d="M10 8v3.6" />
      <circle cx="10" cy="13.9" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  sparkle: (
    <>
      <path d="M8.2 3.2l1.3 3.3 3.3 1.3-3.3 1.3-1.3 3.3-1.3-3.3L3.6 7.8l3.3-1.3z" />
      <path d="M14.4 12.1l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  chevron: <path d="M5.8 7.8L10 12l4.2-4.2" />,
  copy: (
    <>
      <rect x="7.2" y="7.2" width="8.4" height="8.4" rx="1.8" />
      <path d="M12.4 4.4H5.8a1.4 1.4 0 0 0-1.4 1.4v6.6" />
    </>
  ),
  // Clapperboard: pacing and timing.
  director: (
    <>
      <path d="M2.5 7.5h15v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />
      <path d="M2.8 7.5 4.4 3.6l14.3 1.6-.5 2.3z" />
      <path d="m7.6 4.1-1.3 3.4M12 4.6l-1.3 3.4" />
    </>
  ),
  // Camera: framing and movement.
  camera: (
    <>
      <path d="M2.5 6.5h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
      <path d="m12.5 10 5-2.6v5.2z" />
    </>
  ),
  // An arc with follow-through: deformation and secondary motion.
  motion: (
    <>
      <path d="M2.5 14.5c3.5-8 11.5-8 15 0" />
      <circle cx="5" cy="13.6" r="1.4" />
      <circle cx="15" cy="13.6" r="1.4" />
    </>
  ),
  // Palette: backdrop, effects and colour.
  palette: (
    <>
      <path d="M10 2.5a7.5 7.5 0 0 0 0 15c1 0 1.6-.7 1.6-1.5 0-.9-.8-1.3-.8-2.1 0-.7.6-1.2 1.3-1.2h1.5A4.4 4.4 0 0 0 18 8.2C17.6 4.9 14.1 2.5 10 2.5z" />
      <circle cx="6.6" cy="8.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.8" cy="6.1" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.3" cy="7.4" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  crew: (
    <>
      <circle cx="7.6" cy="7.2" r="2.5" />
      <path d="M3 16.2a4.6 4.6 0 0 1 9.2 0" />
      <path d="M13 5.1a2.5 2.5 0 0 1 0 4.6M14.4 16.2a4.6 4.6 0 0 0-1.3-3.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M16 10a6 6 0 1 1-1.9-4.4" />
      <path d="M16.2 3.6v3.2H13" />
    </>
  ),
  film: (
    <>
      <rect x="2.8" y="4.4" width="14.4" height="11.2" rx="2" />
      <path d="M7 4.4v11.2M13 4.4v11.2M2.8 10h14.4" />
    </>
  ),
  frames: (
    <>
      <rect x="2.6" y="5.4" width="6.4" height="9.2" rx="1.4" />
      <rect x="11" y="5.4" width="6.4" height="9.2" rx="1.4" />
    </>
  ),
  key: (
    <>
      <circle cx="6.6" cy="9.4" r="3.1" />
      <path d="M9.1 11.2l5.1 5.1M12.3 14.4l1.5-1.5M14.2 16.3l1.6-1.6" />
    </>
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="10" r="1.3" />
      <circle cx="10" cy="10" r="1.3" />
      <circle cx="15" cy="10" r="1.3" />
    </g>
  ),
  onion: (
    <>
      <rect x="2.6" y="6.2" width="9.4" height="8.2" rx="1.6" />
      <path d="M6.4 5.4h8.6a1.6 1.6 0 0 1 1.6 1.6v7.2" strokeDasharray="2.4 2" />
    </>
  )
}
