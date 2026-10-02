# OFAC SDN Name Screen x402 — Netlify migration bundle

Source: AppDeploy snapshot `ofac-sdn-name-screen-x402-m9ko96` on 2026-10-02.

Migration policy:
- Business logic and x402 v2 payment behavior are copied from the current AppDeploy backend.
- Only the runtime adapter and public origin constants are changed.
- Public discovery and paid routes live on the same origin: https://ofac-sdn-name-screen-x402.netlify.app
- No AppDeploy credits, paid Netlify features, or payment metadata changes are required.

Deploy from this directory to Netlify project `ofac-sdn-name-screen-x402`.

Required post-deploy checks:
1. GET /.well-known/x402 => 200
2. GET /.well-known/x402.json => 200
3. GET /.well-known/x402-services.json => 200
4. GET /openapi.json => 200
5. unpaid paid-route request => 402 + PAYMENT-REQUIRED
6. decoded challenge keeps x402Version=2, eip155:8453, USD Coin name/version 2, existing USDC contract, payTo wallet and price
