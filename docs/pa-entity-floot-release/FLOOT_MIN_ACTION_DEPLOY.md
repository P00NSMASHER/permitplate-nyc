# PA Entity x402 — minimum-action Floot deployment

This is the execution order for the next free Floot window. Do not spend money or upgrade the Floot plan.

## Inputs

Project:
`b69a3ee6-eb01-430d-aa51-da2fc7beeac4`

Production origin:
`https://pa-entity-x402.floot.app`

Atomic patches:
- `FLOOT_PATCH_CORE.txt` — 8 endpoint/schema files
- `FLOOT_PATCH_DISCOVERY.txt` — 10 static/discovery files

Canonical extensionless source:
- `x402.json` -> attempt `static/.well-known/x402`

## Execution order

1. Read current Floot file tree and version once.
2. Apply `FLOOT_PATCH_CORE.txt` atomically using that expected version.
3. Re-read only as needed to obtain the new version.
4. Apply `FLOOT_PATCH_DISCOVERY.txt` atomically.
5. Attempt to create `static/.well-known/x402` with the exact contents of `x402.json`.
   - If Floot rejects an extensionless static path, record the platform limitation.
   - Do not roll back the valid JSON aliases.
6. Typecheck:
   - `endpoints/pa-business_GET.ts`
   - `endpoints/pa-entity-one_GET.ts`
   - both OPTIONS endpoints
7. Create one named checkpoint only after the code/static bundle is coherent.
8. Republish the already-live app once.
9. Run `scripts/verify-pa-entity-production.mjs` externally.
10. Only after production verification passes:
    - re-register Agent402;
    - refresh x402scan;
    - re-check nohumans;
    - re-check 402 Index;
    - re-check Market402;
    - read PayAI public settlement stats.

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
- Revenue remains $0 until a real third-party settlement is observed.

## Prepared-patch verification

The two atomic patch files were reconstructed and compared byte-for-byte with all 18 release fixtures before deployment:
- core: 8/8 exact
- discovery/static: 10/10 exact
