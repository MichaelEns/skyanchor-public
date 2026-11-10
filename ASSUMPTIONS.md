# SkyAnchor boundaries

This is a new sanitized source snapshot of a customized official client, not
an export of personal accounts or private development history. Public upstream
provenance is recorded in `scripts/skyanchor/upstream-provenance.json`.

Reading protocol, schema and application behavior are retained. Occurrence
identity includes repost and reply context, not URI alone. Local persistence is
bounded to 90 entries/1 MiB. New-history retrieval is bounded to 300 requests,
16 MiB and 90 seconds, yields every five pages, verifies moving heads and
requires three consecutive exact overlaps (or the entire smaller window).
Cancellation or incomplete history leaves the original window unchanged.

Private sync uses same-origin secure cookies, server-verified provider identity,
CSRF checks and D1 compare-and-swap revisions. Remote offers do not move the
viewport automatically. Profile places are bounded to 64 per owner, in addition
to Following; tombstones count toward the bound.

Telemetry delivery, remote experiment initialization and automatic update
delivery are disabled for the web export. Necessary provider API, media,
moderation and age-assurance requests remain. No production mock switch exists.

Only the static web/PWA export and its independently configured Worker are
supported distribution surfaces. Native signing/push and upstream Go/container
projects are retained source, not approved releases. Licensed notices must
remain. Restricted commissioned assets must not return through upstream updates.

Supplier advisories are not an audit-zero claim. The Zod backport and exact
build/native usage assessments require current installed-source evidence,
unchanged consumer inventories and fresh full release validation. Unknown
findings or drift fail closed. Regex publication scanning is only one review
layer, not proof of absence of private data.
