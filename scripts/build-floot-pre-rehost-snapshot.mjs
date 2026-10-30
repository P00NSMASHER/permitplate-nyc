#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const inputPath = process.argv[2] ?? process.env.FLOOT_RAW_CAPTURE_PATH ?? '';
const outputPath = process.argv[3] ?? process.env.FLOOT_SNAPSHOT_PATH ?? '';

if (!inputPath) {
  throw new Error(
    'Usage: node scripts/build-floot-pre-rehost-snapshot.mjs <raw-capture.json> [output.json]'
  );
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);

const mandatoryPaths = [
  'endpoints/pa-business_GET.ts',
  'endpoints/pa-business_GET.schema.ts',
  'endpoints/pa-entity-one_GET.ts',
  'endpoints/pa-entity-one_GET.schema.ts',
  'static/openapi.json',
  'static/llms.txt',
  'static/llms-full.txt',
  'static/skill.txt',
  'static/.well-known/x402',
  'static/.well-known/x402.json',
  'static/.well-known/x402-services.json',
  'static/.well-known/x402-service.json',
  'static/.well-known/x402-catalog.json',
  'static/.well-known/security.txt',
  'static/sitemap.xml',
  'static/robots.txt',
];

if (raw.projectId !== queue.projectId) throw new Error('project_id_mismatch');
if (raw.productionOrigin !== queue.productionOrigin) {
  throw new Error('production_origin_mismatch');
}
if (!Number.isInteger(raw.projectVersion) || raw.projectVersion < 0) {
  throw new Error('invalid_project_version');
}
if (!Array.isArray(raw.projectPaths)) throw new Error('projectPaths_required');
if (!Array.isArray(raw.files)) throw new Error('files_required');

const projectPaths = new Set(raw.projectPaths);
for (const path of mandatoryPaths) {
  if (!projectPaths.has(path)) {
    throw new Error('mandatory_baseline_missing:' + path);
  }
}
const captured = new Map();

for (const entry of raw.files) {
  const path = String(entry?.path ?? '');
  if (!path) throw new Error('capture_entry_missing_path');
  if (captured.has(path)) throw new Error('duplicate_capture_path:' + path);

  const exists = entry?.exists !== false && projectPaths.has(path);
  if (exists && typeof entry?.content !== 'string') {
    throw new Error('missing_content_for_existing_path:' + path);
  }
  if (!exists && entry?.content != null) {
    throw new Error('content_for_absent_path:' + path);
  }

  captured.set(path, {
    path,
    exists,
    content: exists ? entry.content : null,
  });
}

const deployTargets = queue.writes.map((entry) => entry.target);
const preexistingRecoveryTargets = deployTargets.filter((path) =>
  projectPaths.has(path)
);
const absentRecoveryTargets = deployTargets.filter(
  (path) => !projectPaths.has(path)
);

const requiredCapturePaths = new Set([
  ...mandatoryPaths,
  ...preexistingRecoveryTargets,
]);

for (const path of requiredCapturePaths) {
  const entry = captured.get(path);
  if (!entry) throw new Error('required_capture_missing:' + path);
  if (projectPaths.has(path) && entry.exists !== true) {
    throw new Error('existing_path_not_captured:' + path);
  }
}

const files = [...requiredCapturePaths]
  .sort()
  .map((path) => {
    const entry = captured.get(path);
    if (!entry.exists) {
      return {
        path,
        exists: false,
        content: null,
        byteLength: 0,
        sha256: null,
      };
    }
    const bytes = Buffer.from(entry.content, 'utf8');
    return {
      path,
      exists: true,
      content: entry.content,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });

const snapshot = {
  projectId: raw.projectId,
  projectVersion: raw.projectVersion,
  productionOrigin: raw.productionOrigin,
  capturedAt: raw.capturedAt ?? new Date().toISOString(),
  sourceBranch: queue.sourceBranch ?? null,
  sourceCommit: queue.sourceCommit ?? null,
  files,
  preexistingRecoveryTargets,
  absentRecoveryTargets,
  notes: Array.isArray(raw.notes) ? raw.notes : [],
};

const json = JSON.stringify(snapshot, null, 2) + '\n';

if (outputPath) {
  await writeFile(outputPath, json, 'utf8');
  console.log('snapshot=' + outputPath);
} else {
  process.stdout.write(json);
}

console.error(
  JSON.stringify(
    {
      ok: true,
      projectVersion: snapshot.projectVersion,
      capturedFiles: files.length,
      preexistingRecoveryTargets: preexistingRecoveryTargets.length,
      absentRecoveryTargets: absentRecoveryTargets.length,
    },
    null,
    2
  )
);
