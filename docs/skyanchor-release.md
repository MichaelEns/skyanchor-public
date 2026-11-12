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

For browser checkpoints, the owner must apply the additive versioned
`0003_device_checkpoints.sql` once, after 0001/0002, deploy the new Worker API
first, then update the frontend. This local work performs none of those hosted
operations. Legacy `{device[, service]}` sessions and unnamed place writes
remain supported. Rolling retention is three distinct occurrence anchors per
browser profile/feed; repeat saves update that anchor's checkpoint, not a
complete archive. Registration stops explicitly at 32 profiles without eviction.
Device names are private, replaceable profile labels, not OS machine names.
Latest shared stays the default; saved-place recovery is local-only until
explicit sharing and never decreases a CAS revision. Timestamps are save times,
not post ages or last use. Active-feed deletion removes every profile's history
for that feed, retaining names, other feeds and revision tombstones.

Rollback is code-only: leave additive tables and tombstone triggers installed.
The prior Worker continues legacy sync and deletion, but cannot record/list
history; roll the frontend back too. Never drop data or reset the clock as a
rollback. The migration/atomicity fixture verifies exact existing place,
session, nonce and clock bytes and old-Worker tombstone cleanup.

Release validation includes synthetic real-local D1 tests, all supplier
compatibility tests, continuous-history/Back/viewport/browser proofs, asset and
license checks, strict dependency-use evidence and a fresh raw audit.
Generated reports are local only. Physical iPhone, installed-browser and hosted
acceptance are separate owner responsibilities and are not claimed.

First-use reading-place acceptance must use a fresh destination browser and
the literal sign-in -> Reading place -> Connect -> Resume path, without an
intervening Check. Wait for the source's confirmed-shared caption and use the same Following
feed or profile/filter. The production fixture now uses occurrence 470 with
repost/reply context, beyond the former 360-entry cutoff, in desktop Chromium
and phone-sized WebKit. It also checks a newer source revision arriving during
Resume, foreground checks, cancellation, visible errors and unchanged saved
bytes. These synthetic proofs cannot establish whether a real service still
retains a user's historical occurrence.
An additional two-epoch proof starts with actual phone scrolling before Connect,
then uses only automatic source saves to hand off to two fresh desktop profiles.
It covers pending scrolling across foreground checks, an intentional remote
conflict that visibly pauses the phone, an explicit source-phone Keep mine,
offline recovery without another scroll, and regional session renewal.
The panel's last-shared time is the server save time, not post creation time;
Connected alone does not establish that the current phone position was shared.

The compact reading icon is not the Bluesky stored-bookmarks feature. Its
panel labels connection, remote decisions, unsynced progress and errors
separately. Red prioritizes errors, reading notices, then remote decisions;
blue prioritizes loading, unsynced progress, new posts, then Return. A quiet
connected or disconnected browser can have no dot. Resume progress and its
result remain visible outside the closed panel; errors persist with a retry
entrypoint. Scrolling starts only in the dialog's completed close callback.
Recovery limits and exact-identity failure behavior are documented in
`ASSUMPTIONS.md`; private sync being connected is not itself a confirmed save.

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
