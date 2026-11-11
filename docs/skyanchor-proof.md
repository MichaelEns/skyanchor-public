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
