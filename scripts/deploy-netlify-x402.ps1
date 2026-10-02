param(
  [string]$SiteId = "963477ed-829f-4ae4-91dc-110e5607b83e"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-NodeTool {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $portable = Get-ChildItem "C:\portable-node" -Recurse -Filter $Name -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($portable) { return $portable.FullName }

  throw "Could not find $Name in PATH or C:\portable-node."
}

$node = Get-NodeTool "node.exe"
$npx = Get-NodeTool "npx.cmd"

Push-Location $repo
try {
  Write-Host "Running recovery contract tests..."
  & $node "scripts/test-x402-target-manifest.mjs"
  if ($LASTEXITCODE) { throw "target manifest test failed" }
  & $node "scripts/test-x402-payment-core.mjs"
  if ($LASTEXITCODE) { throw "payment core test failed" }
  & $node "scripts/test-x402-paid-operation.mjs"
  if ($LASTEXITCODE) { throw "paid-operation test failed" }
  & $node "scripts/test-netlify-x402-package.mjs"
  if ($LASTEXITCODE) { throw "Netlify package test failed" }
  & $node "scripts/test-x402-rehost-core.mjs"
  if ($LASTEXITCODE) { throw "official upstream smoke test failed" }
  & $node "scripts/test-vendor-intake-gate-core.mjs"
  if ($LASTEXITCODE) { throw "vendor-intake integration test failed" }

  Write-Host "Creating Netlify draft deploy..."
  $draftArgs = @(
    "-y", "netlify-cli@latest", "deploy",
    "--site", $SiteId,
    "--dir", "recovery/netlify-x402/public",
    "--functions", "recovery/netlify-x402/netlify/functions",
    "--skip-functions-cache",
    "--message", "x402 recovery draft",
    "--json"
  )
  $draftRaw = & $npx @draftArgs
  if ($LASTEXITCODE) { throw "Netlify draft deploy failed" }

  $draft = ($draftRaw -join [Environment]::NewLine) | ConvertFrom-Json
  $draftUrl = $draft.deploy_url
  if (-not $draftUrl) { $draftUrl = $draft.deploy_ssl_url }
  if (-not $draftUrl) { $draftUrl = $draft.url }
  if (-not $draftUrl) { throw "Netlify draft deploy did not return a deploy URL" }

  Write-Host "Verifying draft $draftUrl ..."
  $env:BASE_URL = $draftUrl
  & $node "scripts/verify-netlify-x402.mjs"
  if ($LASTEXITCODE) { throw "Netlify draft verification failed; production was not changed" }

  Write-Host "Draft is green. Deploying production..."
  $prodArgs = @(
    "-y", "netlify-cli@latest", "deploy",
    "--site", $SiteId,
    "--prod",
    "--dir", "recovery/netlify-x402/public",
    "--functions", "recovery/netlify-x402/netlify/functions",
    "--skip-functions-cache",
    "--message", "x402 recovery production",
    "--json"
  )
  $prodRaw = & $npx @prodArgs
  if ($LASTEXITCODE) { throw "Netlify production deploy failed" }

  Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
  & $node "scripts/verify-netlify-x402.mjs"
  if ($LASTEXITCODE) { throw "Production deploy completed but verification failed" }

  Write-Host "Netlify x402 recovery is live and verified."
} finally {
  Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}
