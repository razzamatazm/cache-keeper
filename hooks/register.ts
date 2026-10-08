import type { EngineInterface as Engine, Register } from 'claude-code'

// The prompt cache lapses after 60 idle minutes. One read at 50 refreshes it;
// at 100 it is still warm from that read, so the handoff costs a cache read too.
export const PING_AFTER_MS = 50 * 60 * 1000
export const HANDOFF_AFTER_MS = 50 * 60 * 1000

const PING_PROMPT = 'Keep-alive check. Reply with the single word: ok'

const HANDOFF_PROMPT = `Write a handoff document summarising this conversation so a fresh agent with none of this context can continue the work.

- Open with the goal, where things stand, and the exact next step.
- List decisions made and why, open questions, and anything tried that failed.
- Reference files, branches, PRs, issues, specs and commits by path or URL instead of copying their content.
- Include a "Suggested skills" section naming the skills the next agent should call the Skill tool for.
- Redact secrets, API keys, passwords and personal information.

Reply with the Markdown document only, no preamble.`

type Timer = { cancel: () => void }

let timer: Timer | undefined

function stop($: Engine) {
  timer?.cancel()
  timer = undefined
  $.ui.status(undefined)
}

async function at($: Engine, ms: number) {
  return new Date((await $.clock.now()) + ms).toTimeString().slice(0, 5)
}

async function handoff($: Engine) {
  timer = undefined
  $.ui.status('cache-keeper: writing handoff…')
  const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
  if (!reply.isAnswered) {
    $.ui.status(undefined)
    $.ui.log(`cache-keeper: handoff not written (${reply.reason})`)
    return
  }

  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')
  const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const path = `${tmp}/handoff-${(await $.session.id()).slice(0, 8)}-${stamp}.md`
  await $.fs.write(path, reply.text)

  const resume = `Read the handoff doc at ${path} and continue the work from where it leaves off.`
  const copied = await $.ui.copy({ text: resume }).catch(() => ({ isCopied: false }))
  await $.session.append({
    message: {
      type: 'system',
      content: [
        {
          type: 'text',
          text: [
            'cache-keeper: this conversation has been idle 100 minutes and its cache lapses in about 10.',
            `Handoff written to ${path}`,
            `To continue, /clear (or open a new window) and paste${copied.isCopied ? ' (already on your clipboard)' : ''}:`,
            '',
            resume,
          ].join('\n'),
        },
      ],
    },
  })
  $.ui.status(undefined)
  $.ui.toast('cache-keeper: handoff ready, continue prompt copied')
}

async function ping($: Engine) {
  const reply = await $.model.fork({ prompt: PING_PROMPT })
  if (!reply.isAnswered) {
    timer = undefined
    $.ui.status(undefined)
    if (reply.reason !== 'nothing-to-fork') $.ui.log(`cache-keeper: warm ping failed (${reply.reason})`)
    return
  }
  const read = reply.usage.cache_read_input_tokens ?? 0
  $.ui.log(`cache-keeper: warm ping read ${Math.round(read / 1000)}k cached tokens`, { to: 'debug' })
  timer = $.clock.after(HANDOFF_AFTER_MS, () => void handoff($))
  $.ui.status(`cache-keeper: handoff at ${await at($, HANDOFF_AFTER_MS)}`)
}

async function arm($: Engine) {
  stop($)
  timer = $.clock.after(PING_AFTER_MS, () => void ping($))
  $.ui.status(`cache-keeper: warm ping at ${await at($, PING_AFTER_MS)}`)
}

export const register: Register = on => {
  on('turn.start', ($, e, next) => {
    stop($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await arm($)
    return done
  })

  on('session.end', ($, e, next) => {
    stop($)
    return next(e)
  })
}
