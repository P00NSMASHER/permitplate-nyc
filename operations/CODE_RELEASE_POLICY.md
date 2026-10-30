# PermitPlate — owner-authorized code release policy

**Effective:** 2026-10-21  
**Applies to:** source changes, code fixes, CI changes and repository pull requests for `P00NSMASHER/permitplate-nyc`.  
**Owner decision:** An independent or second-person **code reviewer is not required** to approve or merge a change. An author may implement, test, verify and merge a change under owner-delegated authority without seeking a separate code-review signoff.

This policy supersedes earlier **code-review** or independent **PR-approval** wording for this repository. An optional reviewer may contribute voluntarily, but an absent, unresponsive or unassigned code reviewer is not a release hold. This policy does **not** assert that an independent code review occurred.

## Minimum owner-authorized code-merge safeguards

Before integrating a source change:

1. Identify the exact current `main` SHA and immutable candidate head, inspect the actual diff and relevant operational boundaries. Do not use stale results to justify a changed commit.
2. Run relevant deterministic regressions, including payment, delivery, data-integrity, privacy, source quality and no-send checks for files that affect them. Require all applicable GitHub PR CI checks to complete successfully; never count a pending, skipped-required, missing, failed or cancelled check as passing.
3. For sensitive changes, independently replay adversarial or real **public-source data** when feasible. Record the actual result, source provenance, limitations and candidate commit. A second execution environment is a validation step, **not** a claim of separate human approval.
4. Resolve merge conflicts without dropping tests or weakening source evidence. Validate the combined result; do not use a forced push or rewrite `main`.
5. Use GitHub's ordinary merge operation with an expected head SHA and verify the resulting `main` commit and applicable post-merge workflows or read-only production checks. Keep recovery straightforward (revertible, source-linked commits).
6. If a required mechanical protection blocks a merge, stop instead of impersonating a reviewer or bypassing access controls. The owner may separately change repository settings.

The owner authorizes this **code-release workflow** without repeated independent-code-review requests. Nothing here authorizes purchases, billing changes, payment refunds, new credentials, customer sends, publication of private data, changes to restricted third-party resources, or bypass of source/readback failures.

## Distinct evidence and customer controls that remain mandatory

- **External factual accuracy:** Do not invent buyer intent, permit validity, opening dates, customer payments, model precision or reviewer evidence. Blind domain/source adjudication and independent human labels, where the product's scientific calibration requires them, are **data-quality gates**, not code-review requirements. They remain intact.
- **Customer fulfillment:** Paid subscriber reports still require a valid paid Stripe record, eligible source graph, actual owner assessment, authorized delivery, provider verification, deduplication and accurate limitations. PA Permit Pack report QC and provider-receipt checks are unchanged.
- **Automated scoring:** Shadow scores remain unpromoted without genuine current score authority and validation; this policy does not permit promotion.
- **Operational data:** Source-incomplete, ambiguous-identity, invalid-jurisdiction, refunded/disputed payment, stale private-state and delivery-reconciliation failures still fail closed.
- **Host and security:** No secrets, customer addresses or private state in public commits or Actions artifacts. Public deployment changes must pass build allowlist and live-site checks.

## Historical release language

Prior PR descriptions may mention independent **code** approval. Such language is superseded by this policy for repository code merges only. Mentions of independently verified source facts, human calibration labels, financial readback, owner authorized customer contact, and real provider evidence are **not** superseded.

**Verification record:** On October 21, GitHub's public branch metadata reported `main.protected=false`, repository rulesets listing was empty, and the repository did not contain `CODEOWNERS`. This is an observation at that time, not a guarantee that administrative protection can never change.
