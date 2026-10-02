# PA Entity Floot hardened release bundle

This directory is the tested source package for the next production release of https://pa-entity-x402.floot.app.

## File mapping

Copy these files into Floot after the daily action reset:

| Release fixture | Floot target |
| --- | --- |
| pa-business_GET.ts | endpoints/pa-business_GET.ts |
| pa-business_GET.schema.ts | endpoints/pa-business_GET.schema.ts |
| pa-entity-one_GET.ts | endpoints/pa-entity-one_GET.ts |
| pa-entity-one_GET.schema.ts | endpoints/pa-entity-one_GET.schema.ts |
| vendor-intake-gate_GET.ts | endpoints/vendor-intake-gate_GET.ts |
| vendor-intake-gate_GET.schema.ts | endpoints/vendor-intake-gate_GET.schema.ts |
| openapi.json | static/openapi.json |
| llms.txt | static/llms.txt |
| llms-full.txt | static/llms-full.txt |
| skill.txt | static/skill.txt |
| x402 | static/.well-known/x402 |
| x402.json | static/.well-known/x402.json |
| x402-services.json | static/.well-known/x402-services.json |
| x402-service.json | static/.well-known/x402-service.json |
| x402-catalog.json | static/.well-known/x402-catalog.json |
| security.txt | static/.well-known/security.txt |
| sitemap.xml | static/sitemap.xml |

The currently deployed canonical extensionless manifest remains a **two-resource** baseline:
- `/_api/pa-entity-one` at $0.001
- `/_api/pa-business` at $0.005

A Floot-native `/_api/vendor-intake-gate` release candidate at $0.020 is now staged in this bundle and covered by `scripts/test-floot-vendor-gate-release.mts`. It uses PA/Census/OFAC/RDAP public-data logic directly and has **zero AppDeploy runtime dependencies**. During hosting incident #38, do not mistake the old two-resource baseline for the target recovery state; follow issue #39 and `docs/floot-rehost-implementation-map.md` for the eight-resource recovery sequence.

The existing two-resource `x402` baseline has been parsed successfully by Agent402's current `normaliseManifestTools` implementation with both prices, Base network, and seller wallet preserved.

Keep `x402.json` and `x402-services.json` as conservative compatibility aliases: preserve the legacy top-level resource/accepts fields and also expose a minimal two-entry `resources[]` view so CDP-style Bazaar ingestors can discover both paid routes. If Floot cannot serve the extensionless static file as HTTP 200 `application/json`, record that platform limitation and do not claim Agent402 canonical discovery is fixed.

## Approved deployment payloads

The eight `FLOOT_SAFE_PATCH_*.txt` files remain the approved **PA-baseline** patch set (seven standard patches plus one isolated extensionless-manifest patch). They do not by themselves perform the AppDeploy-incident rehost. While incident #38 is active, use them only where the recovery plan explicitly calls for preserving or refreshing the two proven PA routes/discovery files.

The staged vendor-gate endpoint files above are pretested recovery inputs, not yet proof of a live Floot deployment. Full incident recovery is governed by issue #39 and `docs/floot-rehost-implementation-map.md`.

The older `FLOOT_PATCH_CORE.txt` and `FLOOT_PATCH_DISCOVERY.txt` files are retained only as historical build artifacts. **Do not deploy them.** They are oversized for the conservative patch lane, and the old core payload contains explicit OPTIONS endpoint files that Floot does not support.

Permanent CI verifies the eight safe patches reconstruct the current supported release bundle byte-for-byte and rejects any OPTIONS endpoint target.

## Skill discovery

The current Floot deployment serves `/skill.md` as the SPA HTML shell, so do not advertise that path.

Publish `skill.txt` as `static/skill.txt` and use this same-origin machine-readable URL:

https://pa-entity-x402.floot.app/skill.txt

The raw GitHub `PA_ENTITY_SKILL.md` remains a durable fallback/reference, but the live service metadata should prefer the same-origin `/skill.txt`.

Do not publish an A2A `/.well-known/agent-card.json` unless the service actually implements an A2A protocol binding. This release is an HTTP/x402 API, not an A2A message server.

## Floot OPTIONS limitation

Floot endpoint files support GET/POST only. Explicit OPTIONS endpoint files are rejected by the platform. The live gateway currently answers OPTIONS with HTTP 204 but does not expose custom CORS headers. GET responses do expose the x402 CORS headers. Treat browser preflight support as a Floot platform limitation; server-to-server x402 clients are unaffected.

## Required post-deploy gates

1. Typecheck clean.
2. /openapi.json => 200 application/json.
3. /llms.txt => 200 text/plain.
4. /skill.txt => 200 text/plain and must not contain the SPA HTML shell.
5. /.well-known/x402 => 200 application/json and advertises both $0.001 + $0.005 routes.
6. /.well-known/x402.json => 200 application/json.
7. /.well-known/x402-services.json => 200 application/json.
8. /.well-known/x402-service.json => 200 application/json.
9. /.well-known/x402-catalog.json => 200 application/json.
10. /.well-known/security.txt => 200 text/plain.
11. Both paid routes => real external HTTP 402.
12. PAYMENT-REQUIRED present.
13. /_api/pa-business = $0.005 / 5000 atomic Base USDC; /_api/pa-entity-one = $0.001 / 1000 atomic Base USDC; payTo unchanged.
14. Invalid signed payload => 402, not 503.
15. Invalid paid retry query => 400 without facilitator call.
16. PA source failure => 502 and no settlement.
17. settlement_pending/duplicate_settlement never creates a fresh payment challenge.
18. unresolved settlement => 503 + Retry-After + no PAYMENT-REQUIRED.
19. successful settlement => PAYMENT-RESPONSE + x402-settled:true.
20. OpenAI, Sheetz, Wawa legal-name matches rank first.
21. creationDate and principal/officer enrichment present.
22. Coinbase/CDP validator valid=true and simulation accepted.
23. AgentCash discovers both paid GET routes: $0.001 best-match and $0.005 enriched multi-result.
24. Refresh x402scan.
25. Re-register Agent402 and inspect routable/health state.
26. Re-check 402 Index and nohumans rankings.
27. Staged Floot-native vendor gate release test passes challenge, verify, decision, settlement, address-review and domain-review branches with no AppDeploy dependency.
28. After incident rehost, the zero-spend portfolio verifier passes the actual consolidated manifest/resource count before Agent402 re-registration.
29. Revenue remains $0 until a third-party settlement is observed.

## Floot CORS limitation

Floot currently does not permit custom OPTIONS endpoints. The paid GET responses include CORS headers, but browser clients that require a preflight for PAYMENT-SIGNATURE may not be able to call the seller directly from the browser. Do not advertise browser-preflight compatibility. Server-to-server x402 clients remain the supported buyer path.
