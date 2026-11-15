import { describe, expect, test } from 'claude-code/testing'
import { SUBAGENT_GUIDE } from './register'

const GUIDED = { options: { mode: 'route', guideSubagents: true } }

// A prompt the person typed and sent with Enter.
const typed = (text: string, context?: string[]) =>
  ({ text, wait: false, origin: { kind: 'composer' as const }, ...(context ? { context } : {}) })

// The engine beneath the mod: it records what each prompt carried in.
function engine(on: any, seen: Array<readonly string[] | undefined>) {
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
}

describe('the subagent guide', () => {
  test('goes beside the first prompt of the session, once', GUIDED, async ($, on) => {
    const seen: Array<readonly string[] | undefined> = []
    engine(on, seen)
    await $.prompt.submit(typed('add a logout button to the header'))
    await $.prompt.submit(typed('now write tests for it'))
    expect(seen.at(0)).toEqual([SUBAGENT_GUIDE])
    expect(seen.at(1)).toBeUndefined()
  })

  test('keeps context another hook attached', GUIDED, async ($, on) => {
    const seen: Array<readonly string[] | undefined> = []
    engine(on, seen)
    await $.prompt.submit(typed('hello', ['from another plugin']))
    expect(seen.at(0)).toEqual(['from another plugin', SUBAGENT_GUIDE])
  })

  test('is off by default', { options: { mode: 'route' } }, async ($, on) => {
    const seen: Array<readonly string[] | undefined> = []
    engine(on, seen)
    await $.prompt.submit(typed('add a logout button to the header'))
    expect(seen.at(0)).toBeUndefined()
  })

  test('changes nothing in log mode', { options: { mode: 'log', guideSubagents: true } }, async ($, on) => {
    const seen: Array<readonly string[] | undefined> = []
    engine(on, seen)
    await $.prompt.submit(typed('add a logout button to the header'))
    expect(seen.at(0)).toBeUndefined()
  })

  test('tells the parent the three kinds of work', async () => {
    expect(SUBAGENT_GUIDE).toContain('model "haiku" and effort "low"')
    expect(SUBAGENT_GUIDE).toContain('effort "xhigh"')
    expect(SUBAGENT_GUIDE).toContain('Explore')
  })
})
