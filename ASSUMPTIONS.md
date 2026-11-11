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
Local captures and deliberate reading scrolls are tracked before connection.
After a successful initial check with no shared place, a pending deliberate
scroll is automatically saved even without another scroll. Checks suspend
writes, retain pending captures and reschedule
the 750 ms debounce only after reconciliation; superseded read completions
cannot clear a newer offer or re-enable saving. Checks wait for an in-flight
write before observing its revision. A differing shared place requires an
explicit decision regardless of accepted revision or last-writer browser,
unless deliberate movement is pending against the unchanged accepted baseline.
Revision is a CAS base, not evidence that a restored local viewport matches.
Only actual occurrence/offset agreement permits the already-here caption.
Passive captures, cold restores, layout and navigation do not authorize writes.
Reading-input ownership continues while scroll events remain contiguous, ending
at native scrollend or 250 ms quiescence. Held touch/native scrollbar contacts
have a 30-second inactivity bound. Hidden/blurred views, account/feed changes,
explicit preservation and restoration cancel ownership. Native scrollbar mouse
input is recognized only in measurable document gutters, including left-side
and horizontal gutters; overlay/browser-reserved edges are not guessed.
Tombstones preserve the local place and require explicit Save/Keep mine.
Confirmed adoption discards only this route entry's obsolete departure, not
the intentional Return checkpoint. Errors and paused source sharing are visible separately
from connection status. Shared timestamps come only from the server's `updated`
value; browser origin labels do not identify a physical device.

Explicit remote Resume searches current Following/profile API history rather
than reconstructing a repost from its URI. Recovery permits 296 history pages
of at most 30 entries, reserves four current-post/reply revalidation requests,
and bounds the total to 16 MiB (conservative UTF-16 accounting) and 90 seconds.
Exhaustion, repeated cursors, oversized responses, deletion, moderation,
timeout or cancellation fail explicitly without accepting a remote revision.
Only the recovered page becomes the reading window, retaining its real API
cursor; this does not assert that older/newer gaps have been loaded.
Existing Return and the original local window are not consumed by a failed
Resume. Successful exact placement must settle and persist locally before
revision acceptance. Resume does not upload the fetched place; a fresh remote
check gates subsequent automatic saves, preserving newer source revisions.
Private sync requests/session exchange have 15-second network deadlines;
the complete connect/renew operation has a 20-second deadline.
Foreground web SDK token renewal (including regional accounts first signed in
in this browser) also bounds its owning request and response body to 15 seconds.
This is separate from the already-merged cold-start recovery.

Telemetry delivery, remote experiment initialization and automatic update
delivery are disabled for the web export. Necessary provider API, media,
moderation and age-assurance requests remain. No production mock switch exists.
Cold-start recovery preserves saved accounts and reading windows; it does not
provide an uncached offline feed or bypass regional/age restrictions. A suspended
Home Screen app may cold-start rather than resume its old JavaScript process.

Only the static web/PWA export and its independently configured Worker are
supported distribution surfaces. Native signing/push and upstream Go/container
projects are retained source, not approved releases. Licensed notices must
remain. Restricted commissioned assets must not return through upstream updates.

Supplier advisories are not an audit-zero claim. The Zod backport and exact
build/native usage assessments require current installed-source evidence,
unchanged consumer inventories and fresh full release validation. Unknown
findings or drift fail closed. Regex publication scanning is only one review
layer, not proof of absence of private data.
