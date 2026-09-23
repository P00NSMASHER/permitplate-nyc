# First paid subscriber runbook

This runbook is for the controlled first-customer acceptance. It does not authorize an external send by itself.

## Before accepting a customer

1. Configure the private state repository and scoped credentials in `PRIVATE_STATE_MIGRATION.md`.
2. Confirm the current source run is complete. Never fulfill from a partial or unavailable source graph.
3. Confirm current production scoring authority can create authorized packages; a complete graph or green unit tests alone are not enough.
4. Confirm the launch-readiness controller reports `firstCustomerOperationallyReady: true`.
5. Confirm the public build identity matches the deployed GitHub Pages commit.
6. Reactivate the Stripe Payment Link only after steps 1–5 pass, then confirm it still requires category, territory, and Starter fields.
7. Confirm the Stripe customer portal remains active with cancellation at period end.

## On completed checkout

1. Retrieve the completed Stripe Checkout Session and its Subscription through an authorized Stripe surface. Do not copy card data; it is not an input.
2. Save one JSON bundle outside the public repository, or under ignored `.private-state/`, with `session`, `subscription`, and `expectedPriceId`.
3. Obtain the current private `state/opportunity-ledger.json` and the subscriber's finalized delivered signal keys.
4. Run the intake command into a new empty private output directory:

```sh
node pipeline/run-subscriber-intake.js \
  --checkout .private-state/intake/checkout.json \
  --opportunities .private-state/state/opportunity-ledger.json \
  --delivered .private-state/intake/delivered-keys.json \
  --report-date YYYY-MM-DD \
  --output .private-state/runs/SESSION_ID
```

The command must report `READY_FOR_OWNER_REVIEW` or `NO_QUALIFYING_SIGNALS`. `REVIEW` is a stop condition.

## Owner review

Review all private output files before any send:

- `intake-receipt.json` for checkout/profile/artifact lineage;
- `subscriber-profile-sheet-row.json` for the exact category, territory, baseline, and Starter choice;
- `artifact-review.json` for exclusions and review items;
- the CSV and both message renderings for fact/inference separation and source links;
- `delivery-review.json` for the exact recipient, signal set, message identity, and the expected `OWNER_AUTHORIZATION_MISSING` stop.

Do not send if the source graph is incomplete, any artifact item remains under review, the recipient or category is wrong, a source link cannot be verified, or the output includes a previously delivered signal key.

## Send and reconcile

1. Create a short-lived `OWNER_EXPLICIT_SEND` authorization bound to the exact attempt, recipient, message identity, artifact fingerprint, message fingerprint, and ordered signal keys.
2. Submit exactly the reviewed message and CSV through the approved provider path.
3. Record the provider attempt and readback without converting provider acceptance into an inbox-delivery claim.
4. Finalize private Delivery State only when provider evidence matches the exact authorized attempt.
5. Re-run intake with the finalized delivered keys. It must return zero duplicate signals.

The first customer is commercially proven only after steps 1–5 have genuine provider evidence. Never create synthetic provider, customer, or delivery receipts in production state.
