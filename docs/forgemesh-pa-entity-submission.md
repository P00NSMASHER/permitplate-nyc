# ForgeMesh submission package — PA Entity Lookup x402

_Status: upstream validator passed; free submission transport unavailable in the connected GitHub toolset._

## Target repository

`forgemeshlabs/x402-verified`

## Required one-file change

Create:

`sellers/pa-entity-lookup-x402.json`

with the exact contents currently stored in this repository at:

`verification/forgemesh-pa-entity-seller.json`

## Automated-agent PR title

`Add PA Entity Lookup x402 🤖🤖🤖`

The double robot suffix is ForgeMesh's documented fast-track opt-in for automated agents.

## PR body

```markdown
Adds PA Entity Lookup x402 as one seller record.

- x402 v2 on Base
- nominated route: GET https://pa-entity-x402.floot.app/_api/pa-entity-one?q=OpenAI
- nominated price: 0.001 USDC
- payout wallet: 0x708f7b52b56eafd7fc1de65fc7752ed732914021
- proof transaction: 0x17985b16137ff8aef95641be06424a5fa4e9edacc6ade5aaf0a58d523ad1cd73
- proof amount: 0.001 USDC
- proof block: 52067063
- manifest: https://pa-entity-x402.floot.app/.well-known/x402
- contact: github:P00NSMASHER

The seller record was preflighted against the current upstream ForgeMesh validator. Result: 95/100 (excellent), payability 40/40, reliability 20/20, interoperability 20/20, discoverability 15/20, proof verified.

No seller-funded transaction was created for this submission.
```

## Upstream preflight

Receipt:

`verification/forgemesh-pa-entity-preflight-latest.md`

Current result:

- validation: PASS
- provisional score: **95/100**
- payability: 40/40
- reliability: 20/20
- interoperability: 20/20
- discoverability: 15/20
- protocol: x402 valid
- network detected: `eip155:8453`
- proof: verified, **0.001 USDC**, Base block **52067063**

## Proof classification

ForgeMesh's schema uses:

- `payer_kind=self` when the seller operates the payer wallet
- `payer_kind=customer` when an independent payer wallet paid

The proof payer is external to the seller payout wallet and is not present in this repository's internal/test payment history, so the prepared ForgeMesh record uses `payer_kind=customer` under ForgeMesh's binary taxonomy.

That classification is **not** the same as this project's revenue accounting. Internally, the payer remains `external_unattributed` because current evidence does not distinguish an end-customer agent from an independent verifier/probe. The settlement therefore remains excluded from verified-customer revenue.

## Current transport blocker

ForgeMesh documents two submission paths:

1. zero-cost GitHub fork + one-file PR
2. paid submission endpoint at $0.05 USDC

The connected GitHub integration can create PRs but exposes no repository-fork action, and no installed `P00NSMASHER/x402-verified` fork currently exists.

Under the standing $0-additional-spend rule, do **not** use the $0.05 submission endpoint.

If a writable fork becomes available later:

1. create a branch from the fork default branch;
2. add only `sellers/pa-entity-lookup-x402.json`;
3. open the PR against `forgemeshlabs/x402-verified:main`;
4. use title `Add PA Entity Lookup x402 🤖🤖🤖`;
5. verify CI stays green;
6. do not claim ForgeMesh Paid unless ForgeMesh itself later purchases the service.
