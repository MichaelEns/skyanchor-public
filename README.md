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

For a first-use handoff, confirm **Save my place** on the source, then sign in
normally in the new browser, open **Reading place** in the same feed, **Connect
private sync**, and directly **Resume other device**. No extra Check is required.
Resume shows cancellable history progress and a visible result after the panel
closes. An unavailable exact occurrence is an error, not a nearby-post success.

The reading icon's red dot means an error, reading notice, or other-device
decision (in that priority); blue means loading, unsynced local progress, new
posts above, or Return available. The panel explains the reason and connection
state. No dot does **not** prove connection or a confirmed cloud save.

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
Neither app use nor local development invokes GitHub Actions. Publishing this
source did not redeploy the live application.
