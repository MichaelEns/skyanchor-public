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

The dependency policy retains raw supplier findings and verifies exact backport,
source-map/metafile and direct-consumer inventories. A nonshipped dependency
alone is not sufficient justification. Unknown advisory/config/source drift
blocks release. Rebinding requires the fixed reviewed lock and installed
consumer inventories; it does not waive security findings.

`pnpm skyanchor:publication` inventories the publication Git tree and independent
linear root history. The owner must additionally scan every reachable new Git
object with private markers held outside this repository. No generic scanner
can establish absolute absence of personal information.
