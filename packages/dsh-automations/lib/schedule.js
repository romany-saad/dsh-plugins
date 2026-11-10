// The Host Schedule as this plugin uses it (DSH 0.2.2-rc.1 and later). This is
// the one place that knows the shape of its requests and catalog entries:
//
// - create({ title, prompt, timing: { kind, <selector> }, target })
// - edit({ id, action: 'update', patch, expectedUpdatedAt }) and edit({ id, action: 'delete' })
// - catalog() entries name their Session in target.sessionId; status is
//   active, paused or ended.
//
// Every write names the task's own Session as the acting Session. The
// Schedule tells each involved Session's live agent about a change, except the
// actor, with a "[SCHEDULE CHANGE]" message the model reads. The plugin's own
// writes are bookkeeping, so the task conversation gets no such message.

/** The Session a catalog entry delivers to, or undefined for a `new` target. */
export function sessionOf(entry) {
  const target = entry?.target
  return target && target.kind !== 'new' ? target.sessionId : undefined
}

/** A finished one-shot, or a task the Schedule ended. */
export const isEnded = (entry) => entry?.status === 'ended'

/** Create one task that delivers to an existing Session. Bad input throws ScheduleInputError (error.code). */
export function createTask(schedule, sessionId, { title, prompt, timing }) {
  return schedule.create({ title, prompt, timing, target: { kind: 'session', sessionId } }, sessionId)
}

/**
 * Change one task in place. Returns { entry } on success, or { code } for a
 * miss (`schedule_not_found`) or a concurrent change (`schedule_conflict`).
 * Bad input throws ScheduleInputError, as create does.
 */
export async function updateTask(schedule, { id, sessionId, expectedUpdatedAt, patch }) {
  const result = await schedule.edit({ id, action: 'update', patch, expectedUpdatedAt: expectedUpdatedAt ?? null }, sessionId)
  if (result && typeof result.code === 'string') return { code: result.code }
  return { entry: result }
}

/**
 * Delete one task; one that is already gone is not an error. sessionId is the
 * task's own Session; leave it out when the task is someone else's (a
 * reminder being adopted), whose conversation should hear of it.
 */
export async function deleteTask(schedule, id, sessionId) {
  await schedule.edit({ id, action: 'delete' }, sessionId)
}
