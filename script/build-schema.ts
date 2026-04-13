// opensober — emit `dist/opensober.schema.json` from the Zod config schema.
//
// Zod 4 ships native JSON Schema export, so we don't need an extra package: the schema is
// the single source of truth, and this script simply serializes it for editor autocompletion
// and downstream tooling.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { ConfigSchema } from "../src/config/schema"

const DIST = "dist"
const OUT = join(DIST, "opensober.schema.json")

const jsonSchema = z.toJSONSchema(ConfigSchema)

mkdirSync(DIST, { recursive: true })
writeFileSync(OUT, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8")
console.log(`wrote ${OUT}`)
