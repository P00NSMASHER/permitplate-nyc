# PermitPlate launch repair and TEST customer walkthrough

Base: `8ae63673c6738cc5d17f2d93d26bab31393e49ca`. Verified October 27, 2026.

The source-conflict repair passed the actual curated research pipeline on
current official data, including a second fresh scan against the same isolated
QA history. The equipment and POS customer walkthroughs used the actual report
renderer and trial lifecycle with explicit TEST judgments and provider events.
No real customer was enrolled, contacted or charged.

## Operational defect and repair

The previous private refresh failed with
`CONSTRUCTION_DUPLICATE_OR_INVALID_PUBLISHER_ROW`. A complete current DOB query
contained two records for `B00772431-A5` with different filing status/cost facts.
The original diagnostic rejected any repeated DOB ID before checking whether
the filing belonged to its selected restaurant research population.

The two records are not interchangeable. No row was chosen, renamed, merged or
deleted. The new private collision receipt retains both complete normalized
variants, their individual fact/record hashes and multiplicities, original
publisher counts, observation/raw-page evidence, and exact record-sequence
digest. Selected research only excludes an ID after proving non-use under the
[bounded collision contract](../operations/DOB_COLLISION_QUARANTINE.md).

This actual filing also appears twice as rejected co-location against
`CAMIS:50190952`. Both results say `corroborates:false`, `coLocated:true`,
`conflict:null`, and exactly `COLOCATED_ONLY` plus `NO_ENTITY_NAME_BRIDGE`.
The candidate has DOHMH-only source, material and category evidence, and no
accepted corroboration. The entire rejection objects remain unchanged as
negative evidence. Any selected, affirmative, unknown, malformed, historical
or frozen reference still stops the run with `REVIEW`.

## Real source execution

Initial captured source observation: **2026-10-27 14:14:38.706 UTC**.
Second fresh product execution: **2026-10-27 14:22:52.527 UTC**.

| Official source | Publisher rows | Fetched rows | Scope |
| --- | ---: | ---: | --- |
| NYC DOHMH `43nn-pn8j` | 5,335 | 5,335 | Uninspected placeholders or pre-permit inspections from September 27 |
| NYC DOB NOW `w9ak-ipjd` | 5,821 | 5,821 | `filing_date >= '2026-10-13T00:00:00.000'` |
| NY SLA `f8i8-k2gm` | 2,959 | 2,959 | Current pending applications |

All three sources remained complete, fresh and fully paginated. Both runs
produced the same source graph digest, with **4,247 candidate restaurants**.
These are research candidates, not verified buyers or customer-ready leads.

The repaired current diagnostic retained **79 DOB research filings**, including
**36** with specific component/action wording. It quarantined **one ambiguous
ID containing two publisher rows**, removed **zero raw rows**, and retained the
two typed negative co-location references. The independent research queue had
214 items and identity triage 51 hypotheses; none became an authorized identity
bridge or a customer report.

The real second refresh returned `NO_NEW_ENTITIES`, with zero invented new
observations or material events. Internal V4 research validation passed:
336 dateable candidates, 3,729 unknown-date held, and 172 suppressed. Customer
scored-lead authorization remained false. The separate historical V3 promotion
canary was not modified or satisfied by this repair.

The clean-room QA frozen reference was created from the first actual snapshot
and preserved on the second scan: its original observation remained 14:14:38 UTC,
with 55 reviewer and 24 separately reserved source cases. This is a local QA
archive, not the existing production archive. No private production state or
original scoring holdout was accessed or altered.

## Customer walkthroughs and findings

Both scenarios use synthetic `example.com` vendor recipients and four genuine
Manhattan public records: MIZNON, LITTLE PINE, KEVIN AND GABRIELLA PIZZA AND
RESTAURANT INC, and TMK WAGNER PARK LLC. Original business fields, addresses,
source dates and official links are copied from the captured graph. The entire
monitoring timeline, owner assessments, provider events and upgrade decisions
are fictional and visibly labeled.

Each scenario exercises a two-signal starter brief and a distinct two-signal
weekly report. No-matches leaves the clock dormant; an early update is rejected;
the second report does not extend the fourteen-day expiry; previously delivered
keys are not repeated; TEST review input is rejected before LIVE preparation.
HTML subjects/bodies identify TEST SIMULATION, and CSV rationale/next-step text
identifies TEST. Actual trial report rendering now also displays the no-card,
no-auto-upgrade terms and separate optional $79/month membership.

| TEST persona | Rendered-content assessment | Simulated decision |
| --- | --- | --- |
| Kitchen-equipment supplier | Public fields and territory match; uncertainty and next steps are clear. Applicant/licensing context does not prove equipment specifications, procurement timing or an unfilled order. | Defer until category-specific value is established |
| POS reseller | Public fields and territory match; uncertainty and optional upgrade are clear. Restaurant activity alone does not establish a POS installation/replacement need or decision maker. | Decline generic context |

The walkthroughs do not manufacture positive customer feedback. They expose
the distinction between correct source processing and a commercially useful
category match. No measured satisfaction, conversion, independent source
judgment, buyer precision or genuine review agreement is asserted.

The admission runbook explicitly requires a useful, documented rationale for
the requested category and territory. Otherwise the operator holds the request
or returns no matches and leaves the trial clock dormant. This does not require
an exact keyword or permit invented buying intent. A final rendering polish
removes duplicated punctuation after the founder rationale; the original
reviewed claims, source facts, CSV bytes and negative persona decisions remain
unchanged.

The simulation produces four readable HTML briefs, four CSV files, an aggregate
README and detailed JSON receipt in a new private directory. The committed
`nyc-launch-repair-receipt-2026-10-27.json` contains source scopes, observations,
hashes, conflict counts, file hashes and explicitly synthetic assessments. It
contains no real customer or private operational state.

## Verification

- The reviewed source-repair commit passed **288/288 Node regression tests** using the documented sequential
  product suite, including seven collision tests, eleven trial tests and two
  rendered-customer-simulation tests.
- **89/89 Python policy tests passed**.
- The final admission/punctuation polish separately passed the founder offer,
  eleven trial lifecycle, two rendered simulation and curated product suites;
  all four HTML walkthroughs and their receipt hashes were regenerated.
- Both publication builds and existing source, frozen-reference, paid billing,
  calibration and transport tests remain covered by those suites.
- Independent review replayed the captured real conflict and the simulation,
  confirmed the complete raw count/selected-case preservation, checked publisher
  order independence, and verified that an injected prior-history reference
  returns `REVIEW`.

The initial restricted-sandbox suite could not spawn five Node subprocess
fixtures (`EPERM`). The same unchanged test suite passed with approved local
subprocess permission. That environment restriction was not reclassified as a
product pass or fixed by weakening any test.

```sh
node --test --test-concurrency=1 model-v7.test.js build-site.test.js build-standalone-site.test.js operations/*.test.js pipeline/*.test.js trial-request.test.js
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -p 'test_*.py'
node pipeline/run-curated-research.js /private/qa/state/curated-research-ledger.json /private/qa/state/current-source-graph.json
node pipeline/trial-customer-simulation.js /private/qa/state/current-source-graph.json /private/new-test-simulation
```

This execution environment needed `NODE_USE_ENV_PROXY=1` and approved public
network access for live source requests. No production customer/provider or
payment credentials were used.

## Final release check

Require a successful exact-main curated refresh against the **existing private
production history** after publication. A genuine production-only historical
reference must still keep a conflicting filing held. Local QA cannot establish
that separate state condition. Synthetic reviews exercise the product; they do
not replace genuine source adjudication, owner sending authorization or actual
customer usefulness evidence.
