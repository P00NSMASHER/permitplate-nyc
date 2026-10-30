# Operational launch evidence renewal

The existing daily launch-readiness workflow previously read only a committed
external evidence receipt. Its 24-hour freshness limit inevitably expired even
while the existing read-only Stripe intake continued to succeed.

The current-main live job now renews operational evidence on each existing run,
using the already-bound restricted `PERMITPLATE_STRIPE_READ_KEY`. Pull requests
exercise offline contract tests only. No new schedule, key, provider permission,
customer record, payment, or communication is introduced.

The bounded GET allowlist contains the exact existing PermitPlate Payment Link,
its line items, its existing default billing portal, and the canonical GitHub
Pages build metadata and allowlisted public files. It checks live mode, expected
product metadata, required supported dropdowns, one $79/month price, period-end
cancellation, public manifest identity, and actual SHA-256 of every public file.
Backend-only commits can retain an older live commit when all public bytes match.
Credentials are sent only to the three pinned Stripe URLs. Redirects are refused,
responses are size/time bounded, and failures report a redacted category.

`pipeline/launch-external-evidence-result.json` is a sanitized run artifact, never
a public customer ledger. Its observation time is created for successful fresh
reads; old observations are not re-dated. The launch controller evaluates age
after the fresh reads complete. Provider denial, changed pricing/preferences,
portal mismatch, missing public files or byte drift stops the run without a
fallback to committed positive flags. A restricted-key 403 is an access limit,
not permission to widen the key or claim verification.

Real paid-subscriber acceptance, provider-confirmed delivery and later duplicate
suppression remain unproved by these configuration reads. All three commercial
proof flags remain false. Their eventual acceptance requires genuine separately
verified customer evidence; no synthetic subscriber or send is created here.
