// opensober — deep merge with prototype-pollution refusal.
//
// Used by the loader to layer config files: defaults <- user <- project (left-to-right).
//
// Rules (per Round 2 design + CONTRIBUTING.md):
//   1. Deep merge applies ONLY to plain objects (Object.prototype or null prototype).
//      Arrays, Date, Map, Set, Buffer, RegExp, etc. are replaced wholesale.
//   2. Keys "__proto__", "constructor", "prototype" are REJECTED with a thrown error,
//      not silently skipped. We tell the user the path so they can find it.
//   3. `undefined` overrides are no-ops (lets a layer omit fields without erasing them).
//   4. Even when an override REPLACES (rather than merges), we still scan it for
//      forbidden keys so a polluted leaf can't sneak through.

const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"] as const

export class ConfigMergeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigMergeError"
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function describePath(path: readonly string[]): string {
  return path.length > 0 ? path.join(".") : "<root>"
}

function rejectForbiddenOwnKeys(obj: Record<string, unknown>, path: readonly string[]): void {
  for (const key of FORBIDDEN_KEYS) {
    if (Object.hasOwn(obj, key)) {
      throw new ConfigMergeError(
        `forbidden key "${key}" at ${describePath(path)}: rejected to prevent prototype pollution`,
      )
    }
  }
}

/**
 * Walk `value` recursively, rejecting any forbidden key found in any plain-object node.
 * Arrays are descended into too — a polluted object can hide inside an array element.
 * Other container types (Date, Map, Set, ...) are opaque leaves and not inspected.
 */
function scanForForbiddenKeys(value: unknown, path: readonly string[]): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanForForbiddenKeys(value[i], [...path, `[${i}]`])
    }
    return
  }
  if (!isPlainObject(value)) return
  rejectForbiddenOwnKeys(value, path)
  for (const [k, v] of Object.entries(value)) {
    scanForForbiddenKeys(v, [...path, k])
  }
}

/**
 * Recursively merge `override` into `base`. See module header for the rules.
 *
 * Returns a fresh value at every level — never mutates the inputs.
 */
export function deepMerge(base: unknown, override: unknown, path: readonly string[] = []): unknown {
  if (override === undefined) return base

  if (isPlainObject(base) && isPlainObject(override)) {
    rejectForbiddenOwnKeys(base, path)
    rejectForbiddenOwnKeys(override, path)

    const result: Record<string, unknown> = {}
    const keys = new Set<string>([...Object.keys(base), ...Object.keys(override)])
    for (const key of keys) {
      result[key] = deepMerge(base[key], override[key], [...path, key])
    }
    return result
  }

  // Override replaces base wholesale (different types, or override is a non-plain value).
  // Still scan it so a forbidden key in a replaced subtree can't slip through.
  scanForForbiddenKeys(override, path)
  return override
}
