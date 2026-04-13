// opensober — Hashline Edit barrel.
//
// Exposes the algorithm-layer surface: hash function, file-meta helpers, the
// annotate function for read-time output, and applyEdits for write-time
// validation + atomic batch application. Tool registration (turning these into
// an opencode ToolDefinition) lands in a later round.

export { type AnnotatedRead, annotate } from "./annotate"
export {
  applyEdits,
  type EditInstruction,
  EditOverlapError,
  EditRangeError,
  HashMismatchError,
} from "./apply"
export {
  type FileMetadata,
  type ParsedFile,
  parseFile,
  reconstructFile,
} from "./file-meta"
export { computeLineHash, type HashAlgorithm } from "./hash"
