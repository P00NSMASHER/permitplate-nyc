# PermitPlate owner-authorized AI reviewer substitution — 2026-11-10

## Owner instruction and source

The owner explicitly authorized use of the two AI-simulated reviewer judgments as
**substitutes for independent human reviews**. This authorization is recorded in
`scoring/ai-proxy-review-owner-authorization.json`. It authorizes only a **new,
explicit AI-proxy tuning-evidence gate**; it does not establish that actual
independent human experts reviewed the cases, that buyer precision was measured,
or that a model can send scored customer leads.

The frozen genuine-source Equipment blind cohort and AI reviewer evidence are
in the dedicated **private** repository `P00NSMASHER/permitplate-state`:

- `research/blind-calibration/42842957840/operator/cohort.json`
- `research/blind-calibration/42842957840/reviewer/review-packet.json`
- `research/ai-proxy-calibration/42842957840/ai-reviewer-simulation.json`

These paths are not public artifacts or customer lead feeds. The source revision
is `78c205cd742462831eaa30fed6ae96346a82202b`. The 70 tuning case
sources are authentic NYC public administrative records; the **verdicts are AI
heuristics**, not authenticated customer outcomes. All model/holdout data remained
outside the simulated reviewers' decision rules.

## Two fully source-referenced AI-only judgment passes

| Tuning signal | Regulatory conservative | Vendor research expansive |
| --- | ---: | ---: |
| Actual-source cases | 70 | 70 |
| Dated pre-permit events | 6 | 6 |
| Undated applicant placeholders | 64 | 64 |
| `PURSUE_NOW` | 3 | 6 |
| `WATCH` | 3 | 0 |
| `INSUFFICIENT_EVIDENCE` | 64 | 64 |

The two scripted rubrics agreed on **67 of 70** classifications (**95.7%**,
Cohen's kappa approximately **0.733**). Three disagreements involved one
older initial inspection and two pre-permit reinspections. These are **two
rubrics run by one AI system**, not independently obtained human judgments.

The unchanged numeric gate requires at least **20 selected cases**, **80%
precision against the review labels** and a **95% Wilson lower bound of 0.60**.
At the most favorable tested V4 Equipment threshold satisfying the 20-case
minimum (score `40`, **23 selected cases**), agreement with the two AI-generated
positive labels was only **3/23 (13.0%)** and **6/23 (26.1%)**. No tested
threshold meets the required numerical criterion. Report these as
**AI-proxy agreement**, not measured buyer precision.

## Versioned experimental gate (separate from human calibration)

`pipeline/ai-proxy-calibration.js` accepts only the **exact named two
AI-simulation rubrics**, source/packet/fingerprint-matched judgments, and the
owner's scoped AI-substitution authorization. It retains the existing tuning
sample size, reviewer agreement, selection support, precision and Wilson
bounds, and the held-out evaluation separation.

Run against the immutable private files from the matching source checkout:

```sh
node pipeline/calibration-runner.js ai-proxy-evaluate \
  /private/research/blind-calibration/42842957840/operator/cohort.json \
  /private/research/ai-proxy-calibration/42842957840/ai-reviewer-simulation.json
```

A blocked source-bound result exits `2`; it is **not** a successful model
promotion. The protected main-only `PermitPlate owner-authorized AI proxy
calibration (NO_SEND)` workflow records the sanitized diagnostic in the
private source repository, with exact-public-main and private-main
compare-and-swap checks. PR jobs can test the gate but cannot access private
credentials or research labels.

No AI-only result should be represented as human-reviewed, independently
validated for actual buying intent, or safe for automatic buyer delivery.
`productionAuthorized`, `customerDeliveryAllowed` and
`externalSendCalls` remain `false`, `false` and `0` regardless of any
tuning diagnostic. A positive diagnostic would still require new, separately
verified holdout and longitudinal evidence and explicit production-policy
authorization.

## Practical finding

The current 70-case population contains just **six dated events**. Most source
cards establish only undated DOHMH applicant status; a data-pull timestamp is
not proof of filing date or equipment demand. Lowering the 80% threshold or
counting unknown-date applications as confirmed urgent equipment leads would
not add evidence. The next supported research advance is a **new, explicitly
date-confirmed event population** and source-specific equipment-scope
adjudication, with a fresh prespecified split and no lookahead. Preserve this
current cohort and its locked original holdout as historical evidence rather
than rewriting it to make a simulated grade look favorable.
