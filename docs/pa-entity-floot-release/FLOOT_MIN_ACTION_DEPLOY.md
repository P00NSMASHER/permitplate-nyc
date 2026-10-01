# PA Entity x402 — minimum-action Floot deployment

This is the approved execution order for the next free Floot window. **Do not spend money or upgrade the Floot plan.**

## Inputs

Project:
`b69a3ee6-eb01-430d-aa51-da2fc7beeac4`

Production origin:
`https://pa-entity-x402.floot.app`

## Approved safe patches

Use these seven smaller patch payloads in order:

1. `FLOOT_SAFE_PATCH_1_BUSINESS.txt` — main $0.005 GET endpoint + schema
2. `FLOOT_SAFE_PATCH_2_BEST_MATCH.txt` — $0.001 GET endpoint + schema
3. `FLOOT_SAFE_PATCH_3_OPENAPI.txt` — OpenAPI, sitemap, security.txt
4. `FLOOT_SAFE_PATCH_4_AGENT_TEXT.txt` — llms.txt, llms-full.txt, skill.txt
5. `FLOOT_SAFE_PATCH_5_X402_ALIASES.txt` — x402.json + x402-services.json
6. `FLOOT_SAFE_PATCH_6_X402_CATALOG.txt` — x402-service.json + x402-catalog.json
7. `FLOOT_SAFE_PATCH_7_EXTENSIONLESS.txt` — isolated canonical `static/.well-known/x402`

The legacy `FLOOT_PATCH_CORE.txt` and `FLOOT_PATCH_DISCOVERY.txt` payloads are **superseded and must not be deployed**. They are too large for the conservative Floot patch lane and the old core payload includes unsupported custom OPTIONS endpoints.

## Floot platform limitation

Do **not** create custom `*_OPTIONS.ts` endpoints. Floot rejects explicit OPTIONS endpoint files. The gateway currently answers OPTIONS itself, but custom preflight headers cannot be guaranteed. Server-to-server x402 clients are the supported path.

GET responses still expose the x402 CORS headers.

## Interruption-safe resume checkpoint

Last verified safe-patch integrity:
- GitHub Actions run: `36896460882`
- result: `success`
- verified commit: `985ea4b306d8fc35c2e4d7f4427696eb16b66afb`
- standard deploy files: `14/14 exact`
- extensionless canonical manifest: `1/1 exact`
- safe patch count: `7`
- release fingerprint: `f287450bbad293b8efe3bf628b53744a33ce67427e63f4eabb52a2389f47a9f7`

After any chat/stream interruption:
1. re-read current `main`;
2. rerun/confirm the Floot patch-integrity gate if any file under this release directory changed;
3. compare the printed `FLOOT_RELEASE_FINGERPRINT` to the value above;
4. if unchanged and green, resume at the next unfinished execution-order step—do not reconstruct the release.

Current-head integrity must be green immediately before any Floot write.

## Execution order

1. Read current Floot file tree once and capture `expected_version`.
2. Apply safe patches 1 through 6 sequentially.
   - Use the version returned by each successful Floot write as the next `expected_version` when available.
   - Do not reread the whole project between patches unless a write response does not expose the new version.
3. Apply patch 7 separately.
   - If Floot rejects the extensionless static path, record the platform limitation.
   - Do **not** roll back the six valid standard patches.
4. Typecheck only the supported endpoint files:
   - `endpoints/pa-business_GET.ts`
   - `endpoints/pa-entity-one_GET.ts`
5. Create one named checkpoint after the coherent source/static bundle passes typecheck.
6. Republish the already-live app once using the available Floot publish flow.
7. Run `scripts/verify-pa-entity-production.mjs` externally.
8. Only after production verification passes:
   - re-register Agent402;
   - refresh/re-check x402scan where authentication permits;
   - re-check nohumans;
   - re-check 402 Index;
   - re-check Market402;
   - read PayAI public settlement stats.

Expected Floot build actions: roughly 10–12, well below the 100/day free cap.

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

Permanent CI reconstructs all seven approved safe patches and compares them byte-for-byte to the current release fixtures:

- standard supported files: 14/14 exact
- isolated extensionless manifest: 1/1 exact
- total: 15/15 exact
- any unsupported OPTIONS target fails the release gate
- any patch >= the conservative size threshold fails the release gate
