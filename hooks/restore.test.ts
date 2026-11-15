import { describe, expect, test, type TestBody } from 'claude-code/testing'
import { onlyModelDiffers } from './register'

// The engine beneath the mod, mocked: one Model row in /config, the mod's
// store in memory, and the session events the mod hooks.
const ROUTE = { options: { mode: 'route', lever: 'both', switchStyle: 'visible' } }
const PENDING = 'pending-restore'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]
type Store = Record<string, unknown>

function engine(on: On, row: { value: string }, store: Store, opts: { denySet?: boolean; fileSets?: boolean; statuses?: string[] } = {}) {
  const writes: string[] = []
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('ui.status', (_, e) => {
    opts.statuses?.push(String(e.text))
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('config.list', () => ({
    value: [{ key: 'model', label: 'Model', kind: 'choice', value: row.value, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }],
  }))
  if (!opts.fileSets) on('config.set', (_, e) => {
    if (opts.denySet) return { deny: 'no session is bound' }
    writes.push(String(e.value))
    row.value = String(e.value)
    return { value: e.value }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  return writes
}

async function start($: Engine, interactive = true) {
  await $.session.start({ cwd: '/', surface: interactive ? 'terminal' : null, isInteractive: interactive })
}

describe('the Model row', () => {
  test('an easy first prompt switches the row and records the restore owed', ROUTE, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const writes = engine(on, row, store)
    await start($)
    await $.turn.start({ text: 'What does git stash do?', turnId: 't1' })

    expect(writes).toEqual(['haiku'])
    expect(store[PENDING]).toEqual(expect.objectContaining({ home: 'opus[1m]', set: 'haiku' }))
  })

  test('a greeting first leaves the pick to the first real prompt', ROUTE, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const writes = engine(on, row, store)
    await start($)
    await $.turn.start({ text: 'hello', turnId: 't1' })
    expect(writes).toEqual([])
    await $.turn.start({ text: 'git là gì', turnId: 't2' })
    expect(writes).toEqual(['haiku'])
  })

  test('an ok after a hard prompt keeps the session effort', ROUTE, async ($, on) => {
    const statuses: string[] = []
    engine(on, { value: 'opus[1m]' }, {}, { statuses })
    await start($)
    await $.turn.start({ text: 'refactor the auth module to use dependency injection', turnId: 't1' })
    await $.turn.start({ text: 'ok', turnId: 't2' })
    expect(statuses.at(0)).toContain('effort xhigh')
    expect(statuses.at(-1)).toContain('effort session')
  })

  test('the session end gives the person their model back', ROUTE, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const writes = engine(on, row, store)
    await start($)
    await $.turn.start({ text: 'What does git stash do?', turnId: 't1' })
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })

    expect(writes).toEqual(['haiku', 'opus[1m]'])
    expect(row.value).toBe('opus[1m]')
    expect(store[PENDING]).toBeUndefined()
  })

  test('a session that died switched is repaired by the next one', ROUTE, async ($, on) => {
    // What the dead session left: the row on haiku, the restore it owed.
    const row = { value: 'haiku' }
    const store: Store = { [PENDING]: { home: 'opus[1m]', set: 'haiku', at: '2026-11-14T00:00:00Z' } }
    const writes = engine(on, row, store)
    await start($)
    await $.turn.start({ text: 'add a /health endpoint to the express server', turnId: 't1' })

    expect(writes[0]).toBe('opus[1m]')
    expect(row.value).toBe('opus[1m]')
    expect(store[PENDING]).toBeUndefined()
  })

  test('a model the person chose since is left alone', ROUTE, async ($, on) => {
    const row = { value: 'sonnet' }
    const store: Store = { [PENDING]: { home: 'opus[1m]', set: 'haiku', at: '2026-11-14T00:00:00Z' } }
    const writes = engine(on, row, store)
    await start($)
    await $.turn.start({ text: 'add a /health endpoint to the express server', turnId: 't1' })

    expect(writes).toEqual([])
    expect(row.value).toBe('sonnet')
    expect(store[PENDING]).toBeUndefined()
  })

  test('a restore the engine refuses keeps the record for the next session', ROUTE, async ($, on) => {
    const row = { value: 'haiku' }
    const store: Store = { [PENDING]: { home: 'opus[1m]', set: 'haiku', at: '2026-11-14T00:00:00Z' } }
    engine(on, row, store, { denySet: true })
    await start($)
    await $.turn.start({ text: 'add a /health endpoint', turnId: 't1' })

    expect(store[PENDING]).toEqual(expect.objectContaining({ home: 'opus[1m]' }))
  })

  test('a headless session never writes the row', ROUTE, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const writes = engine(on, row, store)
    await start($, false)
    await $.turn.start({ text: 'What does git stash do?', turnId: 't1' })

    expect(writes).toEqual([])
    expect(store[PENDING]).toBeUndefined()
  })

  test('log mode never writes the row', { options: { mode: 'log' } }, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const writes = engine(on, row, store)
    await start($)
    await $.turn.start({ text: 'What does git stash do?', turnId: 't1' })

    expect(writes).toEqual([])
  })
})

// The saved settings file, in memory: the Model row writes into it, as the
// engine does (and reorders a key, as the engine was seen to).
const FILE = '/home/me/.claude/settings.json'
const ORIGINAL = '{\n  "model": "opus[1m]",\n  "theme": "dark",\n  "env": { "A": "1" }\n}\n'

function withFile(on: On, row: { value: string }, files: Record<string, string>, opts: { alsoChange?: boolean } = {}) {
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('config.set', (_, e) => {
    row.value = String(e.value)
    const o = JSON.parse(files[FILE] ?? '{}')
    o.model = e.value
    if (opts.alsoChange) o.theme = 'light' // another change lands meanwhile
    const { theme, ...rest } = o
    files[FILE] = JSON.stringify({ ...rest, theme }, null, 2) // key order moved
    return { value: e.value }
  })
}

describe('the saved settings file', () => {
  test('a switch leaves the saved file exactly as it was', ROUTE, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const files: Record<string, string> = { [FILE]: ORIGINAL }
    withFile(on, row, files)
    engine(on, row, store, { fileSets: true })
    await start($)
    await $.turn.start({ text: 'What does git stash do?', turnId: 't1' })

    expect(row.value).toBe('haiku') // the session runs haiku
    expect(files[FILE]).toBe(ORIGINAL) // the saved setting never changed
    expect(store[PENDING]).toBeUndefined() // nothing owed
  })

  test('when another change landed in the file, the restore is owed instead', ROUTE, async ($, on) => {
    const row = { value: 'opus[1m]' }
    const store: Store = {}
    const files: Record<string, string> = { [FILE]: ORIGINAL }
    withFile(on, row, files, { alsoChange: true })
    engine(on, row, store, { fileSets: true })
    await start($)
    await $.turn.start({ text: 'What does git stash do?', turnId: 't1' })

    expect(JSON.parse(files[FILE] ?? '{}').theme).toBe('light') // the other change is kept
    expect(store[PENDING]).toEqual(expect.objectContaining({ home: 'opus[1m]', set: 'haiku' }))
  })

  test('onlyModelDiffers ignores key order and the model alone', async () => {
    expect(onlyModelDiffers('{"model":"a","x":1,"y":2}', '{"y":2,"x":1,"model":"b"}')).toBe(true)
    expect(onlyModelDiffers('{"model":"a","x":1}', '{"model":"b","x":2}')).toBe(false)
    expect(onlyModelDiffers('not json', '{}')).toBe(false)
  })
})
