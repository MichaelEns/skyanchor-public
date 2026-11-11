# Publication and upstream maintenance

## Status and owner prerequisites

The sanitized source is public at
[MichaelEns/skyanchor-public](https://github.com/MichaelEns/skyanchor-public).
The four existing workflows are active. Native-token policy, full required candidate CI
and protected automatic merging have been accepted without administrator bypass,
self-approval or fabricated statuses. The original private source history,
live application and saved data remain unchanged.
Never push the private repository, a private commit, bundle, object database or
release ledger. The first public commit must be a clean, parentless sanitized
snapshot with the owner's GitHub no-reply author and committer. Keep the private
repository and its history unchanged. Preserve MIT, ASSETS, NOTICE and supplier
licenses. The upstream pin is public provenance, not a private merge base.
The official remote tag is `1.137.0` (release name `release1.137.0`); the pin
is validated against the real public tag rather than inferring a tag name.

For initial setup or reactivation, publication and activation must remain
**blocked** until the owner verifies an effective
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
Public visibility, strict app-bound main protection, administrator enforcement,
all-external-contributor workflow approval and read-only default tokens are
configured. Native-token policy and full candidate CI succeeded in
[run 42788352969](https://github.com/MichaelEns/skyanchor-public/actions/runs/42788352969).
[PR #3](https://github.com/MichaelEns/skyanchor-public/pull/3) waited for required
[run 42788488611](https://github.com/MichaelEns/skyanchor-public/actions/runs/42788488611)
to succeed, then GitHub automatically merged it at 2026-11-10T09:32:01Z as
`bca90527b16e58fc135f7eb333b9fbfb77a4d644`. Protection remained enforced.
The additional main check
[42791503051](https://github.com/MichaelEns/skyanchor-public/actions/runs/42791503051)
was still in progress at this documentation update; no success is claimed for it.

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

Only the owner configures the public repository after review and verified
zero-spend policy. Use standard public Windows/Ubuntu runners only.
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
app-bound protection, administrator enforcement, no effective bypass allowances,
fork approval policy and absence of additional rulesets. It prints a JSON
attestation; install that exact output as repository variable
`SKYANCHOR_ADMIN_POLICY_ATTESTATION`. Do not copy tokens or private billing
evidence.

For this personal repository, setup also verifies repository
`MichaelEns/skyanchor-public` ID 1452249834, owner type `User`, owner
`MichaelEns` ID 44419611, repository administrator access and the same
authenticated identity from `GET /user`. GitHub rejected even empty
`bypass_pull_request_allowances` payloads for this personal repository with
HTTP 422 and omitted that organization-only field in its administrative
readback. Only this verified personal-owner case can classify **field absence**
as `not-applicable-personal-api-unsupported`. Missing fields for organization
or unknown ownership remain errors; present unknown, malformed or nonempty
allowances are rejected. Strict status checks and administrator enforcement
remain mandatory. The branch is never unprotected to bootstrap the fix.

The schema-1 attestation represents the resulting empty **effective** allowance
sets in its existing protection fields so published main can validate it.
`ownerVerification` explicitly records the personal API omission and derived
representation: these arrays are not claimed to have come from GitHub.
Setup never mutates the API readback. The owning regression loads the actual
published `fb76bfb` validator and proves it accepts this canonical output
while still rejecting the unclassified raw personal response.

For future owner-admin re-verification, run the reviewed source with `GH_REPOSITORY` set to
`MichaelEns/skyanchor-public`, `SKYANCHOR_ADMIN_POLICY_EVIDENCE` set to
`https://github.com/MichaelEns/skyanchor-public/issues/2` and the personal
owner token in local `GH_TOKEN`, then invoke
`node scripts/skyanchor/upstream.mjs verify-setup`. Keep the token outside CI
and source. Review that output before setting the attestation variable; every
fix PR must satisfy the existing required check without an administrator bypass.

Runtime policy validates that owner attestation, then uses ordinary public
repository/branch metadata, effective branch rules and the main ref. It requires
`protected`, enabled protection, administrator-inclusive enforcement and the
exact check/app binding in the live branch response. Additional rules,
missing fields, HTTP 403 or any unknown response halt rather than fall back
to the attestation. Strict up-to-date/no-bypass/fork-approval settings remain
owner-admin verified, not falsely claimed runtime admin reads. GitHub's strict
server-side protection remains authoritative for every merge.

The actual native public `GITHUB_TOKEN` policy preflight has passed. For any
new setup, **activation must remain blocked until that preflight succeeds**.
Local request fixtures
do not establish API access or response shape. If public branch metadata omits
the required enforcement/app fields, stop for a reviewed least-privilege
alternative; do not broaden credentials or treat omitted fields as safe.
For a new preflight, leave maintenance and the other workflows disabled and
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

The exact-head check and protected automatic merge were exercised on reviewed
PR #3. For any new setup, exercise protected acceptance before maintenance:
dispatch the candidate workflow on the reviewed PR's exact branch,
verify the Actions check belongs to that head and trusted workflow, and merge
without administrator bypass or fabricated statuses. Do not change the
upstream pin to invent a release for this exercise. Remote acceptance remains an
owner responsibility; local tests alone are not evidence it happened.

## Owner-reviewed fix merges

`skyanchor-owner-merge.yml` is a separate, dispatch-only helper, not an expansion
of the fully automatic upstream classifier. The owner authorizes an attempt
for one already-reviewed PR number and exact 40-character head. It neither
reviews the code nor approves a PR. Only MichaelEns (ID 44419611), a fresh
`workflow_dispatch` on current main in the bound public repository, may use it.
Reruns and dispatches from other refs/actors fail. Missing activation, cost or
owner-policy evidence fails visibly rather than skipping to a green result.

The job checks out only its exact trusted main SHA, with credentials persistence
disabled. It installs no dependencies, reads no candidate checkout, and uses no
artifacts, caches, personal tokens or cloud credentials. Its native token has
only contents/pull-request write and Actions/checks read permissions (checks read
is used to inspect the exact-candidate check runs). It rechecks runtime
policy, current main, the open same-repository PR/head/base and the latest
successful, unskipped exact-candidate PR run from Actions app 15368, including
check-suite, job and URL bindings. Unknown/overflow inventories halt. The
candidate workflow blob must match trusted main, and all job steps, including
the actual full `pnpm skyanchor:verify` step, must succeed without skips.
Intentional candidate-workflow changes require the existing manual owner path.
The existing strict protection and server-side conversation requirements remain
authoritative: the only mutation is `PUT pulls/N/merge` with the reviewed `sha`
and `merge_method: merge`. No admin bypass, approval, branch deletion, email
override, account change or deployment is attempted.

[GitHub documents the native token](https://docs.github.com/en/actions/concepts/security/github_token)
as a repository-scoped GitHub App installation token, available through
`github.token`; the workflow passes that value directly, not an owner OAuth
token. The [merge REST contract](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)
supports exact-head SHA matching, not an author-email parameter. This is not a
claim that arbitrary user-token defaults preserve email privacy. After merging,
the helper verifies the API commit's GitHub Actions bot author ID and canonical
NoReply email, a bot NoReply or GitHub web-flow `noreply@github.com` committer,
the two exact parents and the approved head tree. A post-merge mismatch fails
with an explicit **merge occurred** warning; it cannot roll back a
merge. GitHub's actual native-token attribution must be accepted remotely
before this helper is considered operational.

Bootstrap requires one normally protected, reviewed PR to land this workflow
on main; the new workflow cannot merge its own bootstrap. After the parent's
logic/privacy review, run the single final clean-HEAD release gate and required
GitHub candidate CI, then merge through the existing owner path without bypass.
Next open a harmless same-repository documentation PR and let its actual
`SkyAnchor exact candidate` PR run finish successfully. From the owner's existing
personal CLI authentication, dispatch:

```powershell
gh workflow run skyanchor-owner-merge.yml --repo MichaelEns/skyanchor-public --ref main -f pr_number=NUMBER -f expected_head=EXACT_40_CHARACTER_HEAD
```

Inspect that helper run and the resulting commit's bot/NoReply identities,
parents, tree and enforced protection; a local fixture is not this acceptance.
The helper is not claimed enabled or remotely accepted by this source change.
After acceptance, future user-authorized fixes can use that same owner dispatch
without a separate native-web merge/email selection; no credential handoff is
needed. Dispatch is permission to attempt that exact reviewed merge, not a
promise of success or an exemption from the full required gate. Merges performed
with `GITHUB_TOKEN` may not trigger a main push workflow; this helper does not
deploy or substitute for any separately required post-merge validation.

### Operator acceptance checklist

1. Review the exact PR head and wait for its required `SkyAnchor exact candidate`
   check to succeed. Dispatch the [owner merge workflow](../../.github/workflows/skyanchor-owner-merge.yml)
   on **main**, supplying that PR number and exact head SHA.
2. Verify the helper attempts a normal protected merge as the Actions bot and
   validates the returned merge's NoReply identities, exact parents and approved
   head tree. Record the actual run result before claiming remote acceptance.
3. If the head, main, check or policy is stale or changed, stop and resolve the
   failure without bypassing protection. Use a fresh owner dispatch after
   revalidation, not a rerun of an existing attempt.

## Maintenance protocol

The actual native-token maintenance
[run 42791725138](https://github.com/MichaelEns/skyanchor-public/actions/runs/42791725138)
succeeded on the accepted main commit. Inspection found no new stable upstream
release, so candidate verification and publication correctly skipped.
This proves the no-update path, not an actual trivial-upstream-release landing.
At acceptance, Actions artifact and cache inventories and repository secrets
were all empty. Standard public runners and the verified hard-zero policy remain
mandatory; ordinary application use consumes no Actions compute.

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
The maintenance publisher uses no auto-merge flag, approval, synthetic status or
bypass; GitHub's queued automatic merge used for PR #3 is separate from this
two-pass updater protocol. Main advances,
head tampering, failed checks and unknown responses stop rather than broaden scope.
If main advances, the stale branch requires owner cleanup/review; it is never
force-pushed. These fail-closed pauses are intentional.

Retained historical trees keep the previous workflow policy for provenance.
The publication guard enforces the new non-skipping required-job invariant on
the current tree while still scanning every historical tree for privacy,
runner/capability limits and its original per-job public/cost guards.
