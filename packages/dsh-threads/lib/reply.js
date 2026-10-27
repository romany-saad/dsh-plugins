// The brief AI reply to a comment thread: one model call loop on the
// session's own model, with three read-only tools over the session's log.
// Nothing here writes to the session or enters its model history.
import {
  anchorSource, around, findAnchorEvent, replyAfter, sessionTitle, sessionTools, TOOL_SCHEMAS, turnPrompt,
} from './session-text.js'
import { CommentError } from './threads.js'

export const SYSTEM_PROMPT = `You reply to comments a user leaves on passages of a conversation between the user and a coding agent. The user selected a passage, wrote a comment about it, and you answer in a small side thread next to the passage.

- Answer the comment about that passage. Be brief: at most about 80 words, plain sentences, Markdown only for code. No headings, no greetings.
- When the comment is only a note to self, acknowledge it in one short sentence.
- You see the passage, the message it is in and the prompt of that turn. When you need more, use the tools to look further in the session; do not guess what happened elsewhere.
- You cannot act: you have no tools beyond reading the session, and the agent does not see this thread. Do not offer to change files or run commands. If the user wants the agent to act, say they can send this thread to the chat.
- Write in the language of the comment.`

const MAX_SOURCE = 6000
const MAX_PROMPT = 2000
const MAX_FOLLOW = 1500

/** The opening user message: where the passage is, and the thread so far. */
export function buildPrompt(events, thread) {
  const { anchor } = thread
  const event = findAnchorEvent(events, anchor)
  const lines = []
  const title = sessionTitle(events)
  if (title) lines.push(`Session: ${title}`)
  const where = anchor.kind === 'user' ? 'a message the user sent'
    : anchor.kind === 'reasoning' ? `the agent's reasoning in turn ${anchor.turn}, step ${anchor.step}`
      : `the agent's reply in turn ${anchor.turn}, step ${anchor.step}`
  lines.push(`The passage is in ${where}${event ? ` (seq ${event.seq})` : ' (no longer in the log)'}.`)
  if (event !== undefined) {
    if (anchor.kind !== 'user') {
      const prompt = turnPrompt(events, anchor.turn, event.seq)
      if (prompt) lines.push('', 'The user prompt of that turn:', '<prompt>', around(prompt, '', MAX_PROMPT), '</prompt>')
    }
    const source = anchorSource(event, anchor)
    if (source) lines.push('', 'The whole message the passage is in:', '<message>', around(source, anchor.text, MAX_SOURCE), '</message>')
    if (anchor.kind === 'user') {
      const answer = replyAfter(events, event.seq)
      if (answer) lines.push('', "The agent's reply to it:", '<reply>', around(answer, '', MAX_FOLLOW), '</reply>')
    }
  }
  lines.push('', 'The passage the user selected:', '<passage>', anchor.text, '</passage>')
  const [first, ...rest] = thread.messages
  lines.push('', 'The comment:', '<comment>', first.text, '</comment>')
  if (rest.length > 0) {
    lines.push('', 'The thread since:')
    for (const m of rest) lines.push(`<${m.role === 'user' ? 'user' : 'you'}>`, m.text, `</${m.role === 'user' ? 'user' : 'you'}>`)
  }
  lines.push('', 'Reply to the last comment from the user.')
  return lines.join('\n')
}

/**
 * Run the reply loop.
 * @param {object} o
 * @param {object} o.llm            ctx.llm
 * @param {object} o.lib            { BlockAssembler, createToolResultMessage, ReasoningEffortId } from @deepseek-ai/dsh-llm
 * @param {object[]} o.events       the session's events
 * @param {object} o.thread         the thread to answer
 * @param {{provider: string, model: string, reasoningEffort?: string}} o.route
 * @param {number} o.maxTokens
 * @param {number} o.maxRounds      model calls; the last one gets no tools
 * @param {AbortSignal} o.signal
 * @returns {Promise<{ text: string, model: string, rounds: number }>}
 */
export async function runReply({ llm, lib, events, thread, route, maxTokens, maxRounds, signal }) {
  const config = { provider: route.provider, model: route.model, maxTokens }
  if (route.reasoningEffort) config.reasoningEffort = lib.ReasoningEffortId(route.reasoningEffort)
  const tools = sessionTools(events)
  const messages = [{ role: 'user', content: [{ type: 'text', text: buildPrompt(events, thread) }] }]
  for (let round = 1; round <= maxRounds; round++) {
    signal.throwIfAborted()
    // A prepared call streams once: each round prepares its own.
    const call = await llm.prepareCall(config, signal)
    const last = round === maxRounds
    const assembler = new lib.BlockAssembler()
    const stream = call.stream({
      ...call.config,
      system: SYSTEM_PROMPT + (last ? '\n\nAnswer now with what you have; the tools are no longer available.' : ''),
      messages,
      ...(last ? {} : { tools: TOOL_SCHEMAS }),
      signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      signal.throwIfAborted()
      throw new CommentError('reply_failed', 'The model failed: ' + (finish.failure?.message ?? finish.kind), 502)
    }
    const blocks = assembler.blocks()
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    const calls = blocks.filter((b) => b.type === 'tool-call')
    if (calls.length === 0 || last) {
      if (!text) throw new CommentError('reply_empty', finish.kind === 'max-tokens' ? 'The reply ran out of tokens' : 'The model gave no reply', 502)
      return { text, model: route.model, rounds: round }
    }
    messages.push(assembler.message({ provider: call.config.provider, model: call.config.model, replayState: assembler.replayState }))
    for (const c of calls) {
      let result, isError = false
      try {
        result = tools(c.name, c.arguments ? JSON.parse(c.arguments) : {})
      } catch (error) {
        result = 'Error: ' + (error?.message ?? String(error))
        isError = true
      }
      messages.push(lib.createToolResultMessage({ callId: c.id, content: [{ type: 'text', text: result }], isError }))
    }
  }
  throw new CommentError('reply_failed', 'The reply did not finish', 502)
}
