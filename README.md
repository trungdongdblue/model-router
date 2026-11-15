# model-router

A [Claude Code](https://code.claude.com) mod that reads how hard each prompt is, then picks the **model once per session** and the **effort per prompt**, to cut cost without giving up quality on hard work.

> Experimental. The rules are keyword based and there are no savings measured from real use yet. Start in `log` mode and read the logs before turning `route` on.

## How it works

1. Each typed prompt is classified as **easy**, **normal** or **hard** by keyword rules (English and Vietnamese, with or without diacritics). No model is called to classify, so it costs nothing.
2. Small talk (`hello`, `thanks`, `ok`) says nothing about the work: it does not pick the model and keeps the session's effort.
3. The first real prompt picks the session's model.
4. After that the model is kept, because every model has its own prompt cache and a switch re-reads the whole conversation uncached. The one exception is **escalation**: a session that started light moves up when a prompt is harder. It never moves down.
5. Effort changes on every prompt, which keeps the cache (one measured run kept about 86% of it going from `high` to `low`).

| Tier | Session model (picked by the first real prompt) | Effort for the prompt |
|---|---|---|
| easy | `haiku` | `low` |
| normal | your own model (e.g. `opus[1m]`) | the session's own |
| hard | your own model | `xhigh` |

A few test runs on one machine: an easy first prompt cost about $0.003 on Haiku against about $0.16 on Opus; escalating from Haiku to Opus at the second prompt cost about $0.37, roughly what a fresh Opus session costs. A wrong Haiku pick is cheap.

## Install

Needs Claude Code 2.1.325 or later (`claude update`). At the prompt of a terminal session:

```
/plugin install model-router --marketplace trungdongdblue/model-router
```

Or from a shell:

```bash
claude plugin install model-router --marketplace trungdongdblue/model-router
```

Answer `y` to add the marketplace, pick the `user` scope (every session), then set the options on the next screen. The default is `mode: log`, which only classifies and logs; choose `route` to apply the model and effort. Change options later in `/config`; disable or remove the mod in `/plugin`.

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `trungdongdblue/model-router`, then **Add plugin**.

The mod is running when a `router: …` line shows above the prompt box after your first prompt.

## Try it without installing

```bash
git clone https://github.com/trungdongdblue/model-router.git
claude --plugin-dir ./model-router \
  --settings '{"pluginConfigs":{"model-router":{"options":{"mode":"route"}}}}'
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `mode` | `log` | `log`: classify and log only. `route`: apply the model and effort |
| `lever` | `both` | `both`: model per session, effort per prompt. `effort` or `model`: only one of them |
| `switchStyle` | `visible` | `visible`: switch the session's model so `/model` and the footer show it. `silent`: send the model on each request, touch no setting |
| `easyEffort` | `low` | Effort for easy prompts |
| `hardEffort` | `xhigh` | Effort for hard prompts |
| `easyModel` | `haiku` | Session model when the first prompt is easy |
| `normalModel` | *(empty)* | Session model when the first prompt is normal; empty keeps your own |
| `hardModel` | *(empty)* | Model for hard prompts; empty keeps your own |
| `switchTurns` | `1` | How many first prompts may pick the model |
| `escalate` | `true` | Move the session up when a later prompt is harder |
| `guideSubagents` | `false` | Guide the main session to pick each subagent's model and effort (see below) |

Example, effort only, models untouched: set `mode` to `route` and `lever` to `effort`.

## Subagents

On a large task the main session delegates work to subagents through the Agent tool. By default a subagent runs on the main session's model, so a file search on an Opus session runs on Opus. The main session can set a subagent's `model` and `effort` on each call, but rarely does unless asked.

With `guideSubagents` on (and `mode: route`), the mod sends a short guide beside the session's first prompt, which the model reads and you do not see:

| Delegated work | Model | Effort |
|---|---|---|
| Searching, locating files, reading code to report back | `haiku` | `low` |
| Routine implementation or tests with a clear spec | unset (the session's) | unset |
| Design, architecture, unclear debugging, judgment reviews, many-file changes | unset (the session's) | `xhigh` |

The main session still decides: it has the context the mod lacks, and agent types with their own definitions are left alone. The mod never rewrites a subagent call; it logs each one (`subagent-call`: type, model, effort) so you can check the choices. In one test, a file search delegated to `Explore` ran on Haiku at effort low, and the run cost $0.155 against $0.276 without the guide.

The guide goes with the first prompt rather than into the system prompt, because another plugin may answer the system prompt first; after `/clear` it is sent again.

## Where the switch shows

| Where you run Claude | How the model is switched | `/model` and the footer |
|---|---|---|
| Terminal (`claude`) | `visible`: the session's model really changes, with a toast | show the new model |
| VS Code chat panel, `claude -p`, SDK | always `silent`: the model rides on each request | keep showing your own model |

The status line (`router: easy prompt · model haiku · effort low`) shows the real pick everywhere.

**Your saved setting never changes.** In the terminal, Claude Code's model switch also writes `~/.claude/settings.json`. The mod reads the file first, switches, then writes the original text back: the running session keeps the new model, the next session opens on yours, however you quit (`/exit`, `/clear`, Ctrl+C). If another change lands in the file at that moment, the mod keeps that change and restores your model at `/exit`, `/clear`, or in the next session.

## Classification rules

The rules live in `hooks/classify.ts`, each naming its source. The default is `normal` (nothing changed), and a hard signal always beats an easy one.

| Tier | Signal | Example | Source |
|---|---|---|---|
| hard | refactor, migration, major upgrade | `refactor the auth module to use dependency injection` | [Anthropic: choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model) |
| hard | architecture or system design | `design the architecture for a multi-tenant billing service` | [Claude Code docs: costs](https://code.claude.com/docs/en/costs) |
| hard | planning | `plan the upgrade from React 17 to React 19` | [Claude Code docs: model config](https://code.claude.com/docs/en/model-config) (opusplan) |
| hard | ambiguous debugging: root cause, flaky, intermittent | `tests are flaky in CI, find the root cause` | [Anthropic: model and effort level](https://claude.com/resources/articles/claude-model-and-effort-level-in-claude-code) |
| hard | wide scope across files | `rename userId to accountId across all files` | [SWE-bench-Live §4.4](https://arxiv.org/html/2505.23419v2): under 10% solved once a fix touches 3+ files |
| hard | prompt over 8,000 characters | (a pasted log or document) | [claude-code-router](https://github.com/musistudio/claude-code-router) long-context route |
| easy | mechanical edit: rename, typo, format, comment | `fix the typo in README` | [Claude Code docs: model config](https://code.claude.com/docs/en/model-config) |
| easy | quick question: what is, what does, which command | `What does git stash do?` | [Claude Code docs: model config](https://code.claude.com/docs/en/model-config) |
| normal | everything else | `add a /health endpoint to the express server` | (default) |

A prompt is easy only when it is under 200 characters and holds no stack trace or code block. A leading greeting is ignored (`hi, what does git stash do?` is easy).

## Logs

Each session writes one JSONL file to `logs/` in the plugin's folder, one event per line:

- `turn.start`: the tier, the rule that matched, the model picked, and the first 80 characters of the prompt
- `step`: the model that actually answered (`answeredBy`), tokens, cache read and write
- `turn.complete`: the session's cost so far

Logs stay on your machine and hold part of your prompts; `logs/` is git-ignored.

## Development

```bash
claude plugin validate .
claude plugin test .
```

`hooks/classify.ts` (the rules) and `hooks/route.ts` (the session policy) are pure functions with unit tests; `hooks/register.ts` wires them into Claude Code's events. To turn every mod off for one session: `claude --safe-mode`.

## Limitations

- Keyword rules misclassify. Research on keyword routers finds they rarely beat using one good model for everything; measure before you rely on it.
- In the VS Code chat panel the model picker does not show the switched model.
- A small-talk first prompt still runs on your own model.
