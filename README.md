# SkyAnchor

A web/PWA adaptation of the full official Bluesky client, based on public
`release1.137.0` (`96262a98f6eb751f50a25625ef4d2a8ac5ede626`).
This independent sanitized snapshot has no private Git parents. Private source
history remains private; it is deliberately not imported or rewritten.

SkyAnchor preserves the official feeds, composer, search, moderation,
notifications, DMs, bookmarks, video and multiaccount interfaces. Following and
profile Posts, Replies and Media retain independent reading occurrences and
within-post offsets. Load new posts without moving your place retrieves the
intervening history through exact overlap, preserving the visible older window.
Immediate Back restores the departure occurrence. Return and explicit remote
Resume confirm placement before consuming checkpoints.

Reading places save locally. Connect private sync opts each account/browser
into debounced saves. Other-device places are offered without moving the view;
Resume other device and Keep mine remain explicit choices. Supported sync
providers include the official regional PDS hosts. Signout clears local
reading data and revokes sync; deleting cloud progress leaves revision
tombstones. Fixtures use synthetic accounts only.

For a first-use handoff, keep the source browser open until Reading place says
**Current local place confirmed shared** (automatic scrolling saves debounce
for 750 ms; **Save my place** also requests a save), then sign in
normally in the new browser, open **Reading place** in the same feed, **Connect
private sync**, and directly **Resume other device**. No extra Check is required.
Resume shows cancellable history progress and a visible result after the panel
closes. An unavailable exact occurrence is an error, not a nearby-post success.
The panel shows the server-confirmed shared-save time and whether it came from
this browser or another browser, not the age of the post. A remote decision
pauses sharing: further scrolling remains local until Resume or Keep mine.
Choose Keep mine only on the browser whose current place you intend to share,
not an old destination merely to clear its red dot. Background saves are best
effort, not a guarantee.

**Source of saved place** defaults to **Latest shared place**. Choose a named
browser profile to see its latest save and two older distinct occurrences for
this feed, including this browser's own saves. Times describe confirmed server
saves, never post age or last device use: a recent save can point to an old post.
Selecting or checking does not move your feed. **Resume saved place** restores
the exact selected occurrence locally, leaving latest shared unchanged and
automatic sharing paused, even after reopening. Explicit **Save my place** or
**Keep mine** is required to share that view; a changed shared revision requires
another decision.

Browsers cannot read your OS machine name. Generated labels describe only a
browser/platform family and a short random profile-ID suffix. Rename this
browser in Reading place; names stay private to the account and renewals do not
replace them. Tabs share a profile ID; separate browser/PWA storage contexts may
not. At most 32 profiles can register per account, without eviction. History is
a rolling three distinct occurrences per profile/feed, not an archive; another
save of the same occurrence replaces its offset/time. Deleted or moderated
posts may be unrecoverable. **Delete cloud progress and disconnect** purges all
profiles' history for the active feed only, retaining the tombstone, names and
other feeds. Signout clears local reading data, not cloud names/history.

When returning to an older phone view, **Check other device** compares the
visible occurrence and offset with the confirmed shared place, not just the
accepted revision or browser label. A difference offers **Resume other device**
(resume the shared place), even at the same revision or when this browser last
saved it. An actual match says **Already at the shared place** and shows the
check time. Passive reload, layout correction and navigation restoration do not
authorize sharing an old local view. Deliberate reading scrolls after an accepted
baseline can still share older posts; there is no newest-post filter.
A cleared shared place preserves local progress and requires an explicit save.
Continuing reading gestures retain sharing intent until scrollend or brief
quiescence. Native scrollbar mouse input requires a measurable document gutter;
for an overlay scrollbar without one, use **Save my place** and wait for
confirmation instead of assuming that drag was shared.
If the desktop's current view is not confirmed shared, it cannot be resumed on
the phone yet: resolve the desktop's displayed decision there, using **Keep mine**
only if that is the view to share.

The reading icon's red dot means an error, reading notice, or other-device
decision (in that priority); blue means loading, unsynced local progress, new
posts above, or Return available. The panel explains the reason and connection
state. No dot does **not** prove connection or a confirmed cloud save.
A successful Resume can still show the red bounded-history notice when current
pagination reaches its end. The panel can truthfully show both a confirmed
shared place and Return available; that notice is not a sync failure.

Install a separately deployed instance through Edge/Chrome's app menu or
Safari's Share > Add to Home Screen. There is no native distribution, web push,
offline whole-feed cache or guaranteed iPhone background sync. Browser WebKit
simulation is not physical-device acceptance.

## Development

Use personal Node 24.22.1 and pnpm 11.28.5. Run `pnpm install --frozen-lockfile
--registry=https://registry.npmjs.org/`, then `pnpm skyanchor:prepare`.
Use the declared lint, typecheck, test, format and build scripts.
`pnpm skyanchor:verify` runs the full source/artifact/security/browser gate.
Generated proof receipts and outputs are ignored, never publication inputs.

See [setup and limits](docs/skyanchor-release.md),
[verification](docs/skyanchor-proof.md), [design boundaries](ASSUMPTIONS.md),
[publication and maintenance](docs/skyanchor-publication.md),
[asset exclusions](ASSETS.md) and [notices](NOTICE.md).
Code retains its MIT license; assets have separate restrictions.
SkyAnchor is not affiliated with or supported by Bluesky Social PBC.

Source is public at [MichaelEns/skyanchor-public](https://github.com/MichaelEns/skyanchor-public).
Required candidate CI and protected automatic merging have been exercised;
guarded upstream maintenance is active. Its automatic scope is only verified
small punctuation/whitespace edits in two existing upstream documentation files,
not application, dependency or security updates. The first maintenance run found
no new stable upstream release; no upstream update has been automatically landed.

`skyanchor-owner-merge.yml` adds a separate owner-dispatched attempt for an
already-reviewed fix PR and exact head, using only the native Actions App token.
It is not automatic review or broader upstream eligibility. Bootstrap and a real
protected-PR acceptance run are required before treating this helper as enabled;
see [publication](docs/skyanchor-publication.md).
Neither app use nor local development invokes GitHub Actions. Publishing this
source did not redeploy the live application.
