# AppDeploy deployment handoff

This document defines the boundary between the verified x402 Product Factory release bundle and the final AppDeploy-specific backend entrypoint.

## Verified factory side

The factory can now generate a self-contained **ES module** runtime artifact:

`factory-runtime-bundle.js`

It is generated from the CommonJS factory runtime graph by:

`factory/scripts/build-appdeploy-runtime-bundle.js`

The generated ESM exports:

- `createFactoryRuntime`
- `defaultAdapters`
- `PREFLIGHT_HEADERS`
- `createAppDeployRouteMap`
- `STATIC_GET_PATHS`
- `bundledModuleIds`

CI dynamically imports the generated ESM file, constructs the factory runtime, builds the AppDeploy route map, and verifies an unpaid paid-route request returns HTTP 402.

The release bundle now includes `factory-runtime-bundle.js`, and `release-manifest.json` records:

- runtime file name
- SHA-256
- bundled module count
- runtime entry modules

This binds executable runtime code to the same candidate release as the generated x402 catalog, OpenAPI, product index, and llms text.

## Current staged route shape

The portable runtime publishes:

- static factory health/discovery routes
- one GET paid route per staging product
- one OPTIONS route per staging product

The deploy-candidate validator requires the runtime product list, release manifest, catalog, OpenAPI, and route map to agree exactly.

## Final AppDeploy entrypoint boundary

The final AppDeploy backend entrypoint should be intentionally thin:

1. import `router` from `@appdeploy/sdk`
2. import `createFactoryRuntime` and `createAppDeployRouteMap` from the generated ESM runtime bundle
3. resolve the production public API base URL
4. resolve required deployment environment/secrets
5. create the factory runtime
6. export `router(createAppDeployRouteMap(runtime))`

Do **not** copy individual Product Factory decision/source/payment implementations into `backend/index.ts`.

That would recreate the drift the factory is intended to eliminate.

## SEC deployment prerequisite

Products 006 and 013 require:

`SEC_USER_AGENT`

It must contain:

- a declared client identity
- a real contact email

The factory preflight deliberately blocks deployment when that prerequisite is missing or does not contain a contact email.

No personal contact identity is invented or embedded by the factory.

## Secret-binding syntax remains intentionally unresolved

The current production AppDeploy project is ESM-based (`"type": "module"`) and uses `backend/index.ts`.

The factory ESM bundle solves the CommonJS/ESM runtime packaging problem.

However, the exact AppDeploy-supported mechanism for binding `SEC_USER_AGENT` into the final backend entrypoint must be confirmed from current AppDeploy deployment/secret instructions before deployment.

Do not assume `process.env.SEC_USER_AGENT` or any other secret API until the current AppDeploy instructions are available.

## Current provider blocker

AppDeploy reported the Free-tier weekly reset as:

`2026-10-05T00:00:00Z`

No paid upgrade or credit purchase is authorized.

Until that blocker clears:

- generate/test release candidates in GitHub
- do not claim Products 003–017 are deployed
- do not weaken the SEC prerequisite to force a deployment
- do not reintroduce nested calls to seller-owned AppDeploy component APIs

## Reset-day sequence

1. Confirm AppDeploy deployment credits/app usage are available.
2. Read current AppDeploy deployment instructions.
3. Read current AppDeploy secret-binding instructions.
4. Bind a user-approved `SEC_USER_AGENT` with contact email.
5. Generate a release bundle using the actual public API base.
6. Verify `release-manifest.json` runtime SHA against `factory-runtime-bundle.js`.
7. Use the generated ESM runtime bundle behind a thin AppDeploy `router` entrypoint.
8. Run the factory deploy-candidate preflight with the actual environment.
9. Deploy.
10. Poll AppDeploy status through terminal state and inspect QA/errors.
11. Verify every unpaid paid route returns its exact HTTP 402 challenge.
12. Verify discovery surfaces list every staged product with resource-level `accepts[]`.
13. Verify existing production-reference Products 001 and 002 remain unchanged unless the deployment plan explicitly migrates them.
14. Only after production verification begin external marketplace submission.
