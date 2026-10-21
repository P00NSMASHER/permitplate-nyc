# Scoring Version Drift — 2026-09-18

## Read-only replay result

A corrected replay of all 62 current production Venue Graph rows against the canonical deterministic scoring engine reproduced **60 / 62 rows exactly**.

Replay semantics were corrected before this conclusion:
- only DOB Source Events actually listed in the venue's `DOB Job Filing` field were allowed to affect scoring;
- `Unknown` and KOKE's administrative/re-permit label were not treated as known cuisine;
- concept evidence was classified structurally instead of blindly stacking every word in the generated `Cuisine/Type` display label;
- SLA hospitality identity, DOHMH DBA evidence, and DOB restaurant/buildout evidence were treated separately.

## Genuine residual drift

| Venue | Live production | Canonical v2 replay | Material effect |
| --- | --- | --- | --- |
| CRYBABY · 153 BOWERY | Hood/Fire 100 | Hood/Fire 93 | Best remains Equipment 100; no top-category change |
| DINER 24 · 1674 BROADWAY | Distribution 89; Best Insurance 92 | Distribution 94; Best Distribution 94 | top vendor category changes |

All other 60 production rows reproduce exactly under the current canonical rules once replay inputs are normalized correctly.

## Interpretation

The current production graph remains internally valid: the deterministic staging validator passed all 62 Venue rows, 62 durable Leads and 82 Source Events with zero invariant errors. But the graph is not a single fully reproducible scoring generation under the current canonical rule set.

The most plausible explanation is bounded historical rule-version drift: the graph was generated and then selectively hardened before the current Daily Digest v2 scoring text reached its present form. The vertical-evidence correction intentionally fixed targeted specialist over-ceiling values rather than globally re-scoring unrelated categories.

## Migration rule

Do not patch CRYBABY or DINER 24 individually.

The next full deterministic generation must:
1. stamp `ScoringVersion=permitplate-score-v2-2026-09-18` and the rule fingerprint into Run Control Notes;
2. recompute all eight category scores for every staged venue from one scoring version;
3. run the full staging invariant suite and five-profile no-send shadow E2E;
4. report every Best Vendor Fit / Best Score change before promotion;
5. promote Venue Graph + Leads atomically only after validation and exact post-commit readback pass.

Until that migration is intentionally executed, the current live graph remains the production snapshot. This document does not claim the two rows have been changed.