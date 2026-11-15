import type { EngineInterface, Register } from 'claude-code'
import { classify, type Tier, type Verdict } from './classify'
import { nextSessionTier, type SessionStep } from './route'

// Two levers:
// - model, per session: picked from the first prompt, then kept (route.ts),
//   since each model has its own prompt cache.
// - effort, per prompt: easy prompts low, hard prompts high, normal untouched.
//
// switchStyle `visible` switches the /config Model row, so /model and the
// footer show the model that runs. That row is also the person's saved
// setting (~/.claude/settings.json), so right after the switch the mod puts
// the file's text back as it was: the running session keeps the new model,
// the saved setting never changes, and no way of quitting can leave it
// switched (tested live, Ctrl+C included). Should the file not be put back
// (another change landed in it meanwhile), a restore is owed instead: it is
// recorded in $.store, paid at /exit or /clear, else by the next session.
// switchStyle `silent` never writes the setting; the pick rides on each
// request instead.
//
// The row's change takes effect from the next turn, so the turn that switches
// also sends the model on its requests.
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Decision = Verdict & {
  model?: string // the session model this turn runs on, as the /config row names it
  switched: boolean // the session model changed at this turn
  carry: boolean // this turn's requests must name the model: the engine runs another
  effort?: Effort
  session?: SessionStep
}

// The /config Model row as this session sees it.
type Row = {
  home?: string // the person's own model, e.g. "opus[1m]"
  engineOn?: string // what the row says now: requests from the next turn resolve to it
  turnEngine?: string // what this turn's requests resolve to
  owesRestore: boolean // this session switched the row away from home
}

const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const register: Register = (on, options) => {
  const mode = String(options.mode ?? 'log') // log | route
  const lever = String(options.lever ?? 'both') // effort | model | both
  const wantsVisible = String(options.switchStyle ?? 'visible') === 'visible'
  // Only an interactive session shows the row; a headless one stays silent.
  let isInteractive = true
  const visible = () => wantsVisible && isInteractive
  const easyModel = String(options.easyModel ?? 'haiku')
  const normalModel = String(options.normalModel ?? '') // '' = the person's own
  const hardModel = String(options.hardModel ?? '') // '' = the person's own
  const escalate = options.escalate !== false
  const easyEffort = asEffort(options.easyEffort, 'low')
  const hardEffort = asEffort(options.hardEffort, 'xhigh')
  const switchTurns = Number(options.switchTurns ?? 1)
  const usesModel = lever === 'model' || lever === 'both'
  const usesEffort = lever === 'effort' || lever === 'both'
  const routes = mode === 'route'

  const decisionByTurn = new Map<string, Decision>()
  let lastDecision: Decision | undefined
  let mainTurns = 0 // typed main-loop turns so far, this one included
  let sessionTier: Tier | undefined // the tier whose model this session runs on
  let current: string | undefined // the model the router has this session on
  let isKnown = false // the row and home have been read this session
  const row: Row = { owesRestore: false }

  const sink: Sink = {
    file: `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
    lines: [],
    writing: Promise.resolve(),
  }

  const modelFor = (tier: Tier) =>
    (tier === 'easy' ? easyModel : tier === 'hard' ? hardModel : normalModel) || row.home
  const effortFor = (tier: Tier) =>
    tier === 'easy' ? easyEffort : tier === 'hard' ? hardEffort : undefined

  const decide = (verdict: Verdict): Decision => {
    let model: string | undefined
    let session: SessionStep | undefined
    if (usesModel && verdict.idle && sessionTier === undefined) {
      // Small talk before any task: leave the session where it is and let
      // the first real prompt pick its model.
      model = current
    } else if (usesModel) {
      session = nextSessionTier({ current: sessionTier, promptTier: verdict.tier, turn: mainTurns, switchTurns, escalate })
      sessionTier = session.sessionTier
      model = modelFor(session.sessionTier)
    }
    const switched = model !== undefined && model !== current
    // Small talk ("ok", "thanks") keeps the session effort: an "ok" often
    // approves a plan and starts the heaviest turn of a session.
    const effort = usesEffort && !verdict.idle ? effortFor(verdict.tier) : undefined
    return { ...verdict, model, switched, carry: false, effort, session }
  }

  const resetForNewTask = () => {
    mainTurns = 0
    sessionTier = undefined
    lastDecision = undefined
    current = row.engineOn
  }

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await writeLog($, sink, { mode, event: 'session.start', surface: e.surface, isInteractive, switchStyle: visible() ? 'visible' : 'silent' })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    // Once per session: learn the person's own model, repairing a setting an
    // earlier session of this mod left switched (in any mode).
    if (!isKnown) {
      const found = await recoverHome($)
      row.home = found.home
      row.turnEngine = found.startedOn
      row.engineOn = (await readModelRow($)) ?? found.startedOn // a repair takes effect next turn
      current = found.startedOn
      isKnown = true
    }

    const isTyped = e.text.trim() !== ''
    let decision: Decision
    if (isTyped || lastDecision === undefined) {
      if (isTyped) mainTurns += 1
      decision = decide(isTyped ? classify(e.text) : { tier: 'normal', reason: 'default' })
    } else {
      // A continuation keeps its turn's decision; it switches nothing.
      decision = { ...lastDecision, switched: false }
    }

    let rowResult: string | null = null
    const resolves = row.turnEngine // what this turn's requests name if left alone
    if (routes && decision.model !== undefined && row.home !== undefined) {
      // Visible: the row follows the pick (it takes effect next turn).
      if (visible() && decision.model !== row.engineOn) {
        const done = await switchSessionModel($, row.home, decision.model)
        rowResult = done.deny ?? done.kept ?? null
        if (done.deny === undefined) {
          row.engineOn = decision.model
          row.owesRestore = done.kept === 'restore-owed' && decision.model !== row.home
        }
      }
      current = decision.model
    }
    decision = { ...decision, carry: routes && decision.model !== undefined && decision.model !== resolves }
    row.turnEngine = row.engineOn
    lastDecision = decision
    decisionByTurn.set(e.turnId, decision)

    const how = decision.session?.change === 'kept' ? ' (kept from session start)' : decision.idle && !decision.session ? ' (waiting for a real prompt)' : ''
    const shown = `${decision.tier} prompt · model ${decision.model ?? 'session model'}${how} · effort ${decision.effort ?? 'session'}`
    $.ui.status(`router: ${shown}${routes ? '' : ' (log only)'}`)
    if (routes && decision.switched) $.ui.toast(`model-router: this session now runs ${decision.model} (${decision.tier} prompt)`)

    await writeLog($, sink, {
      mode,
      lever,
      event: 'turn.start',
      turnId: e.turnId,
      turn: mainTurns,
      tier: decision.tier,
      reason: decision.reason,
      sessionTier: decision.session?.sessionTier ?? null,
      modelChange: decision.session?.change ?? null,
      home: row.home ?? null,
      model: decision.model ?? null,
      switched: decision.switched,
      carry: decision.carry,
      rowResult,
      chars: e.text.length,
      preview: e.text.slice(0, 80),
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // Subagents are logged, never routed here.
    if (e.agentId !== undefined) {
      const r = yield* next(e)
      await writeLog($, sink, {
        mode,
        event: 'step',
        agentId: e.agentId,
        turnId: e.turnId,
        index: e.index,
        effort: e.effort ?? null,
        ...usageOf(e.model, r?.usage ?? null),
      })
      return r
    }

    const decision = decisionByTurn.get(e.turnId) ?? lastDecision
    const sent = { ...e }
    if (routes && decision !== undefined) {
      if (decision.carry && decision.model !== undefined) sent.model = decision.model
      if (decision.effort !== undefined) sent.effort = decision.effort
    }
    const r = yield* next(sent)

    await writeLog($, sink, {
      mode,
      event: 'step',
      turnId: e.turnId,
      turn: mainTurns,
      index: e.index,
      tier: decision?.tier ?? null,
      sessionEffort: e.effort ?? null,
      sentEffort: sent.effort ?? null,
      messageCount: e.messageCount,
      ...usageOf(sent.model, r?.usage ?? null),
    })
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const usage = await $.session.usage().catch(() => undefined)
      await writeLog($, sink, {
        mode,
        event: 'turn.complete',
        turn: mainTurns,
        reason: e.reason,
        sessionModel: await $.session.model().catch(() => null),
        sessionCostUsd: usage?.cost?.usd ?? null,
      })
      decisionByTurn.clear()
    }
    return r
  })

  // Give the person their own model back while the interface still runs:
  // settings can no longer be written once the session has ended (tested:
  // session.end after /exit is refused). /exit and /clear are caught as
  // commands; a terminal closing its client, at session.detach.
  on('command.run', { command: 'exit' }, async ($, e, next) => {
    await writeLog($, sink, { mode, event: 'restore', when: 'exit', ...(await restoreHome($, row)) })
    return next(e)
  }).catch(($, e, next) => next(e)) // a failed restore never blocks /exit

  on('command.run', { command: 'clear' }, async ($, e, next) => {
    await writeLog($, sink, { mode, event: 'restore', when: 'clear', ...(await restoreHome($, row)) })
    const r = await next(e)
    resetForNewTask()
    return r
  }).catch(($, e, next) => next(e)) // a failed restore never blocks /clear

  on('session.detach', async ($, e, next) => {
    await writeLog($, sink, { mode, event: 'restore', when: `detach:${e.reason}`, ...(await restoreHome($, row)) })
    return next(e)
  })

  // The last chance; refused after /exit, kept for any end that allows it.
  on('session.end', async ($, e, next) => {
    await writeLog($, sink, { mode, event: 'restore', when: `end:${e.reason}`, ...(await restoreHome($, row)) })
    if (e.reason === 'clear') resetForNewTask()
    return next(e)
  })
}

function asEffort(value: unknown, fallback: Effort): Effort {
  return typeof value === 'string' && EFFORTS.includes(value) ? (value as Effort) : fallback
}

// ---- the /config Model row --------------------------------------------------

// What this mod set, and what it replaced, kept across sessions until restored.
type Pending = { home: string; set: string; at: string }
const PENDING_KEY = 'pending-restore'

async function readModelRow($: EngineInterface): Promise<string | undefined> {
  const rows = await $.config.list().catch(() => undefined)
  const row = rows?.find(r => r.key === 'model')
  return typeof row?.value === 'string' ? row.value : undefined
}

async function setModelRow($: EngineInterface, value: string): Promise<string | undefined> {
  const result = await $.config.set({ key: 'model', value }).catch((err: unknown) => ({ deny: String(err) }))
  return 'deny' in result && result.deny !== undefined ? result.deny : undefined
}

// The person's own model (`home`) and the one this session started on. When
// an earlier session switched the row and never restored it (and nobody
// changed it since), the row is put back first; the record is dropped only
// once that write took.
async function recoverHome($: EngineInterface): Promise<{ home?: string; startedOn?: string }> {
  const now = await readModelRow($)
  const pending = (await $.store.get(PENDING_KEY).catch(() => undefined)) as Pending | undefined
  if (pending === undefined) return { home: now, startedOn: now }
  if (now !== pending.set) {
    // The person chose another model since: theirs stands.
    await $.store.delete(PENDING_KEY).catch(() => undefined)
    return { home: now, startedOn: now }
  }
  const deny = await setModelRow($, pending.home)
  if (deny === undefined) await $.store.delete(PENDING_KEY).catch(() => undefined)
  return { home: pending.home, startedOn: now }
}

// Switches this session's model through the Model row, then puts the saved
// settings file back as it was before the switch, when nothing but the model
// changed in it: the session keeps the new model, the person's setting stays.
// Otherwise the restore is owed, recorded first so it survives a crash.
async function switchSessionModel(
  $: EngineInterface,
  home: string,
  value: string,
): Promise<{ deny?: string; kept?: 'file-unchanged' | 'restore-owed' }> {
  const file = await settingsFile($)
  const before = file === undefined ? undefined : await $.fs.read(file).catch(() => undefined)
  if (value !== home) await $.store.set(PENDING_KEY, { home, set: value, at: new Date().toISOString() } satisfies Pending)
  const deny = await setModelRow($, value)
  if (deny !== undefined) return { deny }
  if (file !== undefined && typeof before === 'string') {
    const after = await $.fs.read(file).catch(() => undefined)
    if (typeof after === 'string' && onlyModelDiffers(before, after)) {
      const wrote = await $.fs.write(file, before).then(() => true, () => false)
      if (wrote) {
        await $.store.delete(PENDING_KEY).catch(() => undefined)
        return { kept: 'file-unchanged' }
      }
    }
  }
  if (value === home) await $.store.delete(PENDING_KEY).catch(() => undefined)
  return { kept: 'restore-owed' }
}

// Writes the row back to home, dropping the record once that took.
async function writeModelRow($: EngineInterface, home: string, value: string): Promise<string | undefined> {
  const deny = await setModelRow($, value)
  if (deny === undefined && value === home) await $.store.delete(PENDING_KEY).catch(() => undefined)
  return deny
}

// The user settings file the Model row is saved in.
async function settingsFile($: EngineInterface): Promise<string | undefined> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  if (configDir) return `${configDir.replace(/\/$/, '')}/settings.json`
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? `${home}/.claude/settings.json` : undefined
}

// Whether two settings texts hold the same settings but for `model`, key
// order aside (the engine may reorder keys as it writes).
export function onlyModelDiffers(before: string, after: string): boolean {
  try {
    const a = JSON.parse(before) as Record<string, unknown>
    const b = JSON.parse(after) as Record<string, unknown>
    delete a.model
    delete b.model
    return stable(a) === stable(b)
  } catch {
    return false
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Puts the row back to home when this session switched it. Answers what it
// did, for the log; a refused write keeps the record for the next session.
async function restoreHome($: EngineInterface, row: Row): Promise<{ restored?: string; deny?: string; skipped?: string }> {
  if (!row.owesRestore || row.home === undefined) return { skipped: 'nothing owed' }
  const deny = await writeModelRow($, row.home, row.home)
  if (deny !== undefined) return { deny }
  row.owesRestore = false
  row.engineOn = row.home
  row.turnEngine = row.home
  return { restored: row.home }
}

// ---- log ----------------------------------------------------------------------

// One JSON object per line, under the mod's own folder. $.fs has no append,
// so the session's lines are kept and the file rewritten each time.
type Sink = { file: string; lines: string[]; writing: Promise<void> }

function writeLog($: EngineInterface, sink: Sink, row: object): Promise<void> {
  sink.lines.push(JSON.stringify({ ts: new Date().toISOString(), ...row }))
  const text = sink.lines.join('\n') + '\n'
  sink.writing = sink.writing
    .then(() => $.fs.write(`${$.plugin.root}/logs/${sink.file}`, text))
    .catch(() => undefined)
  return sink.writing
}

function usageOf(
  requested: string,
  u: {
    model: string
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  } | null,
) {
  return {
    requestedModel: requested,
    answeredBy: u?.model ?? null,
    input: u?.input_tokens ?? null,
    output: u?.output_tokens ?? null,
    cacheRead: u?.cache_read_input_tokens ?? null,
    cacheWrite: u?.cache_creation_input_tokens ?? null,
  }
}
