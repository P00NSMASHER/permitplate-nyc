# Provider-state reconciliation hardening — 2026-09-21

## Scope and result

This change fixes the private delivery-state write boundary. It does not send mail, authenticate arbitrary supplied JSON, or prove real customer delivery.

Before this change, `private-sheet-mapping.js` could take a caller-supplied FINALIZED label, a nonempty Authorization ID, and an ACCEPTED label without binding the provider observation to the intended message or recipient. Unknown status strings could fall back to NOT_SENT. The old positive test itself supplied only a placeholder Authorization ID.

The mapper now calls `resolveDeliveryStateEvidence`, which validates the complete existing authorization receipt at the original transport time and calls the strict `reconcileProviderEvidence` validator. No transported rows are emitted on validation failure.

## What is now enforced

- A provider outcome must bind the exact attempt ID, message identity, normalized single recipient, and artifact fingerprint.
- Acceptance requires an explicit provider message ID, evidence kind, acceptance timestamp, and observation timestamp. Timestamps must be timezone-qualified and logically ordered.
- A rejected request requires a provider request ID; a bounce requires a provider message ID.
- Missing results remain pending. UNKNOWN cannot become NOT_SENT or authorize a retry.
- Caller-supplied status, provider ID, and delivered-time overrides cannot contradict evidence.
- A bare Authorization ID no longer suffices. The full owner-approval record must match the exact artifact, message, recipient, and ordered signals.
- Delayed readback checks approval expiry against the recorded original transport time, not against the later reconciliation clock.
- Receipt processing copies the caller's deduplication Set. It cannot mutate persisted-state inputs before the caller commits a result.
- A replay adds no already-accepted signal twice. Changed provider IDs and stale acceptance following a recorded bounce require review.
- The existing 21-column Subscriber Profiles and 16-column Delivery State schemas remain unchanged.
- FINALIZED denotes reconciliation of provider acceptance. The legacy `Delivered At` column stores provider acceptance time, not proof of recipient inbox delivery. Results explicitly report `deliveryConfirmed: false` and `retryAllowed: false`.

## Executed evidence

Code/test ref: `a003c681fd2685242f8a4b50aff5ef62f31dafb4`.

- Local Node 22 isolated provider suite: **32/32 passed**.
- GitHub Actions provider/private-state suite: **61/61 passed**, no skips.
- Provider reconciliation workflow: run `35636332064`, job `106454522387`, success.
- Full existing deterministic regression workflow: run `35636331930`, job `106454521830`, success. Includes source adapters, identity, graph, scoring, detection, opportunity history, subscriber preferences, report rendering, authorization, and the public build boundary.
- Existing first-subscriber canary: `passed: true`, `transportMode: NO_SEND`, `externalSendCalls: 0`.
- That canary retained `OWNER_AUTHORIZATION_MISSING` at transport preflight and only planned private rows.

The workflow artifact was downloaded and checked, not merely inferred from a green job:

- Artifact ID: `10655963105`
- ZIP SHA-256: `22b77f0864690f690d30aa132c162aa91f60e68b8c27374c1015dfb4cf1d0a40`
- Files: `reconciliation.tap`, `first-subscriber.json`

## Integration contract

For an actual transported result, `deliveryStateRows` now additionally requires:

- `message`: the exact READY rendered message and its fingerprint;
- `transportAuthorization`: the complete approval receipt from private trusted state;
- `transportStartedAt`: actual original transport time;
- `providerObservation`: authenticated-adapter output with status, attempt/message/artifact/recipient bindings, evidence kind, provider ID(s), event time and observedAt;
- `reconciledAt` or `now`: optional explicit reconciliation clock for replay/testing.

No legacy fallback accepts an incomplete provider object. A caller using old incomplete fixtures must be updated rather than bypassing this gate. The older in-memory helper in `delivery-plan.js` is not evidence authority for private persisted delivery rows; persistence must pass the new gate.

## Trust boundary and remaining proof

Fingerprints detect mismatched content; they are not signatures. An evidenceKind string is not provider authentication. Provider observations must be assembled by an authenticated connector/transport adapter, and owner approvals must originate in private trusted state. These pure modules must not be exposed as browser-authoritative approval or delivery endpoints.

Gmail's `users.messages.get` supports fetching a specific message and selected metadata headers. This is the appropriate source for future matched readback; a thread ID, draft, local status, or successful rendering is not a send receipt. Official reference: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get

No genuine provider-backed customer delivery was performed or claimed in this run. No live subscriber rows, provider events, approvals, or delivered keys were invented. No email, customer outreach, pricing change, credential change, or Netlify deployment was performed.
