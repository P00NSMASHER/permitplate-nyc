# PermitPlate V7.1 deterministic engine verification

**Date:** 2026-09-21  
**Repository:** `P00NSMASHER/permitplate-nyc`  
**Verified head:** `24acb4f6d697f8a2a8a101f1d92bad9d1bf9ed8d`  
**GitHub Actions run:** `35608025337` — **SUCCESS**

## What changed

PermitPlate's deterministic core now includes:

1. **Typed SourceObservation states**
   - `VERIFIED_EMPTY`
   - `COMPLETE_NONEMPTY`
   - `PARTIAL`
   - `SOURCE_UNAVAILABLE`
   - `SOURCE_MOVED`
   - `UNKNOWN`

2. **Fail-closed absence mutation**
   - close/delete/suppress/retire actions require a fresh, scope-matched complete source observation;
   - zero rows alone cannot close an opportunity;
   - source outage, movement, partial coverage, stale data, or unknown completeness preserve prior opportunity state.

3. **Explicit count semantics**
   - missing, null, and blank publisher counts do not coerce to zero;
   - count mismatch becomes `PARTIAL`;
   - verified emptiness requires exact zero count, cursor closure, source/config/schema identity, raw-page hashes, observation time, and freshness.

4. **Deterministic Opportunity Decision receipt**
   - `PermitPlate-v7.1.0`;
   - combines source health, identity resolution, material change, vendor score, baseline eligibility, source lineage, and delivery gate;
   - emits `DELIVER | REVIEW | HOLD`;
   - includes explicit reasons and a deterministic replay fingerprint.

5. **Stable-identifier contradiction**
   - a source entity ID that conflicts with a candidate's existing stable IDs is now explicit contradictory evidence;
   - address/name similarity cannot override that conflict.

6. **Subscriber-start/backlog semantics**
   - post-baseline new entity -> NORMAL;
   - post-baseline material change -> NORMAL;
   - post-baseline qualifying reopen -> NORMAL;
   - optional prior-seven-day onboarding snapshot -> labeled STARTER;
   - older backlog -> INELIGIBLE;
   - missing event timing -> REVIEW rather than guessed eligibility.

7. **Operational receipt verifier**
   - delivery operations can validate a `Source Observations` sheet/array when present;
   - rollout is canary-compatible: no receipt sheet reports `enforced:false` instead of pretending receipt coverage exists;
   - declared source states and absence permissions are checked against the deterministic classifier.

8. **Continuous regression CI**
   - `.github/workflows/permitplate-tests.yml`;
   - runs model and delivery-verifier tests on every push and pull request.

## Independent checks performed during implementation

Targeted exact-code execution passed:

- source-observation edge cases: **15/15**
- operational receipt-verifier cases: **7/7**
- Opportunity Decision paths: **6/6**
- stable-ID/subscriber-baseline cases: **8/8**

The permanent GitHub Actions workflow then passed at head `24acb4f6d697f8a2a8a101f1d92bad9d1bf9ed8d`.

## Remaining production gap

The connected Netlify project is healthy and public, but its current deploy still reports commit:

`57312ded8b2bcb3a95d4970ee0d8d4aadcb3dc0f`

The Netlify connector returned a local CLI deployment handoff rather than performing a remote build, so **no new production deploy is claimed** here.

The more important engine gap is connector adoption: every production source still needs to emit SourceObservation receipts and delivery operations need 100% receipt coverage before PermitPlate can claim verified-complete negative coverage.

## Next highest-value implementation

Wire the live NYC DOHMH / DOB / SLA source generation into the SourceObservation contract, persist receipt IDs on SourceEvents, and make production delivery verification fail closed when any source used for absence/closure lacks a complete receipt.
