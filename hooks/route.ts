// Pure session-model policy: no `$`, no I/O, so it is unit-testable.
//
// The session's model is picked from its first typed prompt(s), while no
// conversation is cached yet. After that it sticks, since every model has its
// own prompt cache and a switch re-reads the whole conversation uncached
// (code.claude.com/docs/en/prompt-caching); per-prompt changes go through
// effort instead. One exception: with `escalate`, a session that started on a
// lighter model moves up when the work gets harder. It never moves down.

import type { Tier } from './classify'

const RANK: Record<Tier, number> = { easy: 0, normal: 1, hard: 2 }

export type SessionStep = {
  /** The tier whose model the session runs on after this prompt. */
  sessionTier: Tier
  /** What happened: picked while early, moved up, or kept. */
  change: 'picked' | 'escalated' | 'kept'
}

export function nextSessionTier(args: {
  current: Tier | undefined
  promptTier: Tier
  turn: number
  switchTurns: number
  escalate: boolean
}): SessionStep {
  const { current, promptTier, turn, switchTurns, escalate } = args
  if (current === undefined || turn <= switchTurns) {
    return { sessionTier: promptTier, change: 'picked' }
  }
  if (escalate && RANK[promptTier] > RANK[current]) {
    return { sessionTier: promptTier, change: 'escalated' }
  }
  return { sessionTier: current, change: 'kept' }
}
