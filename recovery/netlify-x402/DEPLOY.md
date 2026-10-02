# Netlify x402 fallback deployment

Target existing Netlify project:

- project: agent-data-tools-x402
- site id: 963477ed-829f-4ae4-91dc-110e5607b83e
- production origin: https://agent-data-tools-x402.netlify.app
- plan: Free
- access control: public

This package is a fallback for AppDeploy incident #38 and shares the canonical recovery cores in the parent recovery directory.

## Pre-deploy

From the repository root:

1. Run the recovery CI/tests.
2. Ensure no runtime file contains api-v2.appdeploy.ai.
3. Confirm all 8 target routes exist in recovery/x402-portfolio-target.json.
4. Confirm the Netlify account remains on the Free plan.

## Local/CLI deploy

Use the existing authenticated Netlify account and existing site; do not create a new site.

Deploy from the repository root so the function bundler can follow imports into recovery/*.mjs.

Expected package inputs:

- recovery/netlify-x402/public
- recovery/netlify-x402/netlify/functions

After deployment, run the zero-spend buyer verifier against the Netlify origin before changing any marketplace listing.

## Acceptance

- /_api/health => 200 JSON and appDeployDependency=false
- /.well-known/x402 => 200 JSON, x402Version=2, 8 resources
- all 8 paid routes => seller-generated 402 with decodable PAYMENT-REQUIRED
- vendor proceed fixture => proceed
- vendor address fixture => human_review + registered_address_differs
- vendor domain fixture => human_review + domain_name_not_aligned
- no runtime resource URL contains api-v2.appdeploy.ai
- no seller-funded payment is used
