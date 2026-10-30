# PermitPlate PA — Real Public Government Evidence Benchmark

**Reference frozen:** October 20, 2026  
**Lane:** Offline official-source research and project-data validation only.

The corpus in `pipeline/pa-real-official-evidence.json` contains **27 distinct public-government reference cases** pointing to **nine original government documents or pages**. It does **not** contain real customer submissions, customer contact data, Stripe Checkout Sessions, provider delivery receipts, permit approval predictions, or independent human-adjudicated labels.

## Source groups and proper interpretation

| Cases | Original source | What a reviewer may conclude | What is NOT established |
|---|---|---|---|
| 9 municipal elections | [PA DLI official UCC municipal election registry](https://www.pa.gov/content/dam/copapwp-pagov/en/dli/documents/individuals/labor-management-relations/bois/documents/uccmun.htm) | Opt-in/opt-out decisions and older local amendment indicators for specifically keyed county + municipality + type | An address belongs to that municipality; current building code official; actual permit issuance |
| 7 historical issued/revision references | [Philadelphia Historical Commission, March 2026 permit review log](https://www.phila.gov/media/20260409111118/Mar-2026-PHC-permit-log.pdf) | Historical permit IDs, work descriptions, and status **as reported April 8, 2026** | Current status in October; project needs a new permit; a business is purchasing |
| 8 public capital-project descriptions | [DGS forthcoming construction procurement notice, June 5, 2026](https://www.pa.gov/content/dam/copapwp-pagov/en/dgs/documents/design-and-construction/bidding/2026-document/notice%20of%20forthcoming%20construction%20procurements%20-%206-5-2026.pdf) | Publicly described facility and proposed work, including HVAC, structural additions, public-works drainage and institutional renovations | A street address, an issued building permit, approved scope, current bidding, or a paying customer |
| 1 blank municipal application | [City of Pottsville commercial permit form](https://www.pottsvillepa.gov/html/forms/CommercialBuildingPermitApplication.pdf) | Actual application categories/fields, restaurant assembly use and the distinction between proposed work and official fee assessment | Evidence that an applicant has filed or paid |
| 1 zoning case | [Pittsburgh BDA-2024-04976 public staff report](https://www.pittsburghpa.gov/files/assets/city/v/1/dcp/documents/zoning-board-of-adjustment/staff-report-for-case-164-of-2024-%E2%80%93-4746-plummer-st-pittsburgh-pa-15201.pdf) | Historical paused zoning review for sign-related site work | A valid/issued building permit or current approval |
| 1 code-change reference | [PA Department of Labor and Industry UCC site](https://www.pa.gov/agencies/dli/programs-services/labor-management-relations/bureau-of-occupational-and-industrial-safety/uniform-construction-code-home) | Updated 2026 UCC effective January 1, 2026; special continuing accessibility requirements | A blanket recommendation of a code edition or permit without facts about the project |

**Jurisdiction traps exposed by actual Pennsylvania records:**

- **Pottsville City / Schuylkill:** opt-in with amendments; official commercial form exists.
- **Mount Carbon Borough / Schuylkill:** opt-out. PA DLI generally handles its commercial UCC enforcement, rather than the nearby Pottsville office.
- **Pine Grove Borough vs Pine Grove Township / Schuylkill:** same name and county, different municipal types and amendment indicators. Never match by a name or ZIP alone.
- **Philadelphia City vs Pittsburgh City:** both opt-in, with distinct municipal permit systems.
- **State-owned buildings:** the PA DLI lists statewide jurisdiction for state-owned construction; a DGS project advertisement does *not by itself* prove title/ownership or confirm a building permit, so individual projects retain that uncertainty.

## Tested product invariants

Run:

```sh
node pipeline/pa-real-official-evidence.test.js
node pipeline/pa-permit-orders.test.js
```

1. Check source links are in the official government domain and reference cases are uniquely keyed.
2. Check that the state source registry distinguishes county, municipal name and type; opt-out is not mistaken for a local opt-in.
3. Put the actual historical Philadelphia address and scope text through **the production PA customer-project parser and `projectHealth` gate**. These are document-sourced examples, *not* paid customer input.
4. Ensure a state procurement notice containing only a facility name is **held** and cannot be substituted for an actual customer-supplied site address. A new conservative repair holds `TBD` or otherwise placeholder site descriptions; the user can clarify rather than losing a paid obligation.
5. Preserve issue statuses and conditions: `Applicant Revisions` is not `Issued`, and an issued March 2026 permit is not proof it remains issued without later changes.
6. Build an illustrative source-linked research packet with explicit `verifiedByHuman=false` and confirm the **production research/QC validator does not approve it**. Do not set human approvals to true in order to claim real-document accuracy.
7. Do not create or mutate a Stripe session, store a paid order, send a customer message, or release scored leads. This benchmark is deliberately independent of the paid onboarding and provider-acceptance tests.

## What this benchmark does NOT test

This is **not** an extraction-accuracy score for original PDF bytes. PermitPlate's PA product currently relies on real, separately reviewed project-source research rather than an independently labeled automatic PDF extraction engine. This fixture is a structured, traced reference subset from the official documents. No simulated human review is counted as real.

It is also **not an exhaustive census of the 2,562 municipalities** or of all issued permits. It is a purposely selected adversarial reference set. The full municipal table and complete original PDFs remain at their linked official sources; source records and statuses may change. The historical DGS notice is explicitly informational and may be revised.

**Remaining genuine acceptance:** independently recheck current sources for a real paid customer's project, verify the correct municipality and enforcement authority, have a genuine reviewer examine the finished report and required disclaimers, deliver through an authorized provider, and independently verify delivery/no duplicates. Do not claim these actions occurred on the basis of this corpus.

**Provenance:** Selected public government metadata and paraphrased source descriptions; no applicant/owner names, personal phone numbers, emails, private state, or raw PDFs committed.
