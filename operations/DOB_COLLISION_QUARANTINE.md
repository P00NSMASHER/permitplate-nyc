# DOB source collisions and bounded research quarantine

This handling applies only to the private current construction diagnostic. It
does not change official-source queries, publisher counts, pagination, source
observations, raw fact fingerprints, graph construction or customer eligibility.
An ambiguous filing never receives an authoritative status or a new identity.

The official DOB NOW dictionary calls the job filing number a unique filing
identifier and the filing status the current application status. The October 27
publisher snapshot nevertheless contained conflicting rows for `B00772431-A5`.
Neither the dictionary nor the available evidence establishes permission to
choose one row, append a new key, prefer an approval or infer purchasing demand.

## Allowed exclusion

`dob-source-collisions.js` groups the complete, unchanged normalized source rows.
Every duplicate ID, including identical duplicates, remains absent from the
diagnostic lookup. It can be quarantined outside the diagnostic only when:

1. Every variant has a valid source-observation binding, identity and fact hash,
   known premises/date and a nonblank full description. Every variant lacks all
   of the existing restaurant-research terms. An unknown or relevant variant
   holds the entire collision regardless of publisher order.
2. The current independent and identity queues are complete. The ID and its job
   family are absent from all selected, accepted, material/category, unknown,
   historical and frozen source-case references. Object keys, source IDs and
   encoded URLs are checked; caller-filtered review items are insufficient.
3. The only permitted negative context is an **exactly typed rejected-only
   co-location** in the current public graph: `corroborates:false`,
   `coLocated:true`, `confidence:LOW`, `conflict:null`, and exactly
   `COLOCATED_ONLY` plus `NO_ENTITY_NAME_BRIDGE`. Its source URL and record shape
   must match the existing graph contract. The candidate must have only DOHMH
   source systems, no accepted corroboration, and valid DOHMH-only material and
   category evidence. The complete rejection remains unchanged. A missing,
   additional or contradictory proof returns `REVIEW`.

The third case is evidence of **non-use**, consistent with existing
`independent-source-review`, `identity-bridge-review`, `category-evidence` and
`material-change` contracts. It does not turn a rejected relationship into an
accepted one. An independent-history, prior identity, prior diagnostic or frozen
source-panel reference still prevents quarantine even if current co-location
was rejected. No reviewer judgments or scoring holdout files are used to make
this decision.

## Evidence retained

The current private `construction-validation-panel.json` includes a sealed
`sourceCollisionReceipt`: the original observation and raw-page hashes, exact
publisher/fetched counts, a digest of the original record sequence, all
ambiguous normalized variants and multiplicities, their fact/record hashes,
the complete typed negative references, and explicit disposition/reasons.
The canonical decision fingerprint is independent of publisher row order;
the separate original-sequence fingerprint intentionally preserves that order.
`rawRowsRemoved` is always zero. Graph rejection objects and all source batches
remain unchanged.

The previous guard conflated any duplicate anywhere in the rolling DOB query
with a duplicate selected research case. This repair permits clean selected
research to continue while preserving the source dispute. Selected, referenced,
relevant, incomplete or unprovable ambiguities continue to return `REVIEW`.

The existing frozen reviewer/audit archive, independent review requirement,
70/30 scoring calibration firewall, customer source review and transport gates
are unchanged. Synthetic opinions cannot satisfy those requirements. The
historical V3 scored-customer canary remains separate from founder-curated
no-score launch readiness.

## Verify

```sh
node pipeline/dob-source-collisions.test.js
node pipeline/construction-validation-panel.test.js
node pipeline/construction-blind-diagnostic.test.js
```

Before operational acceptance, require a successful exact-main private curated
refresh against the existing production state. Clean-room local QA cannot
prove what references are present in a separate production history; a genuine
historical reference may correctly keep that refresh held.

Sources:

- [Official DOB dataset](https://data.cityofnewyork.us/d/w9ak-ipjd)
- [Official data dictionary](https://data.cityofnewyork.us/api/views/w9ak-ipjd/files/978bdfe8-11c3-4839-9515-7f36a83e219d?download=true)
- [Official filing lookup](https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=B00772431-A5)
