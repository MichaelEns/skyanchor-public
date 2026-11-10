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
