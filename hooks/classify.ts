// Pure prompt classifier: no `$`, no I/O, so it is unit-testable.
//
// Every rule names the source it rests on (SOURCES below). No study shows
// keyword rules beat a single well-chosen model (RouterBench, LLMRouterBench),
// so the default is `normal` (= leave the session alone), and a prompt is
// moved only on a clear signal. Hard signals win over easy ones.

export type Tier = 'easy' | 'normal' | 'hard'
/** `idle`: the prompt holds no task (a greeting, a thanks), so it says
 * nothing about the work and must not pick the session's model. */
export type Verdict = { tier: Tier; reason: string; idle?: boolean }

export const SOURCES = {
  // platform.claude.com/docs/en/about-claude/models/choosing-a-model
  // Opus: "large-scale refactoring, complex systems engineering"
  choosing: 'Anthropic: choosing a model',
  // code.claude.com/docs/en/costs: "Reserve Opus for complex architectural
  // decisions or multi-step reasoning"
  costs: 'Claude Code docs: costs',
  // code.claude.com/docs/en/model-config: haiku = "simple tasks"; effort low
  // for "quick exchanges or small changes"; opusplan = Opus for planning
  modelConfig: 'Claude Code docs: model config',
  // claude.com/resources/articles/claude-model-and-effort-level-in-claude-code:
  // larger models "for more complex or ambiguous tasks"
  hallie: 'Anthropic article: model and effort level',
  // arxiv.org/html/2505.23419v2 §4.4: success < 10% once a fix touches
  // 3+ files or 100+ lines
  sweLive: 'SWE-bench-Live',
  // claude-code-router: a longContext route past a token threshold
  ccr: 'claude-code-router',
} as const

// `t` is the prompt as typed (greeting dropped), for the English patterns;
// `low` is it folded: lowercase with Vietnamese tone marks removed, so a
// prompt typed without diacritics ("git la gi") matches as one typed with them.
type Rule = { id: string; source: keyof typeof SOURCES; test: (t: string, low: string) => boolean }

export const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

// A greeting before the request ("hello, ...", "chào bạn, ...") says nothing
// about the task; it is dropped so the rules read the request itself.
const GREETING = /^(hello|hi|hey|yo|alo|xin chao|chao ban|chao|hey claude|hi claude)\b[\s,.!:;-]*/i
const dropGreeting = (t: string) => {
  const folded = fold(t)
  const m = folded.match(GREETING)
  return m ? t.slice(m[0].length).trim() : t
}

// A prompt that is only small talk: no task to judge the session by.
const SMALL_TALK = /^(hello|hi|hey|yo|alo|xin chao|chao ban|chao|hey claude|hi claude|claude|thanks|thank you|thx|cam on|ok|oke|okay|good (morning|afternoon|evening)|chao buoi sang)([\s,.!?~:;-]+(claude|ban|nhe|nha|a))*[\s,.!?~:;-]*$/i

const any = (low: string, words: readonly string[]) => words.some(w => low.includes(w))
const re = (pattern: RegExp) => (t: string) => pattern.test(t)

// ---- hard: complex, ambiguous or wide in scope ----------------------------
const HARD_RULES: readonly Rule[] = [
  {
    id: 'refactor-or-migration',
    source: 'choosing',
    test: (t, low) =>
      re(/\b(refactor\w*|migrat\w*|rewrite|re-?architect\w*|port (this|it|the) \w+ to)\b/i)(t) ||
      any(low, ['tai cau truc', 'refactor', 'viet lai toan bo', 'chuyen doi sang', 'nang cap tu']),
  },
  {
    id: 'architecture-or-design',
    source: 'costs',
    test: (t, low) =>
      re(/\b(architect\w*|system design|design (a|an|the) \w+|trade-?offs?|scalab\w+)\b/i)(t) ||
      any(low, ['kien truc', 'thiet ke he thong', 'thiet ke lai', 'danh doi', 'kha nang mo rong']),
  },
  {
    id: 'planning',
    source: 'modelConfig',
    test: (t, low) =>
      re(/\b(implementation plan|plan (out|how)|step-by-step plan|roadmap)\b/i)(t) ||
      any(low, ['lap ke hoach', 'len ke hoach', 'ke hoach trien khai']),
  },
  {
    id: 'ambiguous-debugging',
    source: 'hallie',
    test: (t, low) =>
      re(/\b(root cause|race condition|deadlock|memory leak|intermittent\w*|flaky|heisenbug|sometimes (fails|crashes|hangs)|non-?deterministic)\b/i)(t) ||
      any(low, ['nguyen nhan goc', 'luc duoc luc khong', 'thinh thoang bi', 'ro ri bo nho', 'khong on dinh']),
  },
  {
    id: 'wide-scope',
    source: 'sweLive',
    test: (t, low) =>
      re(/\b(across (the|all|every|multiple)|whole (codebase|project|repo)|entire (codebase|project|repo)|all (the )?(files|modules|services)|multiple (files|modules|services)|every (file|module|service))\b/i)(t) ||
      any(low, ['toan bo codebase', 'toan bo project', 'toan bo du an', 'nhieu file', 'tat ca cac file', 'tat ca file', 'nhieu module']),
  },
  {
    id: 'large-context',
    source: 'ccr',
    // ~8k chars is ~2k tokens of pasted material: a big spec, log or diff.
    test: t => t.length > 8000,
  },
]

// ---- easy: routine, small and well-specified -------------------------------
const EASY_RULES: readonly Rule[] = [
  {
    id: 'mechanical-edit',
    source: 'modelConfig',
    test: (t, low) =>
      re(/\b(rename|typo|spelling|reformat|format (this|the|it)|lint|sort (the )?imports|add (a |an )?(comment|docstring|jsdoc|type hint)s?|remove (unused|the) (import|variable|console\.log)s?)\b/i)(t) ||
      any(low, ['doi ten', 'loi chinh ta', 'sua chinh ta', 'dinh dang lai', 'them comment', 'them chu thich', 'xoa import']),
  },
  {
    id: 'quick-question',
    source: 'modelConfig',
    test: (t, low) =>
      re(/^(what does|what is|what's|how do i|how to|explain|which command|is there a)\b/i)(t) ||
      any(low, ['la gi', 'giai thich', 'lam sao de', 'lenh nao', 'nghia la gi']) ||
      // "... (dùng để) làm gì?" asked about a thing, at the end of the prompt
      /\blam gi\s*\??\s*$/.test(low),
  },
]

// A prompt is easy only when it is short and carries nothing to debug.
const EASY_MAX_CHARS = 200
const looksLikeDebugging = (t: string) =>
  /```|\bTraceback\b|\b\w*(Error|Exception):|\n\s+at .+:\d+|\bstack trace\b/.test(t)

export function classify(text: string): Verdict {
  const typed = text.trim()
  if (typed === '') return { tier: 'normal', reason: 'empty' }
  if (SMALL_TALK.test(fold(typed))) return { tier: 'easy', reason: 'small-talk', idle: true }
  const t = dropGreeting(typed) || typed
  const low = fold(t)

  const hard = HARD_RULES.find(r => r.test(t, low))
  if (hard) return { tier: 'hard', reason: `${hard.id} [${SOURCES[hard.source]}]` }

  if (t.length <= EASY_MAX_CHARS && !looksLikeDebugging(t)) {
    const easy = EASY_RULES.find(r => r.test(t, low))
    if (easy) return { tier: 'easy', reason: `${easy.id} [${SOURCES[easy.source]}]` }
  }

  return { tier: 'normal', reason: 'default' }
}
