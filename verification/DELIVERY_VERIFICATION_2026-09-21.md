# PermitPlate delivery verification

**Run:** September 21, 2026, 1:47 a.m. America/New_York  
**Result:** **PASS — NO-SEND SHADOW DELIVERY**  
**Live customer delivery:** **Awaiting the first eligible subscriber**

PermitPlate's customer-artifact and duplicate-prevention path passed against the current committed operating workbook. Live Stripe contained zero subscriptions for PermitPlate's current $79/month price, so the correct production result was no customer email, no CSV transmission, and no Delivery State mutation.

## Verified today

| Gate | Result | Evidence |
|---|---|---|
| Live Stripe eligibility | PASS | 0 subscriptions, status=all, has_more=false, filtered to `price_1UFjcWDPW8riWrxQhnrPX6nc` |
| Workbook transaction parity | PASS | 62 live/staging Venue Graph rows match; 62 live/staging Leads rows match by unformatted values |
| Durable evidence | PASS | 82 unique Source Events; every planned signal has an exact source record ID and HTTPS source URL |
| Score and suppression invariants | PASS | All eight category scores are integers 0–100; Best Score is the category maximum; 59 HIGH/MEDIUM rows are eligible; 1 LOW and 2 EXCLUDE rows are suppressed |
| Delivery ledger safety | PASS | Delivery State contains only its header; zero delivery rows |
| Normal vs Starter policy | PASS | Normal and Starter sets are disjoint; Starter is capped at 10; combined report is capped at 25 |
| Customer personalization | PASS | All five required category, borough, and threshold profiles reproduced the expected selections |
| Email/CSV parity | PASS | Email signal order and CSV signal order match exactly for every profile |
| CSV safety | PASS | Commas, quotes, and newlines are escaped; values beginning with `=`, `+`, `-`, or `@` are neutralized |
| Determinism | PASS | Repeated planning produced identical signal keys, attempt IDs, artifacts, and combined fingerprint |
| Partial retry and second-run dedupe | PASS | A partial synthetic delivery retries only missing recipient/signal pairs; a completed second pass has zero pending pairs |
| Gmail composition | PASS — DRAFT ONLY | Gmail accepted an unsent owner-only multipart draft with the General-profile CSV attached; readback confirms `DRAFT` and `has_attachment=true` |

Combined five-profile fingerprint: `206564d056314caaffab6360a50be9c94540fad5e6c8bc0ce6df4533b7c5c67f`.

## Shadow profile results

| Profile | Normal | Starter | Total |
|---|---:|---:|---:|
| General NYC | 24 | 1 | 25 |
| Equipment — Brooklyn/Queens, score ≥65 | 3 | 4 | 7 |
| Waste — Brooklyn, score ≥60 | 1 | 0 | 1 |
| POS — Manhattan, score ≥60 | 6 | 9 | 15 |
| Hood/Fire — all NYC, score ≥70 | 2 | 0 | 2 |

These counts exactly reproduce the previously accepted post-calibration shadow results. No customer, restaurant, or prospect was contacted.

## Current official-source health

| Source | Current evidence | Status |
|---|---|---|
| NYC DOHMH `43nn-pn8j` | rows updated `2026-09-18T22:05:48Z`; latest inspection date in current metadata `2026-09-17` | Fresh under the 3-day gate |
| NY SLA `f8i8-k2gm` | rows updated `2026-09-21T00:35:51Z`; newest received date `2026-09-18T17:01:00` | Fresh under the 7-day gate |
| NYC DOB `w9ak-ipjd` | rows updated `2026-09-20T20:06:29Z` | Fresh under the 7-day gate |

The current official scan contains 3,798 never-inspected applicants and 315 deduplicated 30-day pre-permit episodes. Its largest applicant CAMIS is `50192635`, beyond the current workbook snapshot. Official source versions changed after the last committed generation, so a fresh complete graph/queue generation is required before any real customer report. This does not block today's verification because Stripe has no eligible recipient and no delivery was attempted.

## Predecessor-CAMIS fail-closed check

The current full exact-identity scan found four never-inspected applicants with a different CAMIS already in a recent operational pre-permit episode:

| Applicant CAMIS | DBA and location | Operational predecessor |
|---|---|---|
| `50142565` | NAZ'S HALAL FOOD — 451 Northfield Avenue, 10303 | `50179438`, September 10 |
| `50159292` | YUZU SUSHI — 64-60 Dry Harbor Road, 11379 | `50180004`, September 3 |
| `50187534` | COZZI PIZZA — 584 Broadway, 11206 | `50187793`, September 11 |
| `50192488` | KOKE — 173 Bleecker Street, 10012 | `50184059`, September 14 |

KOKE is the only conflict already present in the committed graph and remains LOW/suppressed. The verifier now fails if any current predecessor conflict appears as deliverable. A future canonical refresh must apply this scan before staging can pass.

## What remains live-only

The one unverifiable gate is a real paid-customer end-to-end event: Stripe subscription → authoritative service baseline → collected customer preferences → fresh source generation → personalized email plus CSV → actual Gmail message ID → Delivery State evidence → next-run dedupe. Creating a fake paid customer would not prove this. The first real subscription must execute that acceptance test before PermitPlate is described as having a proven paid-customer delivery.

The shadow verifier, CSV artifacts, result JSON, official-source scan, and Gmail attachment draft are ready. The draft is intentionally unsent.

## Artifact hashes

- `delivery-verifier.js`: `3e2d87682d488329f9aa608d564873af1b22132f7cbcb1129248e183694e877b`
- `delivery-verifier.test.js`: `59d93d0cc81fce4c0a6824d653be317e7898070c50dac1a066b338cac2e8b704`
- `run-delivery-verification.js`: `f9d1bd99be954e52cfd4aab6d09e7fec94761a74efd02bd8429dabe5a1556aca`
- `permitplate-delivery-verification-result.json`: `35045d816df704c3a2c6ff6a7a9f2c21e51302243041b17c5bac9e382114c531`
- General shadow CSV: `36de5a1a66d62a3b8ff9114d284c4a2d8f850450a76b449dea8850f5c5ff963c`
