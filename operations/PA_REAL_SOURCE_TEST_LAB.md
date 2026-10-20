# PA real-source acceptance lab — October 20, 2026

This bounded test fixture is **real government data**, not customer data. It contains **30 reference rows from Pennsylvania's official municipal UCC elections registry** and **23 actual Philadelphia Licenses & Inspections permit references**, including issued, completed, expired and amendment-incomplete cases.

Sources:
- PA Department of Labor and Industry municipal election registry: https://www.pa.gov/content/dam/copapwp-pagov/en/dli/documents/individuals/labor-management-relations/bois/documents/uccmun.htm
- State opt-in/out explanation: https://www.pa.gov/agencies/dli/programs-services/labor-management-relations/bureau-of-occupational-and-industrial-safety/uniform-construction-code-home/municipal-elections-and-contact-information
- Philadelphia official building permit open data: https://opendataphilly.org/datasets/licenses-and-inspections-building-and-zoning-permits/
- Philadelphia official public property and contractor permit pages (exact links are in `verification/pa-official-ucc-permit-samples.json`).
- City of Pottsville permit office: https://www.pottsvillepa.gov/html/cenforce.htm

## Isolation / interpretation

**NOT live paid orders.** No actual subscriber, payer, owner or personal property information is imported into private checkout state. Public building-permit numbers never become Checkout Session IDs, purchaser identity, product orders, approved permit reports or validated company leads. The example transactions and project scopes used by the product's separate synthetic tests remain synthetic.

The municipal UCC rows preserve **county, jurisdiction name, municipality type, OPT-IN/OPT-OUT and historical amendment flags**. Do not collapse municipality type: Pine Grove Borough and Township in Schuylkill County have different flags; Menallen Township in Adams is OPT-OUT while Menallen Township in Fayette is OPT-IN. OPT-OUT commercial UCC enforcement may fall under PA Department of Labor & Industry, while zoning and special jurisdiction exceptions still require separate checks. Real customer advice requires independent current source and parcel-to-municipality verification.

Permit records deliberately distinguish `issuedDate` from `currentStatusAsDisplayed`. `null` means **unknown/unverified status**. Multiple permits at one Philadelphia address do not prove they belong to the same reviewed project or that work is currently active.

## Run actual product diagnostics

```sh
node pipeline/pa-public-evidence-replay.test.js
```

This invokes the **actual** PermitPlate `pa-permit-orders.projectHealth` and `pa-permit-fulfillment.researchErrors` implementations. It verifies fixture uniqueness, coverage, permit ID format and source integrity while recording known negative-control weaknesses. It cannot constitute human, legal, permit or delivery acceptance.

### Reproducible gaps exposed

- Current text-based `projectHealth` is permissive: it accepts plausible but wrong county/municipality combinations and under-specified municipality names (the test intentionally documents five negative controls). **A true county + type + boundary + current UCC jurisdiction resolver is not yet implemented.**
- Source URLs, government election status and public permits do not automatically prove the project location, current ordinance, service fee, occupancy, permit approval, purchase intent or delivery.
- No genuine paid customer, actual private case review, or independently verified delivered report was present in this source pack.

**Do not change those known gaps into passing jurisdiction claims.** Build a separate, independently verified statewide jurisdiction matcher and reject ambiguous input before releasing it commercially. Preserve the existing founder QC and no-send gates until then.

The fixture is selected public rows rather than a statistically representative holdout. No estimate of statewide accuracy should be inferred.
