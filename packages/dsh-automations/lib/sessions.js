// Reading and steering Host Sessions (DSH 0.2.2-rc.1 and later).

/**
 * One Session's working folder and events, or undefined when it does not
 * exist. Read through ctx.sessionQuery, which never makes a cold Session live.
 */
export async function inspectSession(ctx, sessionId) {
  let observation
  try {
    observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
  } catch (error) {
    if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return undefined
    throw error
  }
  try {
    return { cwd: observation.header.cwd, events: [...observation.events] }
  } finally {
    observation[Symbol.dispose]?.()
  }
}

/** A user message the Session controller admitted with this request id. */
export const hasRequest = (events, requestId) =>
  events.some((e) => e.type === 'user/message' && e.data?.source?.rpcId === requestId)

/** Whether any user message reached the Session. */
export const hasUserMessage = (events) => events.some((e) => e.type === 'user/message')

/**
 * Select a model for one Session only. The public selectModel Remote also
 * saves it as the profile's default model, which must not happen here.
 */
export function selectSessionModel(agent, selection) {
  if (typeof agent?.model?.select !== 'function') throw new Error('this DSH version exposes no Session-local model selection')
  agent.model.select(selection)
}
