'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function asTime(value, field) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) throw new Error(`Invalid ${field}`);
  return t;
}

function normalizedSet(values) {
  return new Set((values || []).map(v => String(v).trim().toUpperCase()).filter(Boolean));
}

function matchesProfile(signal, subscriber) {
  const boroughs = normalizedSet(subscriber.boroughs);
  if (boroughs.size && !boroughs.has(String(signal.borough || '').trim().toUpperCase())) return false;

  const categories = normalizedSet(subscriber.categories);
  if (categories.size) {
    const signalCategories = normalizedSet(signal.categories);
    let overlap = false;
    for (const c of signalCategories) if (categories.has(c)) overlap = true;
    if (!overlap) return false;
  }

  const minScore = Number(subscriber.minScore ?? 0);
  if (Number(signal.bestScore ?? 0) < minScore) return false;
  if (signal.deliverySuppressed) return false;
  return true;
}

function latestMaterialTime(signal) {
  return Math.max(
    asTime(signal.detectedAt, 'detectedAt'),
    signal.materiallyChangedAt ? asTime(signal.materiallyChangedAt, 'materiallyChangedAt') : -Infinity,
  );
}

function changeIdentity(signal) {
  return String(
    signal.changeVersion ||
    signal.materiallyChangedAt ||
    signal.detectedAt
  );
}

function selectNormalFeed(signals, subscriber) {
  const baseline = asTime(subscriber.baselineAt, 'baselineAt');
  return signals
    .filter(signal => matchesProfile(signal, subscriber))
    .filter(signal => latestMaterialTime(signal) > baseline)
    .filter(signal => signal.changeState !== 'NO_MEANINGFUL_CHANGE')
    .map(signal => ({
      ...signal,
      deliveryClass: 'NORMAL_FEED',
      deliveryKey: `feed:${subscriber.id}:${signal.signalId}:${changeIdentity(signal)}`,
    }))
    .sort((a, b) => latestMaterialTime(b) - latestMaterialTime(a));
}

function selectStarterSnapshot(signals, subscriber, limit = 10) {
  if (!subscriber.starterSnapshotEnabled) return [];
  if (!Number.isInteger(limit) || limit < 0 || limit > 10) {
    throw new Error('Starter Snapshot limit must be 0..10');
  }
  const baseline = asTime(subscriber.baselineAt, 'baselineAt');
  const lower = baseline - 7 * DAY_MS;

  return signals
    .filter(signal => signal.active === true)
    .filter(signal => matchesProfile(signal, subscriber))
    .filter(signal => {
      const detected = asTime(signal.detectedAt, 'detectedAt');
      return detected >= lower && detected <= baseline;
    })
    .filter(signal => signal.changeState !== 'NO_MEANINGFUL_CHANGE')
    .sort((a, b) => Number(b.bestScore ?? 0) - Number(a.bestScore ?? 0) || asTime(b.detectedAt, 'detectedAt') - asTime(a.detectedAt, 'detectedAt'))
    .slice(0, limit)
    .map(signal => ({
      ...signal,
      deliveryClass: 'STARTER_SNAPSHOT',
      originalDetectedAt: signal.detectedAt,
      deliveryKey: `snapshot:${subscriber.id}:${signal.signalId}:${subscriber.baselineAt}`,
    }));
}

module.exports = { selectNormalFeed, selectStarterSnapshot, matchesProfile };
