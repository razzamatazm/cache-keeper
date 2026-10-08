import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { HANDOFF_AFTER_MS, PING_AFTER_MS, splitReply } from './register'

const MIN = 60 * 1000
const turn = { turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' } as const

function world(on: On) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 12) })
  const session = mock.session(on)
  mock.env(on, { TMPDIR: '/tmp/x/' })
  const forks: string[] = []
  const writes: { path: string; text: string }[] = []
  const copies: string[] = []
  on('model.fork', (_$, e) => {
    forks.push(e.prompt)
    return { value: {
      isAnswered: true,
      text: forks.length === 1 ? 'ok' : '# Handoff\nnext step\n\n===NEXT SESSION PROMPT===\nShip the retry fix in api.ts and get CI green.',
      usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 300000, cache_creation_input_tokens: 0 },
    } }
  })
  on('fs.write', (_$, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('ui.copy', (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.id', () => ({ value: 'abcdef1234567' }))
  on('turn.complete', () => ({ text: 'done' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  return { clock, session, forks, writes, copies }
}

test('pings once at 50 idle minutes, writes the handoff at 100', async ($, on) => {
  const w = world(on)
  await $.turn.complete(turn)

  await w.clock.advance(PING_AFTER_MS - MIN)
  expect(w.forks).toHaveLength(0)
  await w.clock.advance(MIN)
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('Keep-alive')

  await w.clock.advance(HANDOFF_AFTER_MS)
  expect(w.forks).toHaveLength(2)
  expect(w.writes).toEqual([{ path: '/tmp/x/handoff-abcdef12-2026-10-08-13-40.md', text: '# Handoff\nnext step\n' }])
  expect(w.copies).toEqual(['Read the handoff doc at /tmp/x/handoff-abcdef12-2026-10-08-13-40.md. Ship the retry fix in api.ts and get CI green.'])
  const notice = w.session.appended()[0]?.message.content[0]
  expect(notice).toEqual(expect.objectContaining({ type: 'text' }))
  expect(notice?.type === 'text' ? notice.text : '').toContain(w.copies[0])

  await w.clock.advance(4 * 60 * MIN)
  expect(w.forks).toHaveLength(2)
})

test('a new turn resets the idle clock', async ($, on) => {
  const w = world(on)
  await $.turn.complete(turn)
  await w.clock.advance(40 * MIN)
  await $.turn.start({ turnId: 't2' } as never)
  await w.clock.advance(40 * MIN)
  expect(w.forks).toHaveLength(0)
  await $.turn.complete(turn)
  await w.clock.advance(PING_AFTER_MS)
  expect(w.forks).toHaveLength(1)
})

test('a reply with no next prompt falls back to a generic one', () => {
  expect(splitReply('# Handoff\nbody')).toEqual({ doc: '# Handoff\nbody', next: 'Continue the work from where it leaves off.' })
})
