/**
 * DSH Reply Reader (dsh-reply-reader) — host half type declarations.
 *
 * The reading itself is browser-side. The host half only reports the loaded
 * version, the npm update channel, and the install state through four read-only
 * routes under `/read-aloud` (see lib/index.js).
 *
 * NOTE: change a route payload in lib/index.js and update the matching interface
 * here in the same edit — smoke tests check the manifest, not the payload shape.
 */

/** Outcome of the last upgrade attempt. */
export interface ReplyReaderUpgrade {
  running: boolean
  /**
   * - `ok`     upgraded from the registry; restart `dsh web`
   * - `local`  link/file install: online upgrade refused on purpose
   * - `skip`   already latest, or nothing published yet
   * - `stale`  disk is newer than the running process; restart instead
   * - `fail`   installer failed
   * - `null`   no attempt yet
   */
  ok: 'ok' | 'local' | 'skip' | 'stale' | 'fail' | null
  message: string
}

/** `GET /read-aloud/meta`, and the body of both POST routes. */
export interface ReplyReaderMeta {
  /** Package name. */
  name: string
  /** Version of the code this process loaded. */
  version: string
  /** Version currently on disk (may differ after an in-place upgrade). */
  installedVersion: string
  /** True when the disk version is newer and a restart is required. */
  stale: boolean
  /** Latest published version, or null when unknown/offline/disabled. */
  latest: string | null
  /** Whether a registry check has completed at least once. */
  updateChecked: boolean
  /** True when `latest` is newer than `version`. */
  updateAvailable: boolean
  upgrade: ReplyReaderUpgrade
  /** The local dependency spec (`link:`/`file:`/…), or null for a registry install. */
  localInstall: string | null
  /** True when DSH_REPLY_READER_NO_UPDATE_CHECK disabled registry checks. */
  updateDisabled: boolean
}

/** `GET /read-aloud/hello` */
export interface ReplyReaderHello {
  ok: true
  name: string
  version: string
  installedVersion: string
  stale: boolean
}

/** Package name exported for tooling and the bundle patch. */
export declare const name: 'dsh-reply-reader'
/** Services the host half requires: periodic checks and the HTTP carrier. */
export declare const inject: readonly ['timer', 'webServer']
/** Cordis plugin entry: registers `/read-aloud` and starts the update checks. */
export declare function apply(ctx: unknown): void
