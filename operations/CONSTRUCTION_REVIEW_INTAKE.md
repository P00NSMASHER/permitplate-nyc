# PermitPlate — independent DOB construction reviewer return gate

**Version:** \`PermitPlate-construction-review-return-v1.0.0\`

**State:** private, offline, review-only. This is a quality-control instrument for
the *separate* frozen DOB construction-source panel. It is **not** a substitute for
the original Equipment scoring 70-case tuning/30-case holdout protocol, and
does not permit sending a customer a scored lead.

## Source authority and isolation

Load only the operator-owned five files in the already frozen private
\`research/construction-frozen-reference-v1/\` directory:

- \`source-panel.json\`
- \`reviewer-packet.json\`
- \`reserved-audit.json\` (**operator only**)
- \`split-manifest.json\` (**operator only**)
- \`anchor.json\` (**operator only**)

Give each actual independent reviewer **only a separate copy** of the frozen
\`reviewer-worksheet.csv\` and, optionally, \`reviewer-worksheet.html\`.
The reserved-audit file, scoring cohorts, other reviewers' answers, and
predictions must not be shared. Reviewer files are untrusted until independently
authenticated by the operator outside this parser.

## Fill in the six empty CSV columns

Do not modify the ten source-bound columns or remove/reorder any of the
original review rows. For each source case supply:

| Column | Accepted value |
|---|---|
| Source Seen In Official Record? | \`YES\`, \`NO\`, or \`UNCERTAIN\` |
| Equipment Construction Relevance | \`RELEVANT\`, \`NOT_RELEVANT\`, or \`INSUFFICIENT_EVIDENCE\` |
| Documentary Source Notes | At least 20 characters, describing the official source evidence |
| Purchase Intent Documented? | \`DOCUMENTED\`, \`NOT_DOCUMENTED\`, or \`UNKNOWN\` |
| Reviewed At | An ISO UTC timestamp, for example \`2026-10-19T19:45:00.000Z\` |
| Reviewer Attestation | Literal \`INDEPENDENT_HUMAN_SOURCE_REVIEW\` |

A case whose source cannot be checked may only receive
\`INSUFFICIENT_EVIDENCE\` as its relevance. Calling purchase intent
\`DOCUMENTED\` triggers a separate verification hold; it is **not** a
purchase order or a validated buyer.

## Operator-only, read-only intake

The reviewer alias must be an opaque unique ID, not a name or email.
Run this locally with private files; **never place completed sheets or frozen
state in the public repository or upload them into public GitHub Actions**:

\`\`\`sh
node pipeline/construction-review-intake.js \
  /private/state/research/construction-frozen-reference-v1 \
  reviewer-alpha=/private/reviews/alpha.csv \
  reviewer-beta=/private/reviews/beta.csv
\`\`\`

The command checks reference integrity, exact source-column binding, complete
filing coverage, nonduplicated cases and reviewers, allowed judgments, strict
timestamps, protected audit IDs, and reviewer agreement. It emits **only
aggregate read-only JSON**; it does not write or change any source or reviewer
file, open external network connections, access the Equipment holdout, authorize
transport, or produce commercial readiness evidence.

A completed matching pair returns
\`DECLARATIONS_ONLY_AWAITING_EXTERNAL_AUTHENTICATION\`. **Even then** the
actual reviewer identities, independence, expertise and documentary accuracy
have not been verified. All release fields remain false. Any disagreement,
uncheckable source, unverified purchase claim, synthetic input, altered source
column, absent case, or tamper yields \`REVIEW\`.

## Separate approval gates still required

Independent human identity and expertise authentication, source judgment
adjudication, verified restaurant **operator** identity, and original documentary
procurement evidence are separate manual tasks. The saved DOB review population
is source-selected and cannot establish customer conversion, purchase intent,
or population-level lead precision.

Scored delivery continues to require the **existing independent scoring
calibration protocol**, locked original holdout, governed promotion and
provider-backed no-send replay. Do not treat this worksheet agreement result
as scored calibration evidence. Founder-curated launch readiness is separately
governed by the launch-readiness controller.

## Regression

\`\`\`sh
node pipeline/construction-blind-diagnostic.test.js
\`\`\`

Adversarial cases include incomplete or duplicate reviewers, modified
source text, extra rows, contradictory labels, future timestamps, reserved
case-ID insertion, synthetic review declarations, forged frozen anchors,
malformed CSV and unchanged no-send/no-score outputs.
