# Delivery verification runbook

## Required evidence

A finalized delivery row needs all of the following to agree:

- recipient email;
- Stripe customer and subscription;
- signal key and package ID;
- artifact and profile fingerprints;
- attempt ID and message identity;
- unexpired owner authorization ID;
- provider message/attempt identity;
- provider acceptance status and timestamp;
- reconciliation timestamp.

`ACCEPTED` means the provider accepted the send request. It is not proof that the recipient opened, read, or even received the message in an inbox.

## Fail-closed outcomes

Keep the delivery in `PLANNED`, `PENDING`, `REVIEW`, or `REJECTED` when evidence is missing, stale, mismatched, unsupported, or ambiguous. Never let a caller-supplied status override provider evidence.

An authorization can be used only once, cannot last more than one hour, and must be bound to the exact reviewed attempt. If the reviewed artifact or recipient changes, create a new attempt and obtain a new explicit authorization.

## Duplicate check

After provider reconciliation, persist finalized signal keys in private Delivery State and run the same subscriber artifact build again. A successfully finalized signal must be excluded with `ALREADY_DELIVERED`; it must not appear in the next email or CSV.

Use `node pipeline/run-subscriber-intake.test.js` for the deterministic private intake/no-send regression and `node pipeline/provider-reconciliation.test.js` for provider-evidence invariants. These tests do not contact a customer or provider.
