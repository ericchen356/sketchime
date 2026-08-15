'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import {
  BOARD_STEPS,
  CUSTOM_OPTION_LABEL,
  crewInitials,
  crewName,
  offlineDirective,
  offlineTurn
} from '@/lib/board'
import { askBoard } from '@/lib/gemini-client'
import {
  MAX_TURNS_PER_AGENT,
  MIN_TURNS_PER_AGENT,
  type BoardThread,
  type BoardThreads,
  type BoardTurn,
  type OptionKey
} from '@/lib/types'

interface Props {
  clipIndex: number
  initial: BoardThreads
  /** Bare base64 PNGs of both keyframes — what the crew actually look at. */
  imageA: string
  imageB: string
  intent: string
  styleNote: string
  apiKey: string
  /** No key anywhere means the crew can't run; fall back to fixed questions. */
  offline: boolean
  onCancel(): void
  onComplete(board: BoardThreads): void
}

/**
 * The crew room. Four specialists are consulted in strict order. Each one looks
 * at both of your drawings, says what it can see, and keeps asking follow-ups
 * until it is satisfied — only then does it commit to an instruction and hand
 * over to the next one.
 *
 * Presented as a conversation rather than a form, because that is what it is:
 * the questions are written for your specific drawing and change between a
 * bouncing ball and a character turning.
 */
export function BoardSurvey({
  clipIndex,
  initial,
  imageA,
  imageB,
  intent,
  styleNote,
  apiKey,
  offline,
  onCancel,
  onComplete
}: Props): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [board, setBoard] = useState<BoardThreads>(initial)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [pending, setPending] = useState<OptionKey | null>(null)
  /** Seconds the current member has been thinking. Shown from 3s so a normal
   * 2-second turn stays quiet, but a long one is visibly still running rather
   * than ambiguously stuck. */
  const [elapsed, setElapsed] = useState(0)

  const step = BOARD_STEPS[index]
  const thread = board[step.id]
  const turns = thread?.turns ?? []
  const current = turns[turns.length - 1]
  const awaitingAnswer = !!current && !current.answer && !thread?.satisfied

  /** Guards against a late reply from a member the user has already left. */
  const requestId = useRef(0)
  const scroller = useRef<HTMLDivElement | null>(null)

  const satisfied = (t: BoardThread | undefined): boolean => !!t?.satisfied && !!t.directive

  /** Ask the current member for its next move, given the thread so far.
   * `force` makes this its last turn: it must commit an instruction. */
  const advanceAgent = useCallback(
    async (thread: BoardThread, force = false) => {
      const mine = ++requestId.current
      setThinking(true)
      setError(null)

      const answered = thread.turns.filter((t) => t.answer)
      const turnsRemaining = Math.max(1, MAX_TURNS_PER_AGENT - thread.turns.length)
      // The cap is enforced HERE and again on the server - the prompt alone
      // does not stop a chatty agent from asking forever.
      const mustCommit = force || thread.turns.length >= MAX_TURNS_PER_AGENT

      // Offline: no agent, no vision — fall back to the spec's fixed question,
      // and treat the first answer as final.
      if (offline) {
        if (requestId.current !== mine) return
        const last = answered[answered.length - 1]?.answer?.text
        const next: BoardThread =
          last || force
            ? {
                ...thread,
                satisfied: true,
                offline: true,
                // Forcing a commit before anything was answered is legal, and
                // there is no agent here to improvise - fall back to the step's
                // own first option rather than indexing an empty list.
                directive: offlineDirective(step, last || step.options[0].text)
              }
            : { turns: [{ ...offlineTurn(step) }], satisfied: false, offline: true }
        setBoard((b) => ({ ...b, [step.id]: next }))
        setThinking(false)
        return
      }

      try {
        const reply = await askBoard({
          role: step.role,
          topic: step.topic,
          objective: step.objective,
          briefQuestion: step.question,
          defaultDirective: step.defaultDirective,
          probes: step.probes,
          minTurns: MIN_TURNS_PER_AGENT,
          intent,
          styleNote,
          imageA,
          imageB,
          history: answered.map((t) => ({ question: t.question, answer: t.answer!.text })),
          turnsRemaining,
          mustCommit,
          apiKey
        })
        if (requestId.current !== mine) return

        if (reply.satisfied || mustCommit) {
          setBoard((b) => ({
            ...b,
            [step.id]: {
              ...thread,
              satisfied: true,
              // A forced turn that still came back with a question falls back to
              // the user's own last answer rather than an empty directive.
              // Never step.question here: a question in the directive slot ends
              // up in the prompt telling the video model nothing.
              directive:
                reply.directive?.trim() ||
                answered[answered.length - 1]?.answer?.text ||
                step.defaultDirective
            }
          }))
        } else {
          const turn: BoardTurn = {
            observation: reply.observation,
            question: reply.question ?? step.question,
            options: (reply.options ?? []).map((o, i) => ({
              key: (['A', 'B', 'C'] as const)[i],
              text: o.text
            }))
          }
          setBoard((b) => ({ ...b, [step.id]: { ...thread, turns: [...thread.turns, turn] } }))
        }
      } catch (e) {
        if (requestId.current !== mine) return
        setError(e instanceof Error ? e.message : 'That crew member did not respond.')
      } finally {
        if (requestId.current === mine) setThinking(false)
      }
    },
    [offline, step, intent, styleNote, imageA, imageB, apiKey]
  )

  /**
   * Which steps have already had their opening question requested. A ref, not
   * state, so it cannot itself trigger a render.
   *
   * This replaces an earlier `if (thread || thinking) return` guard, which read
   * `thinking` without depending on it: if a step became current while a
   * request was still in flight, the effect bailed and never re-ran when
   * `thinking` cleared, so that member was never asked at all. The UI sat on
   * "Waiting…" forever with nothing in flight - a hang that looked exactly like
   * slowness.
   */
  const opened = useRef<Set<string>>(new Set())

  // Opening move: a step the user has arrived at with no turns yet needs its
  // member to look at the frames and ask.
  useEffect(() => {
    if (thread || opened.current.has(step.id)) return
    opened.current.add(step.id)
    void advanceAgent({ turns: [], satisfied: false })
  }, [step.id, thread, advanceAgent])

  // Once a member commits, move on — or finish.
  useEffect(() => {
    if (!satisfied(thread)) return
    const t = setTimeout(() => {
      if (index < BOARD_STEPS.length - 1) {
        setIndex(index + 1)
        setCustom('')
        setPending(null)
      }
    }, 650)
    return () => clearTimeout(t)
  }, [thread, index])

  useEffect(() => {
    if (!thinking) {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(id)
  }, [thinking])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, thinking, thread?.satisfied])

  const answerable = useMemo(() => {
    if (!awaitingAnswer || thinking) return false
    if (pending === 'D') return custom.trim().length > 0
    return pending !== null
  }, [awaitingAnswer, thinking, pending, custom])

  const submit = (): void => {
    if (!answerable || !current || !thread) return
    const option = current.options.find((o) => o.key === pending)
    const answer =
      pending === 'D'
        ? { key: 'D' as const, text: custom.trim() }
        : { key: pending as OptionKey, text: option?.text ?? '' }

    const updated: BoardThread = {
      ...thread,
      turns: thread.turns.map((t, i) => (i === thread.turns.length - 1 ? { ...t, answer } : t))
    }
    setBoard((b) => ({ ...b, [step.id]: updated }))
    setPending(null)
    setCustom('')
    void advanceAgent(updated)
  }

  /** Cut the questioning short: the member decides from what it already has. */
  const commitNow = (): void => {
    if (!thread || thinking) return
    void advanceAgent(thread, true)
  }

  const allDone = BOARD_STEPS.every((s) => satisfied(board[s.id]))

  // Enter sends the selected answer. Escape is the dialog's own business and is
  // handled by Modal, which also traps focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement | null)?.tagName === 'TEXTAREA'
      if (e.key === 'Enter' && (!typing || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal
      wide
      onClose={onCancel}
      eyebrow={`Clip ${clipIndex + 1} · ${index + 1} of ${BOARD_STEPS.length}`}
      title={crewName(step.role)}
      subtitle={step.topic}
      aside={
        offline ? (
          <span className="badge badge-warn" title="Without an API key nobody can look at your drawings, so these are the standard questions.">
            Offline
          </span>
        ) : undefined
      }
      footerSplit
      footer={
        <>
          <button className="btn" onClick={() => (index > 0 ? setIndex(index - 1) : onCancel())}>
            {index > 0 ? 'Back' : 'Cancel'}
          </button>

          {allDone ? (
            <button className="btn btn-primary" onClick={() => onComplete(board)}>
              <Icon name="check" size={16} />
              Done
            </button>
          ) : (
            <div className="foot-actions">
              {awaitingAnswer && (
                <button
                  className="btn"
                  onClick={commitNow}
                  disabled={thinking}
                  title="Stop the questions and let this member decide with what it already knows"
                >
                  That’s enough, decide
                </button>
              )}
              <button className="btn btn-primary" onClick={submit} disabled={!answerable}>
                Send
              </button>
            </div>
          )}
        </>
      }
    >
      <ol className="crew-track">
        {BOARD_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={`crew-node${i === index ? ' crew-node-now' : ''}${
              satisfied(board[s.id]) ? ' crew-node-done' : ''
            }`}
          >
            <button
              disabled={i > index}
              onClick={() => i < index && setIndex(i)}
              aria-label={
                i > index
                  ? `${crewName(s.role)} — not consulted yet`
                  : `Back to ${crewName(s.role)}`
              }
              aria-current={i === index ? 'step' : undefined}
            >
              {satisfied(board[s.id]) ? <Icon name="check" size={14} /> : crewInitials(s.role)}
            </button>
          </li>
        ))}
      </ol>

      <div className="thread" ref={scroller}>
        {turns.map((turn, i) => (
          <div key={i} className="exchange">
            {turn.observation && (
              <p className="observation">
                <span className="avatar" aria-hidden="true">
                  {crewInitials(step.role)}
                </span>
                <span>{turn.observation}</span>
              </p>
            )}
            <p className="question">{turn.question}</p>

            {turn.answer ? (
              <p className="answer-bubble">{turn.answer.text}</p>
            ) : (
              <div className="options">
                {turn.options.map((o) => (
                  <button
                    key={o.key}
                    className={`option ${pending === o.key ? 'option-on' : ''}`}
                    onClick={() => setPending(o.key)}
                    disabled={thinking}
                    aria-pressed={pending === o.key}
                  >
                    <span className="option-key" aria-hidden="true">
                      {o.key}
                    </span>
                    <span>{o.text}</span>
                  </button>
                ))}

                <div className={`option option-write ${pending === 'D' ? 'option-on' : ''}`}>
                  <button className="option-hit" onClick={() => setPending('D')} disabled={thinking}>
                    <span className="option-key" aria-hidden="true">
                      D
                    </span>
                    <span>{CUSTOM_OPTION_LABEL}</span>
                  </button>
                  <textarea
                    className="option-input"
                    placeholder="Tell them in your own words…"
                    aria-label="Your own answer"
                    value={custom}
                    rows={2}
                    disabled={thinking}
                    onFocus={() => setPending('D')}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        {awaitingAnswer && turns.length > 1 && (
          <p className="turn-note">
            Question {turns.length} of at most {MAX_TURNS_PER_AGENT} — {crewName(step.role)} will
            decide after this one.
          </p>
        )}

        {thinking && (
          <p className="thinking" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {turns.length === 0
              ? `${crewName(step.role)} is looking at your drawings…`
              : `${crewName(step.role)} is thinking about your answer…`}
            {elapsed >= 3 && <span className="elapsed">{elapsed}s</span>}
          </p>
        )}

        {satisfied(thread) && (
          <div className="directive">
            <span className="avatar avatar-ok" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
            <span>
              <b className="directive-label">Settled on</b>
              {thread?.directive}
            </span>
          </div>
        )}

        {error && (
          <p className="notice notice-error">
            <Icon name="alert" size={16} />
            {error}
            <button
              className="btn btn-small"
              onClick={() => void advanceAgent(thread ?? { turns: [], satisfied: false })}
            >
              Try again
            </button>
          </p>
        )}
      </div>
    </Modal>
  )
}
