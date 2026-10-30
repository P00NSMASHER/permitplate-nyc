import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = [
  {
    path: ".github/workflows/source-health.yml",
    artifact: "permitplate-source-health",
  },
  {
    path: ".github/workflows/current-graph.yml",
    artifact: "permitplate-current-graph",
  },
];

function readWorkflow(path) {
  return readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

for (const workflow of workflows) {
  test(`${workflow.path} admits only main push evidence`, () => {
    const source = readWorkflow(workflow.path);
    const pushStart = source.indexOf("\n  push:\n");
    const permissionsStart = source.indexOf("\n\npermissions:", pushStart);
    assert.notEqual(pushStart, -1, "push trigger is required");
    assert.notEqual(permissionsStart, -1, "permissions block must follow triggers");
    const pushBlock = source.slice(pushStart, permissionsStart);
    const match = pushBlock.match(/branches:\s*\n((?:\s*-\s*[^\n]+\n)+)\s*paths:/);
    assert.ok(match, "push trigger must declare branches before paths");
    const branches = [...match[1].matchAll(/^\s*-\s*(.+)$/gm)].map((entry) => entry[1].trim());
    assert.deepEqual(branches, ["main"]);
  });

  test(`${workflow.path} serializes duplicate evidence for one exact source`, () => {
    const source = readWorkflow(workflow.path);
    const start = source.indexOf("\nconcurrency:\n");
    const end = source.indexOf("\n\npermissions:", start);
    assert.notEqual(start, -1, "top-level concurrency is required");
    assert.notEqual(end, -1, "concurrency must precede permissions");
    const block = source.slice(start, end);
    assert.match(block, /github\.workflow/);
    assert.match(block, /github\.ref/);
    assert.match(block, /github\.sha/);
    assert.match(block, /cancel-in-progress:\s*true/);
  });

  test(`${workflow.path} keeps security-patched Node runtime`, () => {
    const source = readWorkflow(workflow.path);
    assert.ok(source.includes("node-version: '22.23.4'"));
  });

  test(`${workflow.path} uses immutable action revisions`, () => {
    const source = readWorkflow(workflow.path);
    const actionRefs = [...source.matchAll(/uses:\s+([^@\s]+)@([^\s]+)/g)];
    assert.ok(actionRefs.length >= 3, "expected checkout, setup-node, and upload-artifact");
    for (const [, action, ref] of actionRefs) {
      assert.match(ref, /^[0-9a-f]{40}$/, `${action} must use an immutable commit SHA`);
    }
  });

  test(`${workflow.path} checks out the event SHA without credentials`, () => {
    const source = readWorkflow(workflow.path);
    assert.match(
      source,
      /uses:\s+actions\/checkout@[0-9a-f]{40}\n\s+with:\n\s+ref:\s+\$\{\{ github\.sha \}\}\n\s+persist-credentials:\s+false/
    );
  });

  test(`${workflow.path} runs evidence only on main`, () => {
    const source = readWorkflow(workflow.path);
    assert.match(source, /jobs:\n\s{2}[^:\n]+:\n\s{4}if:\s+github\.ref == 'refs\/heads\/main'/);
  });

  test(`${workflow.path} binds artifacts to source and run identity`, () => {
    const source = readWorkflow(workflow.path);
    const artifact = escapeRegex(workflow.artifact);
    assert.match(
      source,
      new RegExp(`name:\\s+${artifact}-\\$\\{\\{ github\\.sha \\}\\}-\\$\\{\\{ github\\.run_id \\}\\}`)
    );
  });

  test(`${workflow.path} keeps least privilege`, () => {
    const source = readWorkflow(workflow.path);
    assert.match(source, /permissions:\n\s{2}contents:\s+read\n/);
    assert.doesNotMatch(source, /contents:\s+write|pull-requests:\s+write|id-token:\s+write/);
  });
}
