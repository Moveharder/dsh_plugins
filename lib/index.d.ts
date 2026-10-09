/**
 * dsh-pocket-ui — host half type declarations.
 *
 * The mobile adaptation itself is browser-side (`lib/client.js`); this half only
 * publishes the version/upgrade surface the settings row talks to. The
 * interfaces below therefore describe the **HTTP payloads** — that is the real
 * contract between the two halves, and it is what a consumer (or a future
 * TypeScript client) needs to be able to rely on.
 *
 * Kept in sync with `metaPayload()` and the route table in `lib/index.js`; the
 * smoke suite asserts the routes and the manifest, but nothing can assert that
 * these types still match the code — so change them together.
 */

/** `GET /pocket/hello` — liveness + version. */
export interface PocketHello {
  ok: true
  name: string
  /** Read from this package's own package.json, never hard-coded. */
  version: string
}

/** Why the upgrade path ended where it did. */
export type PocketUpgradeStatus =
  /** Nothing to do: a local (link/file/tarball) install. */
  | 'local'
  /** Nothing to do: already current, or no version information. */
  | 'skip'
  /** Installed successfully; a `dsh web` restart is required to apply it. */
  | 'ok'
  /** The install command failed. `message` carries the reason. */
  | 'fail'

/** In-flight / last upgrade attempt, as reported by `/pocket/meta`. */
export interface PocketUpgradeState {
  running: boolean
  /** `null` until the first attempt. */
  ok: PocketUpgradeStatus | null
  message: string
}

/** `/pocket/meta` and `POST /pocket/check-update` response body. */
export interface PocketMeta {
  name: string
  /** Installed version, read from package.json. */
  version: string
  /** Latest published version, or `null` if never looked up / lookup failed. */
  latest: string | null
  updateChecked: boolean
  updateAvailable: boolean
  upgrade: PocketUpgradeState
  /**
   * The dependency spec when this is a local install (`link:`, `file:`,
   * `workspace:`, a relative path or a `.tgz`), otherwise `null`. Non-null means
   * the upgrade path refuses, so the user's checkout is never overwritten.
   */
  localInstall: string | null
  /**
   * Where the host half believes this copy is installed. Published because
   * "the upgrade path declined nothing" is only diagnosable together with the
   * root it looked at.
   */
  profileRoot: string | null
  /** `DSH_POCKET_NO_UPDATE_CHECK=1` was set. */
  updateDisabled: boolean
  /**
   * Why the last registry lookup produced nothing. An empty `latest` has two
   * very different causes — "you are current" and "the registry was never
   * reached" — and the UI has to tell them apart.
   */
  updateError: string
  /** Registry bases tried, in order. */
  registries: string[]
}

/** `POST /pocket/upgrade` response body — meta plus the install log tail. */
export interface PocketUpgradeResponse extends PocketMeta {
  upgrade: PocketUpgradeState & { log: string }
}

/** Plugin id (bundle id). */
export declare const name: 'dsh-pocket-ui'
/** Required service: routes may only be registered once webStartup is ready. */
export declare const inject: readonly ['webServer']
/** Cordis plugin entry. */
export declare function apply(ctx: unknown): void
