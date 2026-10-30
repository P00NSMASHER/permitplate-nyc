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

This invokes the **actual** PermitPlate `pa-permit-orders.projectHealth`, `pa-jurisdiction-identity.assess` and `pa-permit-fulfillment.researchErrors` implementations. It verifies fixture uniqueness, coverage, permit ID format and source integrity; five earlier false-admitted known-name county/type examples are now rejected for project clarification. It cannot constitute human, legal, permit or delivery acceptance.

### Reproducible gaps exposed

- The source-selected `pa-jurisdiction-identity` check now rejects the **five previously reproduced** wrong-county or ambiguous municipality-name controls. It compares **32 distinct official public municipal election reference rows** across two sanitized reference packs; it does not cover every Pennsylvania jurisdiction. **Actual parcel boundary geocoding, all 2,562 municipal elections, current ordinance and building-code-official authentication are still not implemented.** Unknown municipality names are not declared wrong by this partial sample and must receive genuine human current-source review before a customer report.
- Source URLs, government election status and public permits do not automatically prove the project location, current ordinance, service fee, occupancy, permit approval, purchase intent or delivery.
- No genuine paid customer, actual private case review, or independently verified delivered report was present in this source pack.

**Do not report these sample-backed text checks as a statewide jurisdiction match.** Expand to an independently verified entire 2,562-municipality registry, determine parcel boundaries and independently recheck current authority before any positive jurisdiction claim. The founder QC, private-case and no-send gates remain in force.

The fixture is selected public rows rather than a statistically representative holdout. No estimate of statewide accuracy should be inferred.
