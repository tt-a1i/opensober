// opensober — inject server auth into the opencode SDK client.
//
// When opencode runs behind HTTP basic auth (OPENCODE_SERVER_PASSWORD env), the
// client passed via PluginInput does NOT carry the credential automatically. We
// inject it ourselves before any client.session.* call.
//
// This is a "small defensive" implementation: it tries the current SDK 1.4.x
// path first (setConfig headers), then 1-2 fallbacks for future SDK shapes, and
// finally warns (but doesn't crash) if none work.
//
// We intentionally do NOT replicate oh-my-opencode's full 5-fallback matrix.
// Our peer dep is ^1.4.0; we add just enough fallback to survive one minor bump.

type AnyRecord = Record<string, unknown>

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null
}

function getInternalClient(client: unknown): AnyRecord | null {
  if (!isRecord(client)) return null
  const internal = client._client
  return isRecord(internal) ? internal : null
}

function trySetConfigHeaders(internal: AnyRecord, auth: string): boolean {
  const setConfig = internal.setConfig
  if (typeof setConfig !== "function") return false
  setConfig({ headers: { Authorization: auth } })
  return true
}

function tryInterceptors(internal: AnyRecord, auth: string): boolean {
  const interceptors = internal.interceptors
  if (!isRecord(interceptors)) return false
  const request = interceptors.request
  if (!isRecord(request)) return false
  const use = request.use
  if (typeof use !== "function") return false
  use((req: Request): Request => {
    if (!req.headers.get("Authorization")) {
      req.headers.set("Authorization", auth)
    }
    return req
  })
  return true
}

function tryFetchWrapper(internal: AnyRecord, auth: string): boolean {
  const getConfig = internal.getConfig
  const setConfig = internal.setConfig
  if (typeof getConfig !== "function" || typeof setConfig !== "function") return false
  const config = getConfig()
  if (!isRecord(config)) return false
  const baseFetch = config.fetch
  if (typeof baseFetch !== "function") return false
  setConfig({
    fetch: async (request: Request): Promise<Response> => {
      const headers = new Headers(request.headers)
      headers.set("Authorization", auth)
      return (baseFetch as (r: Request) => Promise<Response>)(new Request(request, { headers }))
    },
  })
  return true
}

/**
 * Inject HTTP Basic Auth into the opencode SDK client if OPENCODE_SERVER_PASSWORD
 * is set. No-op otherwise. Tries 3 injection paths in order; warns on total failure.
 */
export function injectServerAuth(client: unknown): void {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return

  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  const auth = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`

  const internal = getInternalClient(client)
  if (internal) {
    if (trySetConfigHeaders(internal, auth)) return
    if (tryInterceptors(internal, auth)) return
    if (tryFetchWrapper(internal, auth)) return
  }

  console.warn(
    "[opensober] OPENCODE_SERVER_PASSWORD is set but server auth could not be injected " +
      "into the SDK client. Session API calls may 401 against a password-protected server.",
  )
}
