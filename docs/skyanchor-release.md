# Setup, deployment and limits

Use pinned personal Node 24.22.1 and pnpm 11.28.5 with the public npm registry.
Restore the frozen lock and run the declared `skyanchor:prepare`, format,
lint, types and proof scripts. The full `skyanchor:verify` command must run on
the exact committed clean source before release. Its ignored report binds
HEAD, source inputs and every command outcome to the actual build.

`worker/wrangler.jsonc` contains a reserved example origin and a synthetic
database placeholder, and omits the account identifier. Local dry-run is
supported. For an explicitly authorized deployment, make an ignored
`worker/wrangler.local.jsonc`, configure the owner's own origin/account/database,
and review it locally. Never commit it, credentials, saved sessions or DB exports.
There is no CI deployment. No deployment, migration or real-account acceptance
is implied by this source snapshot. Do not replay migrations on existing data.
The public source and guarded maintenance setup have been accepted; that work
did not redeploy the live application or change its saved data. Public support
uses same-origin pages and repository Issues, not a personal mailbox or namespace.

Keep the Free configuration: no CPU limit override, paid binding, observability
or remote sandbox. Assets own SPA fallback; API requests run the Worker first.
The three bounded public configuration/geolocation routes are not a general
proxy. Private sync is same-origin and explicitly opt-in. Cloud availability
does not guarantee background saves.

Release validation includes synthetic real-local D1 tests, all supplier
compatibility tests, continuous-history/Back/viewport/browser proofs, asset and
license checks, strict dependency-use evidence and a fresh raw audit.
Generated reports are local only. Physical iPhone, installed-browser and hosted
acceptance are separate owner responsibilities and are not claimed.

Web startup bounds uncached geolocation to 3 seconds and session resume to
10 seconds. A failed resume offers Retry without clearing credentials or the
saved window.
Definitive SDK refresh-token rejection instead offers **Sign in again**, opening
the normal login form for the saved account. Cancel returns to recovery without
clearing credentials or reading data; only successful sign-in replaces tokens.
Network failures, timeouts and temporary service errors retain bounded Retry.
Optional age-assurance prefetch no longer gates web resume;
mounted queries retain their fail-closed loading/error behavior and bound their
requests to 8 seconds. On web, an unknown country caps age-assurance access at
Safe, even with cached adult metadata or assured/full server state. Minimum-age
denials, blocked state and account-data errors remain more restrictive; neither
adult content nor chat is enabled by the unknown-region fallback. Normally
cached known-country and native behavior are unchanged. Geolocation remains
unknown, with a visible status and retry on connectivity return; confirmed
geolocation restores normal regional evaluation. A 15-second HTML watchdog also
covers missing entry/language chunks before React recovery can render. Its minimal English
fallback is marked `lang="en"`; normal recovery UI uses Lingui.

Foreground/pageshow checks reconcile elapsed request deadlines and the splash
fade. Successful startup removes the watchdog; it never reloads an active app.
Only explicit Retry reloads for a pre-React failure. Existing storage and the
service worker are not reset. This is not a full offline shell: an uncached
critical script or an unavailable authentication server can still prevent the
feed from opening, but must show an honest recovery screen instead of an
indefinite anchor. Browser fixtures emulate phone-sized WebKit, not physical
iOS process eviction or installation.
