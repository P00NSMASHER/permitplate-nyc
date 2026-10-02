# PA Entity x402 — minimum-action Floot deployment

## 2026-10-02 outage/rehost update

This file is now a **legacy PA-only release note**, not the authoritative AppDeploy-outage recovery plan.

For the current recovery, use:

`docs/floot-rehost-implementation-map.md`

Do **not** execute the old “Patch 5 only” instruction by itself. The vendor-aware discovery aliases are now large enough that the safe release bundle is intentionally split:

- `FLOOT_SAFE_PATCH_5_X402_ALIASES.txt` → `static/.well-known/x402.json`
- `FLOOT_SAFE_PATCH_8_X402_SERVICES_ALIAS.txt` → `static/.well-known/x402-services.json`

The split preserves the conservative <32 KB-per-patch deployment rule while keeping both aliases byte-for-byte aligned with their tested fixtures.


This is the approved execution order for the next free Floot window. **Do not spend money or upgrade the Floot plan.**

## Inputs

Project:
`b69a3ee6-eb01-430d-aa51-da2fc7beeac4`

Production origin:
`https://pa-entity-x402.floot.app`

## Live production delta — 2026-10-02

The previously hardened PA Entity release is already live and production-verified. The only new unpublished delta is a **Bazaar-ingestion compatibility addition** to the standard JSON aliases:

- `/.well-known/x402.json`
- `/.well-known/x402-services.json`

Both aliases keep their existing legacy top-level `resource` + `accepts[]` fields and now also expose a minimal two-entry `resources[]` view:
- `/_api/pa-entity-one` at $0.001 / 1000 atomic Base USDC
- `/_api/pa-business` at $0.005 / 5000 atomic Base USDC

This directly matches the resource-array shape used by CDP-style Bazaar ingestors such as Agent Bazaar. The canonical `/.well-known/x402` and `/.well-known/x402-catalog.json` already carried both resources and do not need another write.

Historical PA-only note: before the vendor-gate/rehost work, this section called for Patch 5 alone. That instruction is superseded for the current recovery.

If only the two standard alias files ever need to be refreshed in isolation, apply both:

1. `FLOOT_SAFE_PATCH_5_X402_ALIASES.txt`
2. `FLOOT_SAFE_PATCH_8_X402_SERVICES_ALIAS.txt`

Do not use this legacy subsection as the outage-rehost execution plan; use `docs/floot-rehost-implementation-map.md`.

After the alias writes:
1. create one checkpoint;
2. republish once;
3. verify `/.well-known/x402.json` and `/.well-known/x402-services.json` each expose two `resources[]` entries with 1000/5000 atomic amounts and the unchanged payout wallet;
4. run `scripts/verify-pa-entity-production.mjs`;
5. if green, resubmit the standard `/.well-known/x402.json` to Agent Bazaar and re-check catalog-driven discovery surfaces.

## Approved safe patches

Use these eight smaller patch payloads in order:

1. `FLOOT_SAFE_PATCH_1_BUSINESS.txt` — main $0.005 GET endpoint + schema
2. `FLOOT_SAFE_PATCH_2_BEST_MATCH.txt` — $0.001 GET endpoint + schema
3. `FLOOT_SAFE_PATCH_3_OPENAPI.txt` — OpenAPI, sitemap, security.txt
4. `FLOOT_SAFE_PATCH_4_AGENT_TEXT.txt` — llms.txt, llms-full.txt, skill.txt
5. `FLOOT_SAFE_PATCH_5_X402_ALIASES.txt` — x402.json
6. `FLOOT_SAFE_PATCH_6_X402_CATALOG.txt` — x402-service.json + x402-catalog.json
7. `FLOOT_SAFE_PATCH_7_EXTENSIONLESS.txt` — isolated canonical `static/.well-known/x402`
8. `FLOOT_SAFE_PATCH_8_X402_SERVICES_ALIAS.txt` — x402-services.json

The legacy `FLOOT_PATCH_CORE.txt` and `FLOOT_PATCH_DISCOVERY.txt` payloads are **superseded and must not be deployed**. They are too large for the conservative Floot patch lane and the old core payload includes unsupported custom OPTIONS endpoints.

## Floot platform limitation

Do **not** create custom `*_OPTIONS.ts` endpoints. Floot rejects explicit OPTIONS endpoint files. The gateway currently answers OPTIONS itself, but custom preflight headers cannot be guaranteed. Server-to-server x402 clients are the supported path.

GET responses still expose the x402 CORS headers.

## Interruption-safe resume checkpoint

Last verified safe-patch integrity:
- GitHub Actions run: `36977374462`
- result: `success`
- verified release commit: `e3c950cae15ba8387b2a93af7dc4ae1bd6dcbf7b`
- release regression run: `36977374501` — success
- standard deploy files: `14/14 exact`
- extensionless canonical manifest: `1/1 exact`
- safe patch count: `7`
- release fingerprint: `3bbe93099a301a023dc7016e2028c718519e6d78e2fc0d2a029ce7518f09d8ab`

After any chat/stream interruption:
1. re-read current `main`;
2. rerun/confirm the Floot patch-integrity gate if any file under this release directory changed;
3. compare the printed `FLOOT_RELEASE_FINGERPRINT` to the value above;
4. if unchanged and green, resume at the next unfinished execution-order step—do not reconstruct the release.

Current-head integrity must be green immediately before any Floot write.

## Execution order

Legacy PA-only sequence (superseded by the outage/rehost map):

1. Read the current Floot project version once.
2. If performing an aliases-only refresh, apply `FLOOT_SAFE_PATCH_5_X402_ALIASES.txt` and `FLOOT_SAFE_PATCH_8_X402_SERVICES_ALIAS.txt`.
3. Create one checkpoint after the static alias updates.
4. Republish the already-live app once.
5. Verify both standard alias URLs return HTTP 200 JSON and:
   - expose `resources.length === 2`;
   - include `/_api/pa-entity-one` with amount `1000`;
   - include `/_api/pa-business` with amount `5000`;
   - keep Base network `eip155:8453`;
   - keep payTo `0x708f7b52b56eafd7fc1de65fc7752ed732914021`.
6. Run `scripts/verify-pa-entity-production.mjs` externally.
7. Only after production verification passes:
   - submit `https://pa-entity-x402.floot.app/.well-known/x402.json` to Agent Bazaar `POST /submit`;
   - verify Agent Bazaar readback by hostname;
   - re-check Vet402 / catalog-driven coverage;
   - re-check PayAI settlement stats.

Expected Floot build actions: a small static-only update plus checkpoint/publish, not a full release replay.

## Non-negotiable release invariants

- No new spend.
- Main search remains $0.005 USDC / 5000 atomic.
- Best-match search remains $0.001 USDC / 1000 atomic.
- Base mainnet remains `eip155:8453`.
- Base USDC asset remains `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- payTo remains `0x708f7b52b56eafd7fc1de65fc7752ed732914021`.
- Invalid payment is 402, not fake 503.
- Verifier outage is 503 with same-payment retry semantics.
- `settlement_pending` and `duplicate_settlement` never create a fresh payment challenge.
- Primary PA data failure occurs before settlement.
- Bazaar examples show a real OpenAI result.
- `/skill.txt` must be text, not SPA HTML.
- No A2A agent-card claim unless an A2A server is actually implemented.
- Do not advertise browser-preflight compatibility on Floot.
- Revenue remains $0 until a real third-party settlement is observed.

## Prepared-patch verification

Permanent CI reconstructs all eight approved safe patches and compares them byte-for-byte to the current release fixtures:

- standard supported files: 14/14 exact
- isolated extensionless manifest: 1/1 exact
- total: 15/15 exact
- any unsupported OPTIONS target fails the release gate
- any patch >= the conservative size threshold fails the release gate
