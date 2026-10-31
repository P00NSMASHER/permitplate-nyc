# PermitPlate online trial intake: private operator guide

This is a one-step request with immediate on-screen RECEIPT, not admission.
No automatic email, customer message, Stripe mutation, payment, report delivery
or start of the 14-day trial. The existing ten-business supervised pilot cap
continues to live in the canonical private admitted-trial registry.

## Cloudflare provisioning

Official host: https://permitplate.retallyrecovery.com/trial.
Only functions/api/trial-request.js is permitted in the project root.
The Pages Function source is not copied to dist/ or GitHub Pages.

Create an isolated US-jurisdiction Cloudflare D1 database named
permitplate-trial-intake. Run operations/trial-intake-schema.sql.
Bind its UUID to the retally-permitplate production Pages project as
TRIAL_REQUEST_DB. Generate a cryptographically random independent
32+ character rate-limit HMAC secret, stored only as encrypted Cloudflare
Pages production environment variable TRIAL_INTAKE_RATE_SECRET.
Never print, commit or send the secret. Keep TRIAL_INTAKE_ENABLED
absent/0 until schema, bound database and secret are independently
verified. Then set it to 1, production only. Preview remains disabled.
Any missing dependency causes a 503, not an apparent success.

Strict same-origin JSON POST, a 2048-byte cap, one request per business
domain, five attempts per pseudonymous-IP daily key and a pending queue
backstop of 150 protect a small manual-review pilot. The private website field
retains the public HTTPS URL path (up to 700 characters including the origin)
so the owner can distinguish business pages hosted on a shared domain. Query
parameters and fragments are discarded before private storage, including
tracking parameters and tokens. The canonical business-domain duplicate key
remains hostname-only; differing paths on one shared host do **not** bypass
one-trial-per-business safeguards or automatically create distinct requests.
The owner must independently verify business identity and aliases before any
trial admission. Duplicate domains
never reveal old applicant names/emails. Client requests are NOT
authenticated owner approvals or confirmed email delivery.

## Customer promise

After a confirmed D1 write, show "Request received" for personal review.
The receipt means neither confirmed availability nor enrollment. No pilot
spot is reserved; no trial clock is started and no card is collected.
No automatic email is sent. If no on-screen receipt can be verified,
the customer can prepare a manual email instead. Always treat a duplicate
as one request, never two pilot slots.

## Owner triage in private Cloudflare D1 console

Use a read-only operator query, never a public artifact:

SELECT reference,business_name,business_domain,website,contact_email,
       category,territory,requested_at
FROM trial_intake_requests
WHERE status='PENDING'
ORDER BY requested_at ASC LIMIT 50;

Do not paste these rows into publicly visible issues or assistant messages.
Verify business-domain aliases, contact details, territory/category
and available source context independently before enrollment.
Update status to REVIEWING after owner inspection using the actual time.
After the decision, use DECLINED or HANDOFF_RECORDED with reviewed_at.
No D1 status automatically modifies the private trial registry.

The separate private operator flow remains:
pipeline/run-free-trial.js --action enroll with an explicit genuine owner
approval reference and the current authoritative registry fingerprint.
Never reuse synthetic test approvals. Reports still require individual
source-bound review and authenticated provider send/acceptance checks.

Private requests may be retained for review, fraud prevention,
customer requests or legal duties. Apply a bounded retention policy
with operator review and periodic cleanup of expired rate buckets.
Preserve holds and established trial/delivery history. Do not use
these contact details for marketing or unauthorized outreach.

## Verification

Offline: node --test pipeline/trial-private-intake.test.js
Schema: python3 -m unittest discover -s tests -p test_trial_d1_schema.py
Existing 1000-persona test and Chromium/WebKit trial browser checks remain.

Production: GET /api/trial-request is a metadata-free readiness
heartbeat (200 ready, 503 missing config), not a request list.
Live acceptance verifies exact source fingerprint, security headers,
the on-screen request flow using mocks, private file exclusions and
the visible privacy policy. Production POST must NOT be used with
fictional customers without explicit authorization; that would create
real rows and would not demonstrate actual buyer demand.

If production intake fails, keep the enable gate off and show the
manual email fallback. Do not reset the 10-person canonical trial
registry or promise an enrollment/confirmation message.
