# Hunter Network 2.0: Calendar-valid source evidence (2026-10-31)

**Owner:** Revenue Source Hunter A, PermitPlate. **Canonical code:** `P00NSMASHER/permitplate-nyc`, starting `main` `7cc9b1dd98e3ac00d00d4bcef856993237277751`. **Scope:** read-only delivery-snapshot evidence checks, no source fetches, checkout, customer sends, deployment, or new dependencies.

## Reproduced baseline and repair

The existing `validIsoDate` accepted any `YYYY-MM-DD` shape. Executing the actual unmodified `validateSnapshot` module in a bounded JavaScript harness with a complete 1-venue graph, matching staging graph, matching lead queue, matching DOB source event, all valid scores and empty delivery state returned `passed: true` for both **2026-02-30** (impossible) and **2026-03-02 → 2026-03-01** (backwards). A valid **2024-02-29 → 2024-03-01** control also passed. These are synthetic adversarial inputs; no corrupt customer reports are asserted.

Repair: parse strict ISO day strings as **UTC**, require exact year-month-day round-trip, and reject `Latest Signal Date < First Signal Date` for otherwise-valid dates. This blocks invalid dates from being marked verified source evidence, while preserving valid leap days and day-equal cases. The full snapshot contract and public-facing behavior otherwise remain unchanged.

Local precommit invariant harness of the exact patched module: **11/11 date cases** met expected classification (three valid, seven calendar-invalid, one inverted chronology). The repository's required GitHub workflow is the authoritative full-suite result.

## Two source candidates reviewed, neither imported

| Candidate | Verified source and license | Engineering fit |
|---|---|---|
| [Day.js](https://github.com/iamkun/dayjs/tree/436bde0bcded312781cbe45dc2b0ef079a36d8e3) | MIT [LICENSE](https://github.com/iamkun/dayjs/blob/dev/LICENSE), maintained (repository updated September 15, 2026), release [v1.11.23](https://github.com/iamkun/dayjs/releases/tag/v1.11.23) August 17, 2026. | Mature date handling, but package/parser integration introduces unnecessary dependencies for one UTC calendar invariant. |
| [Luxon](https://github.com/moment/luxon/tree/f427515a38f6a671f8de663e6bcc040ed81f114e) | MIT [LICENSE.md](https://github.com/moment/luxon/blob/master/LICENSE.md), maintained (repository updated August 9, 2026). | Rich timezone APIs unnecessary for source dates that contain no time or zone. |

Decision: **native JavaScript `Date` with exact UTC round-trip**, independently written. No third-party source copied, no package/lockfile additions, no attribution obligation created. Because neither dependency was installed, no new transitive licenses or package advisories are introduced. The public GitHub API read route did not verify complete advisory histories; absence of historical vulnerabilities is not claimed.

## Test, ownership, rollout, and impact

- `node operations/delivery-verifier.test.js` adds a validated end-to-end snapshot fixture; **seven impossible dates**, **three valid dates including century leap edge**, and **one inverted interval** explicitly checked.
- Existing offline workflow `permitplate-core-required` is the real CI acceptance gate. Verify exact head results; do not infer passing status.
- PR #152 owns public paid-checkout code and does not overlap these `operations/delivery-verifier*` paths.
- Issue #154 documents that **operations-only merges may still trigger Cloudflare Pages automatic deployment**. Keep this PR draft and unmerged until deployment behavior is independently reconciled. Do not bypass protected main, reset or assume a production observation.
- Rollback: close the isolated PR or revert the two verifier files before any permitted merge; no schema or state migration is needed.
- Estimated future engineer time avoided: **0.5–2 hours per incident** involving impossible source dates by keeping contradictory calendar evidence out of the delivery queue. Hypothetical, not measured; realized savings may be zero.
- **Commercial results:** zero new attributable paying customers or income measured from this patch.

Next: inspect ambiguous duplicate CSV headers as a separate independent source-evidence defect; do not weaken source-state controls, real-money gates, or privacy guards.
