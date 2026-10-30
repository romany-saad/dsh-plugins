// A real cordis Context with a stand-in tools service: register() adds a
// definition until the registering scope is disposed, as dsh-tools does.
import { Context, Service } from '@deepseek-ai/cordis'

export function createHost() {
  const tools = new Map()
  class Tools extends Service {
    constructor(ctx) {
      super(ctx, 'tools')
    }
    register(definition) {
      return this.ctx.effect(() => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      })
    }
  }
  const sections = new Map()
  class SystemPrompt extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    section(value) {
      return this.ctx.effect(() => {
        sections.set(value.name, value)
        return () => sections.delete(value.name)
      })
    }
  }
  const ctx = new Context()
  ctx.plugin(Tools)
  ctx.plugin(SystemPrompt)
  return { ctx, tools, sections }
}

/** Load the plugin under ctx and wait until its tools are registered (or it settles). */
export async function load(ctx, plugin, config) {
  const fork = ctx.plugin(plugin, config)
  await fork
  return fork
}
