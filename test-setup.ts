// opensober — bun test preload.
//
// Registered via `bunfig.toml` `[test].preload`. Keep this file minimal:
// global test utilities, never business logic.

// Silence debug logs from the SUT during unit tests unless explicitly enabled.
if (!process.env.OPENSOBER_TEST_VERBOSE) {
  process.env.OPENSOBER_LOG_LEVEL = "warn"
}
