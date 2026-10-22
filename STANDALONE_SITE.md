# PermitPlate standalone company site

The established GitHub Pages site and its source assets remain in place. The optional build target publishes PermitPlate at https://permitplate.retallyrecovery.com/ as a separate Cloudflare Pages project.

## Cloudflare Pages settings

- Repository: `P00NSMASHER/permitplate-nyc` (GitHub repository ID `1375917010`).
- Base branch for this migration: `main`. Set the Pages production branch to the reviewed release branch until this change is merged.
- Project name: `retally-permitplate`.
- Root directory: repository root.
- Framework preset: None.
- Node.js: 22 or later; no package installation is required.
- Build command: `node build-site.test.js && node build-standalone-site.test.js && node build-site.js --site-base https://permitplate.retallyrecovery.com/`.
- Build output directory: `dist`.
- Custom domain: `permitplate.retallyrecovery.com`, attached to this Pages project.
- Do not set a GitHub Pages CNAME or repoint the existing GitHub Pages deployment.

The default `node build-site.js` still copies the existing public allowlist without changing its bytes, project prefix, or canonical URLs. The existing GitHub Pages workflow is unchanged.

## Standalone artifact

The opt-in target rewrites first-party paths to the hostname root, updates canonical/social/sitemap URLs to Cloudflare Pages clean routes, updates the app manifest and build-identity fetch, and adds a visible “Part of RETALLY Group” link to https://group.retallyrecovery.com/. The current visual identity is retained. HTML email-obfuscation opt-out comments preserve the existing public contact links.

The generated privacy page explicitly identifies Cloudflare Pages as this public website's host and links to Cloudflare's official privacy policy. Its effective date is October 22, 2026. The existing provider list, policy commitments, data handling and terms remain unchanged; the original privacy source and default GitHub Pages output retain their October 1 date and original bytes.

The public allowlist remains the publication boundary. Runtime files at the repository root cause the standalone build to fail. The generated release manifest identifies Cloudflare Pages. `build-info.json` identifies PermitPlate, the canonical hostname, the release branch, and `CF_PAGES_COMMIT_SHA` in preference to other revision variables. Its file hashes describe the generated artifact. Source files, prices, Stripe checkout and billing links, recipient addresses, backend logic, and operational readiness are unchanged.

The standalone artifact contains 38 files: 36 allowlisted public files, generated `_headers`, and `build-info.json`. The header configuration is included in the file hashes and count. It sets HSTS to `max-age=86400`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy: object-src 'none'; frame-ancestors 'none'; base-uri 'self'`. It adds no script or style restrictions. The default GitHub Pages artifact does not generate `_headers`.

## Acceptance and rollback

Run the build command, then verify the custom hostname, `/start`, `/permit-pack`, policies, fonts/images, a nested missing URL, the Group link, and `/build-info.json`. Check checkout destinations without buying, submitting intake, or treating the welcome URL as payment evidence. Confirm that the manifest revision matches the Cloudflare deployment commit and that the existing GitHub Pages site still works.

Rollback this company site through its own Pages deployment history; the existing GitHub Pages site is independent. Do not delete backend or operational directories from the repository.

Cloudflare behavior references:
- https://developers.cloudflare.com/pages/configuration/serving-pages/
- https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/
- https://www.cloudflare.com/privacypolicy/

