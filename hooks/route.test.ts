import { describe, expect, test } from 'claude-code/testing'
import { nextSessionTier } from './route'

const base = { switchTurns: 1, escalate: true }

describe('nextSessionTier', () => {
  test('the first prompt picks the session model', async () => {
    expect(nextSessionTier({ ...base, current: undefined, promptTier: 'easy', turn: 1 }))
      .toEqual({ sessionTier: 'easy', change: 'picked' })
  })

  test('later prompts keep it: no switch, the cache stays', async () => {
    expect(nextSessionTier({ ...base, current: 'normal', promptTier: 'easy', turn: 2 }))
      .toEqual({ sessionTier: 'normal', change: 'kept' })
    expect(nextSessionTier({ ...base, current: 'hard', promptTier: 'normal', turn: 5 }))
      .toEqual({ sessionTier: 'hard', change: 'kept' })
  })

  test('a session started light moves up when the work gets harder', async () => {
    expect(nextSessionTier({ ...base, current: 'easy', promptTier: 'normal', turn: 2 }))
      .toEqual({ sessionTier: 'normal', change: 'escalated' })
    expect(nextSessionTier({ ...base, current: 'normal', promptTier: 'hard', turn: 3 }))
      .toEqual({ sessionTier: 'hard', change: 'escalated' })
  })

  test('with escalate off, the first pick stands for the whole session', async () => {
    expect(nextSessionTier({ ...base, escalate: false, current: 'easy', promptTier: 'hard', turn: 2 }))
      .toEqual({ sessionTier: 'easy', change: 'kept' })
  })

  test('switchTurns widens the window in which the pick follows each prompt', async () => {
    expect(nextSessionTier({ ...base, switchTurns: 2, current: 'normal', promptTier: 'easy', turn: 2 }))
      .toEqual({ sessionTier: 'easy', change: 'picked' })
  })
})
