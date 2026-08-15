'use client'

import { useEffect, useRef } from 'react'
import type { EraseMode, Tool } from '@/lib/types'

/**
 * Ten swatches, keyed 1-9 and 0. Saturated enough to read on the slate ground,
 * ink first because it is the default.
 */
export const PALETTE = [
  { name: 'ink', value: '#1c1b1a' },
  { name: 'slate', value: '#647084' },
  { name: 'red', value: '#d94f45' },
  { name: 'orange', value: '#e0873a' },
  { name: 'amber', value: '#dcb03c' },
  { name: 'green', value: '#4f9d63' },
  { name: 'teal', value: '#3d9c95' },
  { name: 'blue', value: '#4478cc' },
  { name: 'violet', value: '#8a63d2' },
  { name: 'magenta', value: '#c85b96' }
] as const

const TOOLS: { tool: Tool; key: string; title: string }[] = [
  { tool: 'pen', key: 'd', title: 'Draw (d)' },
  { tool: 'eraser', key: 'e', title: 'Erase — press e again to switch mode' },
  { tool: 'text', key: 't', title: 'Text, click to place (t)' },
  { tool: 'pan', key: 'm', title: 'Pan the canvas (m)' }
]

const ERASE_MODES: { mode: EraseMode; label: string; title: string }[] = [
  { mode: 'stroke', label: 'stroke', title: 'Remove a whole stroke at a time' },
  { mode: 'pixel', label: 'pixel', title: 'Rub out part of a stroke, splitting it' }
]

interface Props {
  tool: Tool
  eraseMode: EraseMode
  color: string
  brushSize: number
  zoom: number
  paletteOpen: boolean
  canUndo: boolean
  isEmpty: boolean
  onTool(tool: Tool): void
  onEraseMode(mode: EraseMode): void
  onColor(color: string): void
  onBrushSize(size: number): void
  onTogglePalette(): void
  onClosePalette(): void
  onUndo(): void
  onClear(): void
  onFit(): void
  brushMin: number
  brushMax: number
}

export function Rail({
  tool,
  eraseMode,
  color,
  brushSize,
  zoom,
  paletteOpen,
  canUndo,
  isEmpty,
  onTool,
  onEraseMode,
  onColor,
  onBrushSize,
  onTogglePalette,
  onClosePalette,
  onUndo,
  onClear,
  onFit,
  brushMin,
  brushMax
}: Props): React.JSX.Element {
  const picker = useRef<HTMLInputElement | null>(null)
  const rail = useRef<HTMLDivElement | null>(null)
  const isCustom = !PALETTE.some((p) => p.value.toLowerCase() === color.toLowerCase())

  // Click anywhere outside closes the palette. Bound only while it is open, so
  // the canvas isn't paying for a document listener the rest of the time.
  useEffect(() => {
    if (!paletteOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!rail.current?.contains(e.target as Node)) onClosePalette()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [paletteOpen, onClosePalette])

  return (
    <div className="rail" ref={rail}>
      <div className="rail-group">
        {TOOLS.map(({ tool: t, key, title }) => (
          <button
            key={t}
            className={`rail-btn ${tool === t ? 'rail-btn-on' : ''}`}
            onClick={() => onTool(t)}
            title={title}
          >
            {t === 'pen' ? (
              <PenIcon />
            ) : t === 'eraser' ? (
              <EraserIcon />
            ) : t === 'text' ? (
              <TextIcon />
            ) : (
              <HandIcon />
            )}
            <span className="rail-key">{key}</span>
          </button>
        ))}
      </div>

      <span className="rail-sep" />

      <div className="rail-group">
        <button
          className={`rail-btn ${paletteOpen ? 'rail-btn-on' : ''}`}
          onClick={onTogglePalette}
          title="Colour & brush (c)"
        >
          <span className="ink-chip" style={{ background: color }} />
        </button>
        <span className="rail-readout" title="Brush size — w bigger, s smaller">
          {brushSize}
        </span>
      </div>

      <span className="rail-sep" />

      <div className="rail-group">
        <button className="rail-btn" onClick={onUndo} disabled={!canUndo} title="Undo (⌘/ctrl+Z)">
          <UndoIcon />
        </button>
        <button
          className="rail-btn rail-btn-danger"
          onClick={onClear}
          disabled={isEmpty}
          title="Clear the canvas"
        >
          <TrashIcon />
        </button>
      </div>

      <span className="rail-sep" />

      <button className="rail-zoom" onClick={onFit} title="Fit the drawing to the screen (0)">
        {Math.round(zoom * 100)}
        <span className="rail-zoom-pct">%</span>
      </button>

      {/* Eraser mode picker — only meaningful while the eraser is up, so it
          only exists then. Sits beside the eraser button. */}
      {tool === 'eraser' && (
        <div className="flyout flyout-erase">
          {ERASE_MODES.map(({ mode, label, title }) => (
            <button
              key={mode}
              className={`chip ${eraseMode === mode ? 'chip-on' : ''}`}
              onClick={() => onEraseMode(mode)}
              title={title}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {paletteOpen && (
        <div className="flyout flyout-palette">
          <div className="swatch-grid">
            {PALETTE.map((p, i) => (
              <button
                key={p.value}
                className={`swatch ${color.toLowerCase() === p.value.toLowerCase() ? 'swatch-on' : ''}`}
                style={{ background: p.value }}
                onClick={() => onColor(p.value)}
                title={`${p.name} (${(i + 1) % 10})`}
              />
            ))}
            {/* The native picker is the input itself - the swatch just opens it. */}
            <button
              className={`swatch swatch-custom ${isCustom ? 'swatch-on' : ''}`}
              style={isCustom ? { background: color } : undefined}
              onClick={() => picker.current?.click()}
              title="Custom colour"
            >
              {!isCustom && <span className="swatch-wheel" />}
            </button>
            <input
              ref={picker}
              type="color"
              className="color-input"
              value={color}
              onChange={(e) => onColor(e.target.value)}
              aria-label="Custom colour"
            />
          </div>

          <div className="brush-row">
            {/* The dot is the brush at true size, so the slider has a preview. */}
            <span className="brush-preview">
              <span
                className="brush-dot"
                style={{ width: brushSize, height: brushSize, background: color }}
              />
            </span>
            <input
              type="range"
              className="brush-range"
              min={brushMin}
              max={brushMax}
              value={brushSize}
              onChange={(e) => onBrushSize(Number(e.target.value))}
              aria-label="Brush size"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PenIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M13.4 3.6l3 3L7.9 15.1l-3.9.9.9-3.9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11.9 5.1l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function EraserIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect
        x="3.4"
        y="7.6"
        width="12"
        height="7"
        rx="1.6"
        transform="rotate(-40 9.4 11.1)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M6 16.5h10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function TextIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M4.5 5.5V4h11v1.5M10 4v12M7.5 16h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HandIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M10 3.2v7M7.4 5v5.2M12.6 5.2v5M15 7.6v4.2a5 5 0 0 1-5 5 5 5 0 0 1-5-5V9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UndoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M6.5 7.5H12a4 4 0 0 1 0 8H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9 4.5l-3.2 3L9 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M4.5 6h11M8 6V4.4h4V6M6 6l.7 9.2a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
