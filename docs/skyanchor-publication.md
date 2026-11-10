# Publication and upstream maintenance

## Status and owner prerequisites

This tree is prepared locally, not a public repository or an enabled service.
Never push the private repository, a private commit, bundle, object database or
release ledger. The first public commit must be a clean, parentless sanitized
snapshot with the owner's GitHub no-reply author and committer. Keep the private
repository and its history unchanged. Preserve MIT, ASSETS, NOTICE and supplier
licenses. The upstream pin is public provenance, not a private merge base.
The official remote tag is `1.137.0` (release name `release1.137.0`); the pin
is validated against the real public tag rather than inferring a tag name.

Publication and activation are **blocked** until the owner verifies an effective
personal no-paid-usage policy. Net usage of $0 and billing endpoint 404 responses
are not evidence of an enforced stop. In personal GitHub Settings > Billing >
Budgets and alerts, set an Actions product budget of $0 and enable **Stop usage
when budget limit is reached**. If GitHub cannot enforce that configuration,
leave publication/activation blocked. Do not buy a plan, runner or storage.
Retain verifiable evidence outside source; a sanitized public owner-reviewed
issue may attest to the verified configuration without exposing billing data.

The owner verified an account-wide $0 Actions budget with Stop usage enabled
after a settings-page reload at setup. Private verification evidence remains
outside source. This is an owner attestation, not an API-verified billing claim.
Public visibility, protection and actual protected-merge acceptance are still
parent-only prerequisites; this source does not claim they are configured.

Before any push, independently review every reachable new Git object with
private markers held outside this repository. Run the publication inventory,
asset/license/privacy gates, Zizmor, normal hooks and the complete post-commit
gate. Review `git archive` and package contents too. Generated receipts, screenshots,
sessions, databases, archives and tooling must not be in the publication tree.
Generic regex scanning is not a guarantee of absolute safety.

The normal Husky hook is unchanged. Its staged Oxlint matcher covers `src` and
`modules`, exactly the declared app lint roots; full app lint and platform types
remain release requirements. Retained standalone projects and native/legacy
tooling have independent dependency/type environments, not the app's type-aware
lint context. The initial snapshot therefore does not type-lint those unrelated
projects with the app configuration. Existing formatter and SVGO hooks still
run normally; any mechanical import formatting or SVG normalization from the
initial full-tree commit is recorded separately in the local publication review.
Owning automation/security script tests and the complete release gate remain
mandatory; this matcher does not exempt them from their declared verification.

The parent alone creates/configures `MichaelEns/skyanchor-public` after review
and verified zero-spend policy. Use standard public Windows/Ubuntu runners only.
No CI artifacts, caches, packages, signing, deployments, cloud secrets or AI jobs
are permitted. Ordinary application use does not run Actions.

## Protection and activation

Keep the workflow token default read-only. Require approval for **all external
contributors** before fork workflows run. Configure strict main protection with
the single required check `SkyAnchor exact candidate` bound to GitHub Actions
app ID 15368, administrator enforcement, no force pushes, deletions, fork syncing,
push restrictions or bypass allowances. Routine trivial updates require no
self-approval; zero required approving reviews does not waive the independent
required check. Additional or unknown rulesets halt maintenance for owner review.
The token must be allowed to create PRs, but never bypass protection.

The native `GITHUB_TOKEN` cannot request Administration permission. Reading
`branches/main/protection` and Actions fork-contributor approval settings is an
**owner-admin setup operation**, not a runtime workflow capability. Never put an
owner OAuth token or an administrative credential into CI. Outside Actions,
the owner runs `node scripts/skyanchor/upstream.mjs verify-setup` with a local
`GH_TOKEN` authorized to read those settings and
`SKYANCHOR_ADMIN_POLICY_EVIDENCE` set to a sanitized owner-reviewed issue URL.
This read-only command validates the actual public repository ID, full strict
app-bound protection, administrator enforcement, explicit empty bypass lists,
fork approval policy and absence of additional rulesets. It prints a JSON
attestation; install that exact output as repository variable
`SKYANCHOR_ADMIN_POLICY_ATTESTATION`. Do not copy tokens or private billing
evidence. Missing bypass fields are unknown, never an empty safe list.

Runtime policy validates that owner attestation, then uses ordinary public
repository/branch metadata, effective branch rules and the main ref. It requires
`protected`, enabled protection, administrator-inclusive enforcement and the
exact check/app binding in the live branch response. Additional rules,
missing fields, HTTP 403 or any unknown response halt rather than fall back
to the attestation. Strict up-to-date/no-bypass/fork-approval settings remain
owner-admin verified, not falsely claimed runtime admin reads. GitHub's strict
server-side protection remains authoritative for every merge.

**Activation remains blocked until the parent exercises the actual native
public `GITHUB_TOKEN` against these runtime endpoints.** Local request fixtures
do not establish API access or response shape. If public branch metadata omits
the required enforcement/app fields, stop for a reviewed least-privilege
alternative; do not broaden credentials or treat omitted fields as safe.
For that preflight, leave maintenance and the other workflows disabled and
enable only the candidate workflow after owner setup. Its trusted policy step
must pass with the native token before dependency installation or candidate
execution. Keep maintenance disabled until that actual response is reviewed.

Only after verifying those settings, set repository variables
`SKYANCHOR_ZERO_SPEND_VERIFIED=true`,
`SKYANCHOR_FORK_APPROVAL_VERIFIED=true`,
`SKYANCHOR_ZERO_SPEND_EVIDENCE` to the sanitized owner-reviewed issue URL, and
finally `SKYANCHOR_AUTOMATION_ENABLED=true`. These variables are owner
attestations, not a billing API or proof that GitHub has enforced a budget.
Missing settings or unavailable APIs halt execution; never invent evidence.

The required candidate job's job condition is **only public repository binding**,
not activation flags. On this public repository it runs a fast first trusted
PowerShell guard before checkout and fails when activation or owner evidence is
missing. It must not be skipped merely because automation is disabled: GitHub
can accept skipped required jobs. Private or differently bound repositories
still run no jobs. During initial public bootstrap, keep **all Actions disabled**,
push the reviewed source, configure protection/fork approval/attestations, then
enable Actions and dispatch the actual main check. Disabled activation after
that produces a failed required context, not a skipped green gate.

Exercise the exact-head check and protected merge on a harmless reviewed
documentation PR first. Dispatch the candidate workflow on its exact branch,
verify the Actions check belongs to that head and trusted workflow, and merge
without administrator bypass or fabricated statuses. Do not change the
upstream pin to invent a release for this exercise. Remote acceptance remains a
parent responsibility; local tests are not evidence it happened.

## Maintenance protocol

Weekly/manual discovery accepts no arbitrary repository, ref, workflow or remote
inputs. It validates the persisted stable tag against the official remote and
fetches only the pinned/new public snapshots at depth one into temporary refs.
It does not merge upstream history. No private ancestry or upstream asset history
is needed. The current public tree must pass the publication guard.

Only small whitespace/punctuation corrections in existing plain prose in
`docs/build.md` or `docs/testing.md` are eligible. Word sequences and fenced
code must remain identical. Each old blob and mode must match sanitized main
exactly. Additions, renames, deletions, links, images, markup, command/code blocks,
symlinks, submodules, binaries, custom changes, dependencies, app/auth/sync/schema,
assets, workflows and security changes require owner review. A deduplicated
release issue reports nontrivial changes; nothing approves them automatically.
Even allowed prose needs the full actual-candidate gate. The deliberately narrow
classifier may reject harmless docs rather than widen authority.

The readonly job reconstructs a deterministic single-parent candidate containing
only allowed upstream blobs plus the owned provenance update, then builds/tests
that commit. The trusted writer installs no dependencies, independently
reconstructs the candidate and compares base/head/tree/patch and full-gate
receipt, including exact command outcomes and source/artifact hashes. Only then
does it push a bounded branch and create a PR. No bundle/artifact is transferred.
The token-created PR gets an explicit candidate workflow dispatch because token
pushes do not trigger normal PR workflows.

A subsequent maintenance run independently reconstructs again and requires the
successful exact-head Actions check and matching workflow job/run. Main, tag,
candidate, visibility and protection are checked again. The merge API receives
the exact candidate SHA; strict server-side protection remains authoritative.
No auto-merge flag, approval, synthetic status or bypass is used. Main advances,
head tampering, failed checks and unknown responses stop rather than broaden scope.
If main advances, the stale branch requires owner cleanup/review; it is never
force-pushed. These fail-closed pauses are intentional.

Retained historical trees keep the previous workflow policy for provenance.
The publication guard enforces the new non-skipping required-job invariant on
the current tree while still scanning every historical tree for privacy,
runner/capability limits and its original per-job public/cost guards.
