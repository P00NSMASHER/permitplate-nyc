# PA Entity Floot hardened release bundle

This directory is the tested source package for the next production release of https://pa-entity-x402.floot.app.

## File mapping

Copy these files into Floot after the daily action reset:

| Release fixture | Floot target |
| --- | --- |
| pa-business_GET.ts | endpoints/pa-business_GET.ts |
| pa-business_GET.schema.ts | endpoints/pa-business_GET.schema.ts |
| pa-business_OPTIONS.ts | endpoints/pa-business_OPTIONS.ts |
| pa-business_OPTIONS.schema.ts | endpoints/pa-business_OPTIONS.schema.ts |
| openapi.json | static/openapi.json |
| llms.txt | static/llms.txt |
| llms-full.txt | static/llms-full.txt |
| x402.json | static/.well-known/x402.json |
| x402-services.json | static/.well-known/x402-services.json |
| x402-service.json | static/.well-known/x402-service.json |
| x402-catalog.json | static/.well-known/x402-catalog.json |
| agent-card.json | static/.well-known/agent-card.json |
| agent-card.json | static/.well-known/agent.json |
| security.txt | static/.well-known/security.txt |
| sitemap.xml | static/sitemap.xml |

Also attempt to serve the canonical extensionless path:
- static/.well-known/x402

Use the exact contents of x402.json. If Floot rejects an extensionless static file, keep both JSON aliases live and record the platform limitation; do not fabricate success.

## Do not copy PA_ENTITY_SKILL.md into Floot as /skill.md

The current Floot deployment accepts static/skill.md in source but production serves the SPA HTML shell at /skill.md. The hardened catalog therefore points at the durable raw GitHub document:

https://raw.githubusercontent.com/P00NSMASHER/permitplate-nyc/main/PA_ENTITY_SKILL.md

Do not advertise the broken same-origin /skill.md path.

## Required post-deploy gates

1. Typecheck clean.
2. /openapi.json => 200 application/json.
3. /llms.txt => 200 text/plain.
4. /.well-known/x402.json => 200 application/json.
5. /.well-known/x402-services.json => 200 application/json.
6. /.well-known/x402-service.json => 200 application/json.
7. /.well-known/x402-catalog.json => 200 application/json.
8. /.well-known/agent-card.json => 200 application/json.
9. /.well-known/security.txt => 200 text/plain.
10. Unpaid paid route => real external HTTP 402.
11. PAYMENT-REQUIRED present.
12. $0.005 / 5000 atomic Base USDC / payTo unchanged.
13. Invalid signed payload => 402, not 503.
14. Invalid paid retry query => 400 without facilitator call.
15. PA source failure => 502 and no settlement.
16. settlement_pending/duplicate_settlement never creates a fresh payment challenge.
17. unresolved settlement => 503 + Retry-After + no PAYMENT-REQUIRED.
18. successful settlement => PAYMENT-RESPONSE + x402-settled:true.
19. OpenAI, Sheetz, Wawa legal-name matches rank first.
20. creationDate and principal/officer enrichment present.
21. Coinbase/CDP validator valid=true and simulation accepted.
22. AgentCash discovers one paid GET route.
23. Refresh x402scan.
24. Re-register Agent402 and inspect routable/health state.
25. Re-check 402 Index and nohumans rankings.
26. Revenue remains $0 until a third-party settlement is observed.
