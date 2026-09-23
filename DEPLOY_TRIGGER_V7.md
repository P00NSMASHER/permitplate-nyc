# PermitPlate public deployment

The canonical customer site is deployed from the exact `dist/` allowlist by `.github/workflows/public-site-build.yml` to GitHub Pages.

The workflow verifies the live `build-info.json` source commit and aggregate public-source fingerprint after deployment. Netlify is no longer part of the production path.
