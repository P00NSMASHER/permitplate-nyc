'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');

function read(relativePath){
  return fs.readFileSync(path.join(ROOT,relativePath),'utf8');
}

const detectionWorkflow=read('.github/workflows/detection-ledger.yml');
const launchWorkflow=read('.github/workflows/launch-readiness.yml');
const gitignore=read('.gitignore');

assert(!/contents:\s*write/.test(detectionWorkflow),'detection workflow must not have public contents write');
assert(/contents:\s*read/.test(detectionWorkflow),'detection workflow must remain public-read only');
assert(/permitplate-private-state/.test(detectionWorkflow),'detection workflow must serialize private state access');
assert(/PERMITPLATE_STATE_REPO/.test(detectionWorkflow),'private state repository variable required');
assert(/PERMITPLATE_STATE_TOKEN/.test(detectionWorkflow),'private state token secret required');
assert(/repo_visibility/.test(detectionWorkflow)&&/private/.test(detectionWorkflow),
  'workflow must verify the configured state repository is private');
assert(/git rev-list HEAD -- state\/detection-ledger\.json state\/opportunity-ledger\.json/.test(detectionWorkflow),
  'migration must recover the latest intact historical ledger pair');
assert(/DETECTION_MIGRATION_SOURCE_INVALID/.test(detectionWorkflow),
  'migration must validate the detection ledger before seeding');
assert(/OPPORTUNITY_MIGRATION_SOURCE_INVALID/.test(detectionWorkflow),
  'migration must validate the opportunity ledger before seeding');
assert(/git -C "\$PRIVATE_STATE_DIR" add state\/detection-ledger\.json state\/opportunity-ledger\.json/.test(detectionWorkflow),
  'both ledgers must be committed together');
assert(/git -C "\$PRIVATE_STATE_DIR" push origin HEAD:main/.test(detectionWorkflow),
  'private state commit must use a normal non-force push');
assert(/public-verification\.json/.test(detectionWorkflow),
  'public workflow must emit aggregate verification evidence');
assert(!/path:\s*\|\s*\n\s*pipeline\/detection-ledger-run-result\.json/.test(detectionWorkflow),
  'sensitive detection result must not be uploaded publicly');

assert(/permitplate-private-state/.test(launchWorkflow),
  'launch readiness must serialize with state mutation');
assert(/PERMITPLATE_STATE_REPO/.test(launchWorkflow)&&/PERMITPLATE_STATE_TOKEN/.test(launchWorkflow),
  'launch readiness must consume the private state repository');
assert(/\.private-state\/state\/detection-ledger\.json/.test(launchWorkflow) ||
       /PRIVATE_STATE_DIR.*state\/detection-ledger\.json/.test(launchWorkflow),
  'launch readiness must read the private detection ledger');

assert(!fs.existsSync(path.join(ROOT,'state','detection-ledger.json')),
  'public detection ledger must not remain in the working tree');
assert(!fs.existsSync(path.join(ROOT,'state','opportunity-ledger.json')),
  'public opportunity ledger must not remain in the working tree');
assert(/(^|\r?\n)state\/(\r?\n|$)/.test(gitignore),
  'public repository must ignore operational state directory');
assert(/(^|\r?\n)\.private-state\/(\r?\n|$)/.test(gitignore),
  'nested private state checkout must be ignored');

console.log(JSON.stringify({
  passed:true,
  checks:20,
  boundary:'PRIVATE_DURABLE_STATE'
},null,2));
