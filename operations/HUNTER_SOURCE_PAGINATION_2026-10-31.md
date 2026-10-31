# Hunter Network 2.0: Socrata page-boundary hardening (2026-10-31)

**Owner:** Source Hunter A, PermitPlate. **Scope:** read-only NYC/NY public-data observer, no production deployment, payments, customer records, or scheduling changes. **Starting main:** `680613b7b608c1b4e434eb7f112605e9a718cf11`.

## Reproducible defect and impact

`operations/socrata-observer.js` obtains an independent `count(*)`, requests a bounded `$limit`, and then appended every returned row without checking whether the response respected that limit. A mock publisher returning **two rows to a `$limit=1` request, while reporting `count(*)=2`**, was classified `COMPLETE_NONEMPTY` with `supportsAbsenceConclusion=true`. This erroneously allowed absent-record conclusions despite a source-pagination contract violation.

After the guard, the same exact fixture is `SOURCE_UNAVAILABLE` with no accepted rows and `supportsAbsenceConclusion=false`. A later oversized page retains only the prior verified prefix and returns `PARTIAL` with absence unauthorized. Normal compliant pagination remains unchanged. No actual publisher violation or customer impact has been observed; the failing scenario is synthetic adversarial evidence, **not** a report of an NYC source incident.

## Source scan and licensing

| External project (immutable source ref) | License / dependency and maintenance evidence | Decision |
|---|---|---|
| [Ajv](https://github.com/ajv-validator/ajv/tree/f177fe323420ccb23e1a79445fd470cbf80aee7c) | MIT [LICENSE blob `139162ad2c389a18d3d66e159a2821b2e40087fc`](https://github.com/ajv-validator/ajv/blob/f177fe323420ccb23e1a79445fd470cbf80aee7c/LICENSE); package `8.20.0`; 4 declared direct runtime dependencies; reference commit 2026-04-24. | Not imported; a single invariant needs no generic validation engine. |
| [Zod](https://github.com/colinhacks/zod/tree/2554b70c3d4a80273381e61d527d820720626440) | MIT [LICENSE blob `c06579627b432d09779094cd0166b7f37fe51db8`](https://github.com/colinhacks/zod/blob/2554b70c3d4a80273381e61d527d820720626440/LICENSE); package `4.6.7`; no declared direct runtime dependencies in `packages/zod/package.json`; reference commit 2026-10-30. | Not imported; avoids extra dependency and a cross-project schema migration. |
| [Socrata soda-js](https://github.com/socrata/soda-js/blob/main/package.json) | Historical `0.2.4`; MIT stated inside package metadata, standalone LICENSE not found; older `superagent ^3.7.0` and `eventemitter2 ~0.4.14`. | Rejected as unnecessary/stale; standalone license file not verified. |

No external source code copied. No packages or lockfiles changed. GitHub API security-advisory endpoint was not available through the connected read interface, so absence of historical advisories is **not** claimed; no new dependency exposure was introduced.

## Validation and release protocol

- Add three fail-closed adversarial tests in `operations/socrata-observer.test.js`: over `$limit`, oversized continuation, and over `count(*)`. Existing valid full-scope, zero-count, partial, redirect, and stale-source tests remain in place.
- Run `node operations/socrata-observer.test.js`, `node pipeline/socrata-reader.test.js` and the protected `permitplate-core-required` pull-request workflow. **Only CI results actually returned by GitHub count as full repository acceptance.**
- Review potential false positives on API-proxy versions that violate `$limit`; reverting the source branch/PR restores old behavior, but weakens evidence safety.

## Engineering-time estimate and follow-ups

Estimated **1–3 engineer-hours avoided** per future debugging incident involving malformed pagination, by eliminating manual count/receipt tracing and adding deterministic reproduction. **Estimate only, not measured savings**; if no such incident occurs, realized savings may be zero.

Next: independently test empty/count consistency under concurrent source mutations, then investigate stable-key pagination for large mutable datasets as separate opt-in work. Do not assume these are solved by the present patch. This candidate is separate from PR #152, which changes public checkout/trial behavior.

**Revenue impact:** no additional paying customers, settlements, or incremental net revenue verified.
