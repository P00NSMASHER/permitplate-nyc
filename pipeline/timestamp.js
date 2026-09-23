'use strict';

// Socrata commonly returns ISO-like timestamps without an explicit zone.
// Treat those legacy values as UTC so ordering and scoring do not depend on
// the computer running the pipeline. Explicit offsets remain authoritative.
function timestampMs(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const zoneLessIsoDateTime =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;
  const normalized = zoneLessIsoDateTime.test(raw) ? raw + 'Z' : raw;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {timestampMs};
