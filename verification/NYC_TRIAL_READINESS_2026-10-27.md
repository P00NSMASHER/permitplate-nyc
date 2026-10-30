# PermitPlate source validation and free trial foundation

Evidence observed October 27, 2026, 09:37–09:38 Eastern. Source baseline:
`5445686a3c0a9b3a3c4822934b0faa1f3c76b36d`. The accompanying changes repair the
readback verifier and add the bounded trial workflow; they do not change the
upstream source query or claim a customer outcome.

## Current official data

The actual product's `nyc-real-world-acceptance.js` fetched and replayed all
records in its documented scopes, with current metadata, publisher counts and
closed pagination:

| Official source | Current rows fetched | Scope |
| --- | ---: | --- |
| [NYC DOHMH 43nn-pn8j](https://data.cityofnewyork.us/resource/43nn-pn8j.json) | 5,335 | Uninspected placeholder applicants and past-30-day pre-permit inspections |
| [NYC DOB NOW w9ak-ipjd](https://data.cityofnewyork.us/resource/w9ak-ipjd.json) | 5,821 | Filings from the previous 14 days |
| [New York SLA f8i8-k2gm](https://data.ny.gov/resource/f8i8-k2gm.json) | 2,959 | Current pending applications |

The current graph contained 4,247 restaurant candidates; 172 were suppressed.
Of these candidates, 3,918 had the DOHMH 1900 inspection placeholder. Their
recent dataset extraction dates are **not** verified application or opening
dates. The graph also contained 75 invalid borough values and one missing name;
those counts prevent treating the raw graph as a qualified customer lead list.
One DOB source identity appeared twice among the fetched rows. Row counts are
not distinct restaurants or distinct opportunities.

The source-only DOB construction kit contained 36 filings, 35 job families and
34 borough/address pairs. The repaired `nyc-dob-filing-readback.js` then made
36 separate official API requests. All 36 matched the exact filing identity,
filing date, filing status and description excerpt. This is a separate API
readback, not a separate human's assessment of buying intent.

## Repairs exposed by review

The second-readback verifier previously returned success for an empty kit,
duplicate cases, or a future snapshot relative to verification. It now rejects
all three before making any request, and validates calendar timestamps.
Regression cases reproduce each defect. Empty source evidence cannot support a
successful real-world validation claim.

## Trial behavior tested

The trial lane reuses the paid curated source/review contract without creating
a fake paid subscription. Tests cover source incompleteness, category evidence,
review identity, stale source data, five-item and ten-business caps, exact
recipient/content/authorization bindings, duplicate businesses and deliveries,
first-delivery activation, a fresh weekly update, the two-report stop, expiry,
cancellation, later bounce hold and private atomic state updates.

The public page prepares an explicit email draft, with a manual-copy fallback.
It cannot create billing, send a message, or enroll a business. Both GitHub
Pages and standalone Cloudflare builds include only the public request assets;
private state and backend code remain outside their allowlists.

Synthetic customer and provider fixtures test lifecycle control behavior. They
are marked TEST and do not count as actual customer approval, authenticated
production mail, paid conversion or independent demand validation.

## Reproduce

```sh
node --test --test-concurrency=1 model-v7.test.js build-site.test.js build-standalone-site.test.js operations/*.test.js pipeline/*.test.js trial-request.test.js
node pipeline/nyc-real-world-acceptance.js /private/nyc-source-report.json
node pipeline/nyc-dob-filing-readback.js /private/nyc-source-report.json /private/nyc-source-readback.json
```

Use new output filenames because evidence files are never overwritten. This
execution environment required Node's `NODE_USE_ENV_PROXY=1` and approved
read-only network access; the first unproxied attempt correctly failed closed
with unavailable sources. No failure was reclassified as an empty dataset.

See `nyc-trial-source-receipt-2026-10-27.json` for exact timestamps, source
observations, scope hashes, counts, readback results and full-report hashes.

## Remaining customer proof

No customer was enrolled or contacted. No report was sent and no charge was
created. The tests establish software/source behavior, not finalized commercial
readiness. Real founder assessment, authenticated provider delivery and customer
feedback still have to occur within the supervised pilot. Verified public rows
are never described as verified buyer needs or guaranteed restaurant openings.
