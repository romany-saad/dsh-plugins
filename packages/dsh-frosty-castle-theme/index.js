import z from '@deepseek-ai/schemastery'

export const name = 'dsh-frosty-castle-theme'

/** Frame width bounds, in CSS pixels. The client clamps to the same range. */
export const BORDER_WIDTH = { min: 12, max: 48, default: 48 }
export const BORDER_OFFSET = { min: 0, max: 48, default: 0 }
export const INSET_ADJUSTMENT = { min: -48, max: 96, default: 0 }
export const CREST_Y = { min: -48, max: 96, default: 0 }
export const CREST_SIZE = { min: 50, max: 200, default: 100 }

/** Live preferences: edited on Frost's page under Plugins, applied without a restart. */
export const Config = z.object({
  borderWidth: z.natural().min(BORDER_WIDTH.min).max(BORDER_WIDTH.max).default(BORDER_WIDTH.default).volatile(),
  borderOffset: z.natural().min(BORDER_OFFSET.min).max(BORDER_OFFSET.max).volatile(),
  // Unset edges inherit the legacy borderOffset in the client.
  borderOffsetTop: z.natural().min(BORDER_OFFSET.min).max(BORDER_OFFSET.max).volatile(),
  borderOffsetRight: z.natural().min(BORDER_OFFSET.min).max(BORDER_OFFSET.max).volatile(),
  borderOffsetBottom: z.natural().min(BORDER_OFFSET.min).max(BORDER_OFFSET.max).volatile(),
  borderOffsetLeft: z.natural().min(BORDER_OFFSET.min).max(BORDER_OFFSET.max).volatile(),
  crestOffsetY: z.number().step(1).min(CREST_Y.min).max(CREST_Y.max).default(CREST_Y.default).volatile(),
  crestSize: z.number().step(1).min(CREST_SIZE.min).max(CREST_SIZE.max).default(CREST_SIZE.default).volatile(),
  compatibilityInset: z.boolean().default(true).volatile(),
  compatibilityInsetTop: z.number().step(1).min(INSET_ADJUSTMENT.min).max(INSET_ADJUSTMENT.max).default(-16).volatile(),
  compatibilityInsetRight: z.number().step(1).min(INSET_ADJUSTMENT.min).max(INSET_ADJUSTMENT.max).default(0).volatile(),
  compatibilityInsetBottom: z.number().step(1).min(INSET_ADJUSTMENT.min).max(INSET_ADJUSTMENT.max).default(-16).volatile(),
  compatibilityInsetLeft: z.number().step(1).min(INSET_ADJUSTMENT.min).max(INSET_ADJUSTMENT.max).default(0).volatile(),
})

/**
 * Frost's page under Plugins is its own form, so Settings must not also
 * generate one from the schema. Optional: Frost runs without Settings.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
