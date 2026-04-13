// opensober — emit `dist/opensober.schema.json` from the Zod config schema.
//
// Runs as the final step of `bun run build`. Once the config schema lands
// under `src/config/`, this script will import it and serialize via
// zod-to-json-schema. For now it emits a placeholder so the pipeline works.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIST = "dist"
const OUT = join(DIST, "opensober.schema.json")

const placeholder = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "opensober",
  description:
    "Placeholder schema. The real schema is generated from src/config once the Zod definitions land.",
  type: "object",
  properties: {},
  additionalProperties: true,
}

mkdirSync(DIST, { recursive: true })
writeFileSync(OUT, `${JSON.stringify(placeholder, null, 2)}\n`, "utf8")
console.log(`wrote ${OUT}`)
