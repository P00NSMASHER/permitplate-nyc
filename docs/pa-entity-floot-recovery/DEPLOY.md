# Floot Outage-Recovery Deployment Playbook

Prepared after the AppDeploy outage on 2026-10-02.

## Authority

Floot project:

`b69a3ee6-eb01-430d-aa51-da2fc7beeac4`

Production origin:

https://pa-entity-x402.floot.app

Locked deployment map:

`docs/pa-entity-floot-recovery/deploy-map.json`

Immutable execution queue:

`verification/floot-deployment-queue-latest.json`

The execution queue pins:
- branch: `floot-recovery-lock-2026-10-02`
- commit: `ceb21b651764ffaa0c893f4e725eccce0c10ba5f`

**Fetch every deployment source from that pinned branch/commit, never mutable `main`.** Blob SHA + byte-size checks in the queue remain authoritative even if `main` receives unrelated documentation or verification commits.

Current target:

- 8 paid x402 resources
- 3 fixed free vendor-gate reviewer cases through `/_api/vendor-intake-demo`
- zero AppDeploy runtime dependencies

## Required pre-deploy gates

Do not deploy unless the newest runs on the source commit are green for:

1. **Test Floot rehost endpoints**
   - raw replacements
   - vendor gate paid flow
   - bounded reviewer wrapper
   - eight-resource bundle validator

2. **Test Floot recovery discovery**
   - 8 unique same-origin resources
   - 8 OpenAPI paid paths
   - all aliases/catalog aligned
   - locked source blob hashes match actual bytes
   - no `api-v2.appdeploy.ai` dependency

If either gate is red, fix the defect rather than weakening the gate.

## Preserve without modification

The following currently proven Floot routes must not be overwritten during recovery:

- `endpoints/pa-business_GET.ts`
- `endpoints/pa-business_GET.schema.ts`
- `endpoints/pa-entity-one_GET.ts`
- `endpoints/pa-entity-one_GET.schema.ts`

The vendor gate imports/contains its own PA registry decision logic and the five recovery endpoints use their own official public sources.

## Deployment writes

The locked map contains 26 writes.

### Runtime endpoint files — 14 writes

1. `endpoints/vendor-intake-gate_GET.ts`
2. `endpoints/vendor-intake-gate_GET.schema.ts`
3. `endpoints/vendor-intake-demo_GET.ts`
4. `endpoints/vendor-intake-demo_GET.schema.ts`
5. `endpoints/sec-filings_GET.ts`
6. `endpoints/sec-filings_GET.schema.ts`
7. `endpoints/us-address-geocode_GET.ts`
8. `endpoints/us-address-geocode_GET.schema.ts`
9. `endpoints/ofac-sdn-screen_GET.ts`
10. `endpoints/ofac-sdn-screen_GET.schema.ts`
11. `endpoints/domain-rdap_GET.ts`
12. `endpoints/domain-rdap_GET.schema.ts`
13. `endpoints/treasury-average-rates_GET.ts`
14. `endpoints/treasury-average-rates_GET.schema.ts`

### Static discovery files — 12 writes

15. `static/openapi.json`
16. `static/llms.txt`
17. `static/llms-full.txt`
18. `static/skill.txt`
19. `static/.well-known/x402`
20. `static/.well-known/x402.json`
21. `static/.well-known/x402-services.json`
22. `static/.well-known/x402-service.json`
23. `static/.well-known/x402-catalog.json`
24. `static/.well-known/security.txt`
25. `static/sitemap.xml`
26. `static/robots.txt`

## Floot action budget

Expected actions after the free-plan reset:

- 1 `list_files`
- 5 normal bounded `read_files` snapshot batches (per `ROLLBACK.md`)
- up to 14 additional single/bounded reads only in the pathological case that every normally-new recovery endpoint/schema file already exists
- 1 guide read if required
- 26 sequential file writes
- 1 typecheck
- 1 project test run
- 1 named checkpoint after the staged release is green
- 1 publish
- 1 publish-status check

Expected normal total: **37 Floot actions without a guide, 38 with one guide**. Absolute conservative worst case: **51 without a guide, 52 with one guide**. All remain comfortably below the 100-action daily allowance.

Keep writes serialized and carry the returned project version forward when the write tool exposes it. Do not make concurrent writes against one expected version.

## Write procedure

1. Fresh `list_files`.
2. Record:
   - current project version
   - existing endpoint/static paths
   - published metadata
3. Start the mandatory rollback snapshot from `docs/pa-entity-floot-recovery/ROLLBACK.md`. **Rollback Batch 1 is the single authoritative read of the four preserved PA files**; use those same returned bytes both for preservation verification and for the rollback snapshot. Do not perform a duplicate PA read.
4. Continue rollback Batches 2–5, identify every deployment target already present, and capture any unexpectedly preexisting recovery endpoint/schema target before mutation.
5. Re-read `verification/floot-deployment-queue-latest.json` and `deploy-map.json`.
6. Run `scripts/verify-floot-deployment-lock.mjs`; abort before any write if the pinned branch moved, any of the 26 source blob hashes/sizes drifted, or current `main` modified a locked source.
7. For each queue entry in order:
   - fetch exact GitHub source bytes from pinned commit `ceb21b651764ffaa0c893f4e725eccce0c10ba5f` at the recorded source path
   - write complete content to the mapped Floot target path
   - use current Floot project version as `expected_version` when supported
   - carry forward the returned version
8. Run Floot typecheck.
9. Run Floot tests.
10. Do not publish if either fails.
11. Create one checkpoint titled `x402 eight-route rehost staged` with the pinned source commit and pre-write Floot version in the description.
12. Publish once.

## Interruption-safe resume protocol

The deployment source is frozen at branch `floot-recovery-lock-2026-10-02`, commit `ceb21b651764ffaa0c893f4e725eccce0c10ba5f`.

If execution is interrupted during the 26 writes:

1. **Do not restart at write 1.**
2. Call `list_files` once to get the current Floot version and tree.
3. Identify the highest ordered deploy-map target that is already present with the expected mapped size/content.
4. For any uncertain boundary file, read that one Floot file and compare it against the locked GitHub source/blob SHA.
5. Resume with the **next unfinished map entry** using the freshly returned Floot version as `expected_version`.
6. Continue serialized writes from there.
7. Run the full typecheck/tests before publish regardless of where the interruption occurred.

Never overwrite the four preserved PA baseline files as part of a resume.

A deployment progress template is stored at `verification/floot-deployment-progress-template.json`; it is bookkeeping only and is not part of the runtime release.

## Pre-publish content checks

Confirm the staged Floot project contains:

Paid:

1. `/_api/pa-entity-one` — $0.001
2. `/_api/pa-business` — $0.005
3. `/_api/vendor-intake-gate` — $0.020
4. `/_api/sec-filings` — $0.005
5. `/_api/us-address-geocode` — $0.005
6. `/_api/ofac-sdn-screen` — $0.005
7. `/_api/domain-rdap` — $0.005
8. `/_api/treasury-average-rates` — $0.005

Free bounded review:

- `/_api/vendor-intake-demo?case=proceed`
- `/_api/vendor-intake-demo?case=address_mismatch`
- `/_api/vendor-intake-demo?case=domain_mismatch`

The free demo must reject any other case and must not accept arbitrary vendor inputs.

## Publish

Republish the existing production app to its existing Floot subdomain.

Do not create a new public hostname unless the current production publish becomes impossible.

## Immediate post-publish buyer checks

The numeric HTTP status may be translated by Floot; use the existing Floot response contract and check `x-floot-status` where applicable.

For each of the eight paid routes:

- unpaid request presents the payment challenge
- `PAYMENT-REQUIRED` decodes
- x402Version = 2
- network = `eip155:8453`
- asset = Base USDC
- payTo = expected payout wallet
- amount matches the route
- no AppDeploy URL appears in challenge or response

Fixed vendor cases:

- proceed -> `proceed`, no triggers
- address mismatch -> `human_review` + `registered_address_differs`
- domain mismatch -> `human_review` + `domain_name_not_aligned`

Discovery:

- `/.well-known/x402` returns valid JSON
- exactly 8 unique paid resources
- all 8 resources are same-origin Floot URLs
- OpenAPI contains exactly 8 paid paths
- aliases/catalog match canonical manifest

## Agent402 acceptance

After public buyer checks pass, re-register:

https://pa-entity-x402.floot.app

Do not call bare-origin consolidation complete until Agent402 readback shows the expanded tools, including the vendor-intake gate.

Expected:
- health 1
- routable true
- toolCount / paidToolCount reflects expanded portfolio
- vendor-intake gate visible

`settlement_required` may remain until genuine outside payment history exists. Do not self-fund it.

## Agentic.ai

Only after Agent402 recognizes the composed gate:

1. update `docs/agentic-ai-vendor-gate-resubmission-draft.md` with current evidence;
2. verify the fixed reviewer cases again;
3. submit the composed decision tool.

Do not resubmit raw APIs as the primary product and do not send the draft before the bare-origin evidence exists.

## Revenue accounting

Deployment, probes, test calls, directory registration, and seller-funded traffic are not buyer revenue.

Continue to report:
- outside buyers = 0
- confirmed outside revenue = $0

until an attributable independent settlement is observed.
