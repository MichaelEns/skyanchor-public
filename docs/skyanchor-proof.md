# Verification

Use `pnpm skyanchor:verify` on the exact clean committed snapshot. Preparation
runs through the owning scripts; do not manually extract or compile translations.
The gate covers formatting, notices, all platform/Worker types, lint, affected
official tests, owning proof tests, pristine supplier compatibility, Worker
build/benchmark/dry-run, static export, browser support, Chromium/WebKit
production proofs and the installed security gate.

Browser tests use synthetic provider accounts and isolated local Worker/D1
fixtures. They preserve exact reading occurrences, continuous post loading,
immediate Back, cancellation, viewport geometry, regional PDS handoff and
contrast expectations. They do not authenticate a real account or claim
physical-device acceptance.

`pnpm skyanchor:e2e --profile-only` runs the complete profile proof against the
existing export after establishing confirmed Following sync. Profile source
movement uses wheel input (Chromium) or synthetic touch around real viewport
movement (WebKit), including travel to the requested row. A wheel hint before
Playwright's passive `scrollIntoViewIfNeeded` does not own that later movement:
the previous fixture could exceed the 250 ms budget before centering.
The retained contrast case deliberately centers passively, proves sharing stays
paused even after subsequent reading input, and requires explicit Resume without
any receiving PUT. From the confirmed baseline, owned reading must automatically
share the exact visible occurrence/offset without Save or Keep mine. Its receipt
records input/capture phases, source CAS revision and save time, request count
matching the D1 clock delta, and unchanged Following local/cloud bytes.

The direct first-use handoff proof has no prior destination revision or sync
consent. Source Save is confirmed against the isolated D1 row before Connect;
Resume is clicked directly from that offer, without Check or injected cookies.
The source anchor is the exact repost/reply occurrence at history position 470.
The unchanged baseline failed that path with the destination still at post 1.
Success requires <=2 px placement, exact persisted local place and unchanged
cloud state. Focus/online events and a newer third-device Save during a held
history request must not overwrite the source. Cancel/pan and unavailable
history must preserve local saved bytes, Return, URL, rows and revision.
The handoff fixture deterministically exercises both post-success indicators:
a real terminal history response yields the exact red bounded-window notice
ahead of an available Return, while an available older cursor (with its next
page held) retains blue Return. Both require confirmed sharing, no sync error,
the exact local occurrence/offset and unchanged cloud row/clock. Closing the
panel must not silently clear the red notice.

The foreground private-GET deadline case first waits for idle, installs a paused
page clock, and triggers focus. Its response latch accepts only the phone's
session cookie and `GET /api/skyanchor/place`, recording method, path and time
without recording the cookie. Check must be disabled while that request is held:
waiting to click it before advancing time would block the fixture itself.
The owned request remains busy at 14,999 ms, aborts with the timeout notice at
15,000 ms, and preserves saved bytes and the full D1 row/clock. Only then is the
hold released and the clock resumed for an explicit, successful Check retry.

The separate automatic-source proof uses a WebKit phone and two fresh desktop
profiles with three distinct synthetic browser IDs. No source Save helper or
injected reading row seeds this path. Actual scrolling before Connect must
become a confirmed automatic checkpoint without another scroll; desktop B
Connect/direct Resume receives that exact checkpoint. Further source scrolling,
concurrent foreground checks and explicit conflict recovery must produce newer
server-confirmed revisions before desktop C first connects and directly resumes.
The receipt records synthetic writer IDs, revisions, anchors and server save
times. Receiving offers and Resume must leave the entire cloud row and clock
unchanged. Offline recovery without new scrolling and regional renewal preserve
the actual source capture; captions distinguish pending, blocked and confirmed
sharing. This proves browser-fixture behavior, not physical background delivery.

The reverse-handoff proof starts with an already persisted older WebKit phone
and a desktop scroll-only automatic source. It checks the actual visible node,
offset, local snapshot, accepted revision, D1 row and global clock. A production
build retaining the original offer guard reproduces the missing Resume button with an equal accepted
revision and an older cached snapshot; that is an explicit backward-compatibility
fixture, not evidence that a real user's cloud row was overwritten.
The regression also covers same-browser last-writer provenance, matching-view
captions, panel/focus/layout, post Back, profile navigation and cold reopen.
Receivers must not PUT during those operations. Intentional rereading of older
content can still produce a new confirmed save; no post-age ordering is used.
Playwright wheel input owns desktop automatic-source movement. Mobile WebKit
does not support Playwright wheel input, so its fixture dispatches a touch
start/end around real window scrolling; this is not physical gesture acceptance.
Programmatic restoration without reading input does not grant sharing intent.

The scroll-input proof adds a controlled WebKit sequence lasting over three
seconds after touchend, with continuing real viewport deltas and no Save. Its
discrete JS steps would each emit native scrollend, so the fixture suppresses
only those events to exercise the quiescence fallback of one continuous run;
this is not physical iPhone inertia acceptance. Unit cases separately assert
native scrollend, timeout, hidden/resize, account/feed and restore cancellation.
An independent Chromium/Edge context removes Playwright's default
`--hide-scrollbars` flag and uses real mouse down/move/up on the visible native
document thumb. Trusted native pointer events, viewport motion, final D1
state/writer/revision/server time and confirmed-shared captions are required.
Following either input sequence, passive programmatic movement and resize must
not PUT, and explicit Resume must still restore the confirmed shared place.
Overlay scrollbars without a measurable DOM gutter remain a conservative
limitation: use a reading wheel, touch, key gesture or explicit Save.

The dependency policy retains raw supplier findings and verifies exact backport,
source-map/metafile and direct-consumer inventories. A nonshipped dependency
alone is not sufficient justification. Unknown advisory/config/source drift
blocks release. Rebinding requires the fixed reviewed lock and installed
consumer inventories; it does not waive security findings.

`pnpm skyanchor:publication` inventories the publication Git tree and independent
linear root history. The owner must additionally scan every reachable new Git
object with private markers held outside this repository. No generic scanner
can establish absolute absence of personal information.

# Device checkpoint acceptance

The normal production browser gate also exercises three independent browser
profiles (phone-sized WebKit and two desktops) with synthetic private names.
It checks three timestamped distinct occurrences, no-write source selection,
an expired frozen choice, exact local-only older-save placement within two
pixels, own-browser history, durable sharing pause through scroll/focus/reload,
explicit fresh-CAS sharing and a cached-save/tombstone race. The focused selector
is `pnpm skyanchor:e2e --device-checkpoints-only`; it does not replace the full
17-stage post-commit gate. Real D1 tests apply versioned migrations, compare
existing row bytes and test rollback tombstones, failed CAS, retention, private
rename/renewal, capacity and whole-transaction failure.

The source-A Keep mine response is held after its actual D1 commit while B
attempts the expired historical restore. The proof attributes every place
request/response to its profile, verifies A's exact submitted state and revision,
and proves B sends no receiving PUT. After releasing A's response, confirmation
requires A's profile ID, visible local state, shared caption, finished requests
and a stable full row/clock across the real debounce/pending-save interval.
The unchanged row/clock assertion uses that confirmed baseline, not an enabled
Save button. Generated production WebKit iPhone and desktop Windows labels are
checked before rename; actual Edge execution remains a separate approved
parent validation, not a spoofed-UA claim.

The complete browser sequence retains earlier Return moderation/deletion
fixtures. Its hidden shared URI
`at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/post19`
previously contaminated the device scenario despite a different signed-in
account: public post records were still shared. Device acceptance now owns a
consistent feed/reply/revalidation URI set under its synthetic scenario author.
The receipt records the original `!hide` flag and the isolated record's actual
revalidation labels. Dedicated context-local hidden and deleted flags reject
the same chosen historical occurrence before successful recovery, preserving
local/Return bytes, URL, history, full cloud row/clock and zero receiving PUTs.
No shared moderation flags are cleared and application moderation is unchanged.
