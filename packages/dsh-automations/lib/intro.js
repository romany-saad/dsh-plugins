// The introduction a new task conversation starts with: a short prompt that
// asks the model to welcome the user, and a schedule in plain words.

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const clock = (time) => (typeof time === 'string' && time.endsWith(':00') ? time.slice(0, -3) : time)

function span(seconds) {
  for (const [size, name] of [[86400, 'day'], [3600, 'hour'], [60, 'minute']]) {
    if (seconds % size === 0) {
      const n = seconds / size
      return n === 1 ? `every ${name}` : `every ${n} ${name}s`
    }
  }
  return `every ${seconds} seconds`
}

/** A normalized schedule spec (see normalizeSchedule) in plain words. */
export function describeSchedule(spec) {
  switch (spec.kind) {
    case 'cron': return `cron "${spec.expression}" (${spec.tz})`
    case 'daily': return `every day at ${clock(spec.time)} (${spec.time_zone})`
    case 'weekly': return `every ${spec.weekdays.map((d) => DAYS[d]).join(', ')} at ${clock(spec.time)} (${spec.time_zone})`
    case 'every': return span(spec.every_seconds)
    case 'at': return `once, at ${typeof spec.at === 'string' ? spec.at : JSON.stringify(spec.at)}`
    default: return spec.kind
  }
}

/**
 * The message that starts a new task conversation: two sentences the user sees
 * as the first message, which the model answers. It carries the task's title,
 * schedule and file, and none of its prompt.
 */
export function introPrompt(task, { sessionTitlePrefix = '' } = {}) {
  const where = task.file ? ` It is defined in ${task.file}.` : ''
  const runs = task.session === 'fresh'
    ? `Each run opens its own conversation, titled "${sessionTitlePrefix}${task.title} · <date and time>"; nothing runs in this one.`
    : 'Each run arrives here as a new message.'
  return `Greet the user in three short lines, with no tools: this conversation was just created for the scheduled task "${task.title}" (${describeSchedule(task.schedule.spec)}).${where} ${runs} Say that saving the file updates the task, and suggest pinning this conversation.`
}
