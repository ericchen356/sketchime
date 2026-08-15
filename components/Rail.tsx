'use client'

import { useEffect, useRef } from 'react'
import { Icon, type IconName } from './Icon'
import type { EraseMode, Tool } from '@/lib/types'

/**
 * Ten swatches, keyed 1-9 and 0. Saturated enough to read on the paper ground,
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

const TOOLS: { tool: Tool; icon: IconName; key: string; label: string; hint: string }[] = [
  { tool: 'pen', icon: 'pen', key: 'd', label: 'Draw', hint: 'Draw (d)' },
  {
    tool: 'eraser',
    icon: 'eraser',
    key: 'e',
    label: 'Erase',
    hint: 'Erase — press e again to switch between rubbing out whole lines and parts of them'
  },
  { tool: 'text', icon: 'text', key: 't', label: 'Add text', hint: 'Add text, click to place (t)' },
  { tool: 'pan', icon: 'hand', key: 'm', label: 'Move around', hint: 'Move around the page (m)' }
]

const ERASE_MODES: { mode: EraseMode; label: string; title: string }[] = [
  { mode: 'stroke', label: 'Whole line', title: 'Rub out an entire line at a time' },
  { mode: 'pixel', label: 'Part of a line', title: 'Rub out only what you touch, splitting the line' }
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
    <div className="rail" ref={rail} role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      <div className="rail-group">
        {TOOLS.map(({ tool: t, icon, key, label, hint }) => (
          <button
            key={t}
            className={`rail-btn ${tool === t ? 'rail-btn-on' : ''}`}
            onClick={() => onTool(t)}
            title={hint}
            aria-label={label}
            aria-pressed={tool === t}
          >
            <Icon name={icon} />
            <span className="rail-key" aria-hidden="true">
              {key}
            </span>
          </button>
        ))}
      </div>

      <span className="rail-sep" />

      <div className="rail-group">
        <button
          className={`rail-btn ${paletteOpen ? 'rail-btn-on' : ''}`}
          onClick={onTogglePalette}
          title="Colour and brush size (c)"
          aria-label="Colour and brush size"
          aria-expanded={paletteOpen}
        >
          <span className="ink-chip" style={{ background: color }} />
        </button>
        <span className="rail-readout" title="Brush size — w for bigger, s for smaller">
          {brushSize}
        </span>
      </div>

      <span className="rail-sep" />

      <div className="rail-group">
        <button
          className="rail-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘/ctrl+Z)"
          aria-label="Undo"
        >
          <Icon name="undo" />
        </button>
        <button
          className="rail-btn rail-btn-danger"
          onClick={onClear}
          disabled={isEmpty}
          title="Clear this frame — undo brings it back"
          aria-label="Clear this frame"
        >
          <Icon name="trash" />
        </button>
      </div>

      <span className="rail-sep" />

      <button
        className="rail-zoom"
        onClick={onFit}
        title="Fit the drawing to the screen (0)"
        aria-label={`Zoom ${Math.round(zoom * 100)} percent. Click to fit the drawing to the screen.`}
      >
        {Math.round(zoom * 100)}
        <span className="rail-zoom-pct" aria-hidden="true">
          %
        </span>
      </button>

      {/* Eraser mode picker — only meaningful while the eraser is up, so it
          only exists then. Sits beside the eraser button. */}
      {tool === 'eraser' && (
        <div className="flyout flyout-erase" role="group" aria-label="What the eraser removes">
          {ERASE_MODES.map(({ mode, label, title }) => (
            <button
              key={mode}
              className={`chip ${eraseMode === mode ? 'chip-on' : ''}`}
              onClick={() => onEraseMode(mode)}
              title={title}
              aria-pressed={eraseMode === mode}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {paletteOpen && (
        <div className="flyout flyout-palette" role="group" aria-label="Colour and brush size">
          <div className="swatch-grid">
            {PALETTE.map((p, i) => (
              <button
                key={p.value}
                className={`swatch ${color.toLowerCase() === p.value.toLowerCase() ? 'swatch-on' : ''}`}
                style={{ background: p.value }}
                onClick={() => onColor(p.value)}
                title={`${p.name} (${(i + 1) % 10})`}
                aria-label={p.name}
                aria-pressed={color.toLowerCase() === p.value.toLowerCase()}
              />
            ))}
            {/* The native picker is the input itself - the swatch just opens it. */}
            <button
              className={`swatch swatch-custom ${isCustom ? 'swatch-on' : ''}`}
              style={isCustom ? { background: color } : undefined}
              onClick={() => picker.current?.click()}
              title="Any other colour"
              aria-label="Pick any other colour"
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
              tabIndex={-1}
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
