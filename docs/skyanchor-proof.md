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

`pnpm skyanchor:e2e --thread-back-only` runs the production thread-return
regression in desktop Chromium and phone-sized WebKit. It uses native card-body
click/tap, timestamp and keyboard activation, nested browser history POP and the
app Back button. Each return checks the first visible occurrence and its
header-relative offset within two pixels. Continued viewport movement without
a new touchstart models momentum after a browser-owned swipe; it must update
the local checkpoint, and late row growth must preserve that newer viewport.
This is controlled browser coverage, not a physical iPhone swipe test.
Confirmed synthetic cloud row/clock, Return/history bytes and private write
counts must remain unchanged during navigation and passive restoration. Setup
explicitly confirms sharing between visits; the regression does not grant
sharing intent to passive movement or bypass remote/history restore pauses.
Its isolated post/reply URIs cannot inherit the full runner's earlier shared
moderation/deletion flags; those original fixtures remain unchanged.
Its synthetic account IDs are also distinct from the automatic-source and
reverse-handoff proofs. Reusing those IDs let an earlier scenario's cloud row
turn the navigation-only setup Save into a CAS conflict in the full runner.
Setup now asserts there is no inherited cloud row; all confirmation, conflict,
Back, continued-reading and no-write assertions remain intact.

On the unchanged production artifact, the first card/Back restored correctly
but subsequent movement failed the local-autosave assertion. The hook's passive
lifetime cleanup cancelled the correction RAF newly scheduled by reactivation's
layout effect, leaving `correcting` stuck. Its old desired anchor could then
win again on resize/layout. Lifetime teardown now runs in the layout phase,
before the new correction is scheduled. Hook proofs model dependency cleanup
and actual RAF cancellation, including retained/remounted entries, an older
durable checkpoint, cancelled departures, stale epochs and account/feed/entry
isolation. Cancelled/new-tab native activations must not capture a departure;
resumed reading invalidates any abandoned departure, and an unavailable
semantic correction cannot suppress the route's pixel fallback.

The recurrence investigation found two additional failures on the unchanged
PR11 production export, distinct from that correction-lifetime repair. A real
viewport-height resize between a scroll event and its queued capture cleared
the pan guard and corrected against the previous desired place. Phone-sized
WebKit rewound 61 px; Chromium returned to the previous occurrence. Also,
departure cancelled the queued capture while keeping its snapshot only in the
in-memory entry map. Reloading in the thread discarded that map; cold Back
restored the older durable offset (61 px wrong in WebKit).

The same focused selector and default browser gate now hold capture RAFs around
real document scrolling, resize the actual viewport, and navigate to a thread,
reload it and return cold. They assert exact occurrence/header-relative offset
within two pixels, the pending durable local place, unchanged cloud row/clock
and Return/history/historical-pause bytes, and no progress writes. Cold document
restart loses the in-memory sync session/CSRF, so that phase must make exactly
one successful existing session-renewal POST and no other private write. Ordinary
navigation retains the original zero-private-write assertion. Existing native tap, keyboard,
cancel/new-tab, repeated Back, continued-reading and late-layout assertions stay
in place. The cold-departure race activates a visible DOM link while RAFs are
held; it is not a physical touch/swipe or OS process-eviction test.

Resize and departure now flush only an already-pending capture before correction
or freezing the source. The flush is local and non-intentional, uses the existing
window persistence and account/feed/epoch guards, and does not unconditionally
save on navigation, alter Return, or authorize cloud sharing. Completed RAFs
clear their pending marker so later layout-only resizes still correct normally.
Hook regressions cover passive/owned pending capture, subsequent reading and
late layout, plus durable cold restoration. These controlled reproductions do
not identify the reported phone event or establish the phone's running build;
the served release alone cannot establish that.

`pnpm skyanchor:e2e --settlement-only` reproduces the later phone report's exact
"Reading restore did not settle" failure on the unchanged production hook.
It creates a real Save with a half-CSS-pixel layout transform, removes that
transform, then selects this same WebKit browser's saved checkpoint and also
resumes the shared checkpoint from a second browser profile. Both old paths
reach the correct occurrence but retain a 0.5 px residual, away from either
scroll boundary. WebKit's whole-CSS-pixel scrolling cannot meet the old 0.25 px
criterion; repeated corrective scrolls exhaust 60 attempts and trigger the
existing explicit rollback. This controlled fractional-layout reproduction
matches the supplied error text, not proof of the physical phone's geometry,
running release, or exact cause.

Correction and settlement now share a one-CSS-pixel browser-precision tolerance,
still below the two-pixel acceptance bound. Exact occurrence identity, three
consecutive measured frames, the 60-attempt bound, cancellation and rollback
remain required; the original requested offset is persisted unchanged. This
does not accept a missing occurrence or retry indefinitely. Unit proofs cover
several fractional offsets under quantized scrolling and an unreachable 1.5 px
clamped residual that must still fail explicitly without saving.

The focused selector is included in the default browser gate. It compares
cloud place, clock and device-history bytes before/after both receiving paths,
checks the exact persisted checkpoint and <=2 px geometry through late row
growth, then proves own-history continued reading and foreground/resize keep
the durable historical sharing pause without cloud writes. Bounded synthetic
failure output records target offset, sampled anchor/header/scroll geometry,
scroll maximum and visual viewport, with no account credentials. Other default
proofs retain pruned/deleted/moderated saves, before/after frozen-selection
revalidation, cancelled recovery, fresh-CAS sharing and account/feed isolation.

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

`pnpm skyanchor:e2e --sync-recovery-only` adds two production WebKit regressions.
A synthetic old automatic `Browser-*` registry name and still-valid connected
session previously survived Check saved places unchanged: only session POST
upgraded the name, while ordinary device GET and session reuse did not. Check
now performs one authenticated renewal and rereads devices when this browser's
automatic name differs from its detected family. Custom names remain untouched;
no schema or device/history reset is involved.

A held initial session response times out at the existing deadline. On unchanged
source, subsequent focus/visibility/pageshow events sent no new request because
disconnected recovery listened only for online. Consented, enabled foreground
recovery now retries once per event burst, coalescing an in-flight renewal.
Connected foreground checks do not overlap each other, but may supersede an
older explicit/initial check so a held stale response cannot erase a fresh
remote offer. Failure stays
explicit; there is no timer retry loop, auto-Resume or new sharing intent.
The proof preserves local/Return/history/revision bytes, shared rows and clock
through recovery and automatic name upgrade. Its timeout is a controlled held
response, not evidence about the physical iPhone's network or prior timeout.
After release, open Reading place and retry Check other device if connected,
or Reconnect private sync if needed; Check saved places refreshes automatic
names. Keep custom names and stored/sign-in state. Resolve a differing shared
place explicitly with Resume other device or Keep mine on the intended source.

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

The newer-content proof uses trusted Home input, not a fixed toolbar's
visibility, to establish the actual first post and its local checkpoint before
Refresh. A controlled passive scroll/resize reproduces the old 22669 px
correction before any Refresh action, without changing the cloud row/clock.
Owned input now ends a pending correction frame while retaining the
corrected-scroll-position guard: a corrective event alone still cannot become
reading intent. Hook coverage exercises wheel, Home and touch before RAF.

`pnpm skyanchor:e2e --new-content-only` owns the focused production regression.
Both engines hold only the disposable page's JavaScript RAF callbacks during
trusted Home, prove the actual top differs from the still-stale local
checkpoint, then activate Refresh before capture. No-new and fresh-head
integration retain that exact visible occurrence within two pixels; fresh
prefix ordering is checked separately. The real Home autosave is confirmed
while the head response is held, establishing a full row/clock baseline before
integration. Subsequent discovery at the current top must not move or write.
The complete browser runner retains all preceding moderation, device history,
handoff, reverse, momentum and continuous-history cases. WebKit keyboard
coverage is not physical iPhone touch acceptance.

The protected recurring-position candidate subsequently failed the immediate
fresh-head prefix assertion: its "integrated" sample still contained the old
rows, while the later trace contained the new head and layout correction.
Absence of the reading button's loading label is not a committed-window
milestone: higher-priority notices can hide loading, and clearing loading state
does not await React Query's separately scheduled observer publication.
`flushSync(setQueryData)` does not synchronously drain those scheduled callbacks.

The fresh-head fixture now holds zero-delay timers around response release,
retaining RAF and nonzero timers, to exercise delayed observer publication.
The old oracle with that hold reproduced the same old-prefix failure locally.
The hold is released in `finally`; the proof then requires the exact two-row
committed DOM prefix before taking its integration geometry sample. A bounded
per-frame original-anchor sampler spans release through that sample, so waiting
cannot hide a painted layout jump. Both the original final <=2 px assertion and
the new per-frame <=2 px assertion, exact prefix/order, real Home autosave,
cloud row/clock, cancellation and pending-history checks remain required.
Receipts include the prefix seen at the old label milestone (which may already
be committed), final geometry and all frame samples. This is a fixture-only
publication-oracle correction, not another app fix or proof that hosted CI will
pass; the updated exact candidate still requires its protected hosted run.

Two later acceptance failures exposed missing frame boundaries in this fixture.
Installed Edge entered the passive-top/resize case with a prior source capture
still pending. Resize correctly flushed that pending capture at the new viewport,
rather than exercising the intended no-pending correction branch. Scheduling a
source scroll capture immediately before the old passive-top probe reproduced
its exact `after.y > 2` failure locally. Setup now drains that source capture
through two actual RAF boundaries, then advances the disposable clock past the
250 ms intent guard before recording its baseline. The original positive-scroll,
<=2 px old-position, unchanged-local and unchanged-cloud assertions remain.
The separate pending-capture resize/Back proofs continue to own the other branch.

The next protected run reached immediate no-new completion before the sampler
had collected two RAF callbacks. Registering a callback is not evidence that
it ran, and a no-op response must not require a minimum loading duration.
The sampler now resolves its arming promise only after its first actual sample,
before releasing the held response. After completion (and exact fresh-prefix
publication when applicable), two actual RAF boundaries precede the final sample.
The receipt records the pre-release sample count; `samples.length > 1` and all
per-frame/final <=2 px assertions remain unchanged. No product delay, longer
timeout, alternative expected outcome, or product-source change is involved.
The combined correction passed focused Chromium, installed Edge 157 and
phone-sized WebKit; protected hosted acceptance remains separately required.

The immediate-input phase pauses only its disposable page's simulated clock
before Home. Cross-process fixture work while RAF is deliberately held must not
consume the 250 ms input-ownership budget. It runs one millisecond for the
dialog-close callback, sixteen for released RAF, and one second for the real
750 ms save debounce/one-second retry interval, then resumes the clock. The
receipt requires an intentional Home capture, an actual successful source PUT
and matching response/D1 state, revision and device before releasing the head.
The original running-clock failure was reproduced locally as a passive capture
and an explicit sharing decision, not a missing debounce or wrong-state PUT.
This controlled phase does not establish that the exact hosted scheduling cause
is resolved; the new HEAD still requires its real hosted check. Failures print
bounded synthetic phase, clock, input/capture, private-request status and UI
evidence, omitting cookie values, authorization and session/CSRF material.

The handoff double-activation case waits for the Resume button to be enabled
before its two native DOM clicks. The receipt records whether it was initially
disabled while Check metadata settled; native `.click()` would otherwise
silently do nothing. Exactly one recovery head request and unchanged cloud
progress are still required.

Deep handoff pagination uses trusted desktop mouse-wheel input for every successive
page, not passive `scrollTo(bottom)`. The pre-input last row key is frozen;
that same row must reach or pass the viewport bottom, scrolling must advance,
and real rows beyond that boundary must be served and appended within the
original timeout. The receipt includes geometry and served cursor offsets through
post470, without inserting fixture pages into application state.
A controlled resize at exactly 180 rows demonstrates how passive movement
can return to the captured row before pagination is triggered. This establishes
the failure mechanism, not the exact natural event order of the parent's Edge
failure, which was not reproduced in the initial Chromium trace. Bounded failure
output retains viewport/max-scroll/header/footer geometry, correction events,
actual cursor HTTP statuses and existing error checks.
Before each wheel gesture, the proof selects source tab A with `bringToFront`,
blurs the prior control without scrolling, requires document focus, and places
the pointer over the feed. One real wheel gesture covers the remaining current
page distance. Geometry and trusted wheel
receipts retain focus, target tag/role, platform and default-prevention state,
never input values. The parent's focused Edge run still observed trusted,
unprevented End keydown/keyup without scrolling or the next cursor request at
150 rows. Focus was therefore not established as the cause. That native Edge
End interaction remains unresolved; pagination setup no longer depends on it.
Separate Home keyboard and input-intent coverage remains unchanged.
The parent's Edge wheel trace proved a setup-oracle race: the old last row240
reached the viewport, then real responses at offsets240/270 appended through
row300 before polling examined the DOM's new last row. Setup therefore does not
hold a guessed cursor based on rendered count or require a transient spinner.
It accepts fast completed pagination against the frozen target and actual
served data. Explicit pending-response coverage elsewhere remains unchanged.
