// Host Schedule records, the persisted state domains and Schedule deliveries.

export const STATE_VERSION = 1

// ---------------------------------------------------------------------------
// Host record helpers

export function timingSig(record) {
  switch (record.kind) {
    case 'cron': return `cron|${record.expression}|${record.timeZone}`
    case 'daily': return `daily|${record.time}|${record.timeZone}`
    case 'weekly': return `weekly|${record.time}|${record.timeZone}|${record.weekdays.join(',')}`
    case 'every': return `every|${record.everySeconds}`
    case 'at': return `at|${record.scheduledAt}`
    case 'after': return `after|${record.scheduledAt}`
    default: return `${record.kind}|${record.scheduledAt}`
  }
}

/** Strip catalog-only members so the value equals the stored ScheduleRecord. */
export function recordOf(entry) {
  const { sessionId: _s, status: _st, lastDelivery: _l, ...record } = entry
  return record
}

// ---------------------------------------------------------------------------
// Persistent applied state

const recordSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || value.v !== STATE_VERSION || typeof value.taskId !== 'string') {
      throw new Error('invalid automation-sync state record')
    }
    return value
  },
  safeParse(value) {
    try {
      return { success: true, data: this.parse(value) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

// The domain names are those of the plugin this package grew from, so a
// profile that switches over keeps its applied state and queued runs.
export const domainSpec = {
  name: 'automation_sync',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: { tasks: { valueSchema: recordSchema } },
}

function plainSchema(check, what) {
  return {
    parse(value) {
      if (!value || typeof value !== 'object' || value.v !== STATE_VERSION || !check(value)) {
        throw new Error(`invalid automation-sync ${what} record`)
      }
      return value
    },
    safeParse(value) {
      try {
        return { success: true, data: this.parse(value) }
      } catch (error) {
        return { success: false, error }
      }
    },
  }
}

// Fresh-session runs. `runs` holds a run from the moment a delivery is
// intercepted until its prompt is admitted into the new Session, so a crash in
// between resumes the same run (same Session id, same request id) instead of
// losing or duplicating it. `history` keeps each task's recent run Sessions.
export const runsDomainSpec = {
  name: 'automation_sync_runs',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: {
    runs: { valueSchema: plainSchema((v) => typeof v.runSessionId === 'string' && typeof v.task === 'object', 'run') },
    history: { valueSchema: plainSchema((v) => Array.isArray(v.sessions), 'run history') },
  },
}

/** Read the task prompt and occurrence out of a Schedule delivery message. */
export function parseDelivery(message) {
  const text = (message.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  const line = (name) => {
    const m = new RegExp(`^${name}: (.*)$`, 'm').exec(text)
    return m ? m[1] : undefined
  }
  try {
    const batch = line('reminders_json')
    if (batch !== undefined) {
      const first = JSON.parse(batch)[0]
      return { prompt: first?.reminder_prompt, occurrenceAt: first?.occurrence_at }
    }
    const prompt = line('reminder_prompt_json')
    return { prompt: prompt === undefined ? undefined : JSON.parse(prompt), occurrenceAt: line('occurrence_at') }
  } catch {
    return {}
  }
}
