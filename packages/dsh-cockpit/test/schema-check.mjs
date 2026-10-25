// A small checker for the JSON Schema keywords board.schema.json uses, so the
// schema test needs no dependency: type, const, enum, required, properties,
// items, additionalProperties, minLength, minimum and local $ref. A keyword
// the schema uses that this file does not know fails the check.
const KNOWN = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'const', 'enum', 'required', 'properties', 'items', 'additionalProperties', 'minLength', 'minimum'])

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
const isType = (v, type) => typeOf(v) === type || (type === 'number' && typeOf(v) === 'integer')

/** Errors of value against schema, as ["path: message"]; [] when it is valid. */
export function check(root, value) {
  const errors = []
  const walk = (schema, v, path) => {
    for (const k of Object.keys(schema)) if (!KNOWN.has(k)) errors.push(`${path}: schema keyword ${k} is not checked`)
    if (schema.$ref) {
      const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1]
      if (!name || !root.$defs?.[name]) { errors.push(`${path}: bad $ref ${schema.$ref}`); return }
      walk(root.$defs[name], v, path)
    }
    if (schema.type && !isType(v, schema.type)) { errors.push(`${path}: not ${schema.type}`); return }
    if ('const' in schema && v !== schema.const) errors.push(`${path}: not ${JSON.stringify(schema.const)}`)
    if (schema.enum && !schema.enum.includes(v)) errors.push(`${path}: not one of ${schema.enum.join(', ')}`)
    if (schema.minLength !== undefined && typeof v === 'string' && v.length < schema.minLength) errors.push(`${path}: too short`)
    if (schema.minimum !== undefined && typeof v === 'number' && v < schema.minimum) errors.push(`${path}: below ${schema.minimum}`)
    if (typeOf(v) === 'object') {
      for (const r of schema.required ?? []) if (!(r in v)) errors.push(`${path}: missing ${r}`)
      for (const [k, x] of Object.entries(v)) {
        if (schema.properties?.[k]) walk(schema.properties[k], x, path + '.' + k)
        else if (schema.additionalProperties === false) errors.push(`${path}: unknown ${k}`)
        else if (typeof schema.additionalProperties === 'object') walk(schema.additionalProperties, x, path + '.' + k)
      }
    }
    if (typeOf(v) === 'array' && schema.items) v.forEach((x, i) => walk(schema.items, x, `${path}[${i}]`))
  }
  walk(root, value, '$')
  return errors
}
