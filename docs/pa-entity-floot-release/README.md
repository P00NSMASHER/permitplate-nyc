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
| pa-business_OPTIONS.ts | endpoints/pa-business_OPTIONS.ts |
| pa-entity-one_OPTIONS.ts | endpoints/pa-entity-one_OPTIONS.ts |
| pa-entity-one_OPTIONS.schema.ts | endpoints/pa-entity-one_OPTIONS.schema.ts |
| pa-business_OPTIONS.schema.ts | endpoints/pa-business_OPTIONS.schema.ts |
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

The canonical extensionless path is intentionally a **two-resource** manifest:
- `/_api/pa-entity-one` at $0.001
- `/_api/pa-business` at $0.005

The staged `x402` file has been parsed successfully by Agent402's current `normaliseManifestTools` implementation with both prices, Base network, and seller wallet preserved.

Keep `x402.json` and `x402-services.json` as conservative single-resource compatibility aliases. If Floot cannot serve the extensionless static file as HTTP 200 `application/json`, record that platform limitation and do not claim Agent402 canonical discovery is fixed.

## Skill discovery

The current Floot deployment serves `/skill.md` as the SPA HTML shell, so do not advertise that path.

Publish `skill.txt` as `static/skill.txt` and use this same-origin machine-readable URL:

https://pa-entity-x402.floot.app/skill.txt

The raw GitHub `PA_ENTITY_SKILL.md` remains a durable fallback/reference, but the live service metadata should prefer the same-origin `/skill.txt`.

Do not publish an A2A `/.well-known/agent-card.json` unless the service actually implements an A2A protocol binding. This release is an HTTP/x402 API, not an A2A message server.

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
27. Revenue remains $0 until a third-party settlement is observed.
