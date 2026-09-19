# PermitPlate Business Model V7
Updated: 2026-09-19

## Product definition
PermitPlate is a public change-intelligence product for B2B sales teams.

The unit of value is not a permit row or "lead." It is an evidence-backed material change attached to the correct real-world business/project, scored for the buyer's service category and delivered with source lineage.

Current production market: NYC restaurant vendors.

## Current offer
### NYC Restaurant Watch — $79/month
- Current self-serve Stripe offer.
- DOHMH core with conservatively matched current/relevant NY SLA and NYC DOB evidence.
- Post-baseline new or materially changed signals.
- Vendor-specific prioritization.
- Why Now, Watch Next, identity confidence, evidence strength and source lineage.

### Founder-reviewed Custom Territory Pilot
- Used to validate a new service category, territory, public-source combination or buyer workflow before automating it.
- Scope/price agreed before work begins.
- No market is described as production coverage until source rights, freshness, matching precision and buyer usefulness are validated.

## Ideal customer
A local or regional B2B sales team that:
1. sells into businesses/projects before opening or during buildout/change,
2. can make meaningful gross profit from one customer,
3. currently pays reps to research public records, drive territories, or discover projects manually,
4. has a defined service territory and category,
5. benefits from being early rather than simply having a larger list.

Initial NYC categories: POS/payments, Insurance, Equipment, Hood/Fire, Waste, Pest, Linen, Distribution.

## Value proposition
"Tell me what materially changed in my territory, why it matters to what I sell, and show me the public evidence."

This is intentionally different from:
- generic business directories,
- raw permit feeds,
- scraped lead lists,
- purchase-intent claims,
- opaque AI lead scores.

## Product moat
1. Stable entity/project identity across changing public records.
2. Conservative entity resolution that fails closed on ambiguous joins.
3. Append-only source-event lineage.
4. Material-change/reopen logic.
5. Vendor-specific deterministic scoring.
6. Observed Facts vs PermitPlate Inference.
7. Customer feedback dispositions without hidden black-box retraining.
8. Versioned market/source models so each city/vertical can be audited separately.

## Expansion strategy
Do not expand because a dataset exists. A new market must pass:
- public-source rights / permitted use review,
- source freshness and availability test,
- normalized schema,
- entity-resolution benchmark,
- material-change replay corpus,
- false-join review,
- buyer-specific scoring rules,
- at least one sample Opportunity Brief that is meaningfully better than raw source browsing,
- evidence of willingness to pay or repeated workflow use.

## Validation metrics
Primary:
- % delivered signals marked Investigate,
- % Already knew,
- % Irrelevant,
- % Watch,
- correction / false-join rate,
- materially changed signal rate,
- source verification failure rate,
- subscriber retention / repeat-pilot intent.

Secondary:
- time from public event to PermitPlate detection,
- number of source systems per entity,
- proportion of signals reopened by new evidence,
- CSV/CRM export usage,
- revenue per monitored territory/category.

## Pricing logic
Keep the $79/month founding NYC feed aligned with the existing Stripe product while validation continues.
Use custom founder-reviewed pilots for higher-value or new-market buyers before building self-serve expansion.
Team/multi-territory pricing should be introduced only after customer usage proves the workflow and the source model can support the promised coverage.

## Current strategic constraint
The production intelligence engine still needs to move from automation-prompt orchestration into deterministic, versioned application code with replay tests, migrations, deploy hashes and canary mode. The website and model specification must not claim a level of automation, market coverage or precision that production has not proven.
