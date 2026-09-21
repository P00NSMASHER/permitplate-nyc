'use strict';

const crypto = require('crypto');
const model = require('../model-v7');

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeScope(scope) {
  const s = scope || {};
  const out = {};
  for (const key of ['where', 'select', 'order']) {
    if (s[key] !== null && s[key] !== undefined && String(s[key]).trim() !== '') {
      out[key] = String(s[key]).trim().replace(/\s+/g, ' ');
    }
  }
  return out;
}

function queryFingerprint(source, scope) {
  return sha256(stableStringify({
    domain: source.domain,
    datasetId: source.datasetId,
    scope: normalizeScope(scope)
  }));
}

function connectorConfigHash(source, options) {
  const o = options || {};
  return sha256(stableStringify({
    sourceId: source.sourceId,
    domain: source.domain,
    datasetId: source.datasetId,
    maxFreshnessHours: source.maxFreshnessHours,
    pageSize: Number(o.pageSize) || 1000,
    maxRows: Number(o.maxRows) || 10000
  }));
}

function schemaFingerprint(metadata) {
  const columns = Array.isArray(metadata && metadata.columns) ? metadata.columns : [];
  return sha256(stableStringify(columns.map((column) => ({
    id: column.id || null,
    fieldName: column.fieldName || null,
    dataTypeName: column.dataTypeName || null,
    position: column.position == null ? null : Number(column.position)
  }))));
}

function metadataUpdatedAt(metadata) {
  const raw = metadata && (metadata.rowsUpdatedAt || metadata.dataUpdatedAt || metadata.viewLastModified);
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function isFresh(metadata, observedAtMs, maxFreshnessHours) {
  const updatedAt = metadataUpdatedAt(metadata);
  if (updatedAt === null) return false;
  const ageMs = observedAtMs - updatedAt;
  return ageMs >= 0 && ageMs <= Number(maxFreshnessHours) * 60 * 60 * 1000;
}

function buildResourceUrl(source, params) {
  const url = new URL(`https://${source.domain}/resource/${source.datasetId}.json`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function fetchHeaders(appToken) {
  const headers = {Accept: 'application/json'};
  if (appToken) headers['X-App-Token'] = appToken;
  return headers;
}

async function readResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  return {text, json};
}

function baseReceipt(source, scope, options, observedAt) {
  const normalizedScope = normalizeScope(scope);
  const fingerprint = queryFingerprint(source, normalizedScope);
  return {
    observationId: 'OBS:' + sha256(stableStringify([
      source.sourceId,
      fingerprint,
      observedAt
    ])).slice(0, 24),
    sourceId: source.sourceId,
    sourceKey: source.key,
    sourceDomain: source.domain,
    datasetId: source.datasetId,
    connectorConfigHash: connectorConfigHash(source, options),
    queryFingerprint: fingerprint,
    queryScopeHash: fingerprint,
    queryScope: normalizedScope,
    observedAt,
    sourceFresh: false,
    transportOk: true,
    httpStatus: 200,
    sourceMoved: false,
    redirected: false,
    redirectTarget: null,
    intendedFullScope: true,
    publisherCount: null,
    fetchedCount: 0,
    cursorClosed: false,
    schemaFingerprint: null,
    rawPageHashes: [],
    metadataHash: null,
    countResponseHash: null,
    sourceUpdatedAt: null
  };
}

function movedReceipt(receipt, response) {
  return Object.assign(receipt, {
    transportOk: true,
    httpStatus: response.status,
    sourceMoved: true,
    redirected: true,
    redirectTarget: response.headers && response.headers.get ? response.headers.get('location') : null,
    cursorClosed: false
  });
}

function unavailableReceipt(receipt, responseOrError) {
  const status = responseOrError && Number(responseOrError.status);
  return Object.assign(receipt, {
    transportOk: false,
    httpStatus: Number.isFinite(status) ? status : null,
    cursorClosed: false
  });
}

async function observeSocrataQuery(source, scope, options) {
  const o = options || {};
  const fetchImpl = o.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation required');

  const pageSize = Math.max(1, Math.min(50000, Number(o.pageSize) || 1000));
  const maxRows = Math.max(1, Number(o.maxRows) || 10000);
  const observedAtMs = o.nowMs == null ? Date.now() : Number(o.nowMs);
  const observedAt = new Date(observedAtMs).toISOString();
  const receipt = baseReceipt(source, scope, {pageSize, maxRows}, observedAt);
  const headers = fetchHeaders(o.appToken);

  let metadata;
  try {
    const metadataResponse = await fetchImpl(
      `https://${source.domain}/api/views/${source.datasetId}`,
      {headers, redirect: 'manual'}
    );
    if (metadataResponse.status >= 300 && metadataResponse.status < 400) {
      const moved = movedReceipt(receipt, metadataResponse);
      return {records: [], receipt: moved, classification: model.classifySourceObservation(moved)};
    }
    if (!metadataResponse.ok) {
      const unavailable = unavailableReceipt(receipt, metadataResponse);
      return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
    }
    const parsed = await readResponse(metadataResponse);
    if (!parsed.json || typeof parsed.json !== 'object') {
      const unavailable = unavailableReceipt(receipt, metadataResponse);
      return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
    }
    metadata = parsed.json;
    receipt.metadataHash = sha256(parsed.text);
    receipt.schemaFingerprint = schemaFingerprint(metadata);
    receipt.sourceUpdatedAt = metadataUpdatedAt(metadata) === null ?
      null : new Date(metadataUpdatedAt(metadata)).toISOString();
    receipt.sourceFresh = isFresh(metadata, observedAtMs, source.maxFreshnessHours);
  } catch (error) {
    const unavailable = unavailableReceipt(receipt, error);
    return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
  }

  const normalized = normalizeScope(scope);
  const countParams = {'$select': 'count(*)'};
  if (normalized.where) countParams['$where'] = normalized.where;

  let publisherCount;
  try {
    const countResponse = await fetchImpl(buildResourceUrl(source, countParams), {headers, redirect: 'manual'});
    if (countResponse.status >= 300 && countResponse.status < 400) {
      const moved = movedReceipt(receipt, countResponse);
      return {records: [], receipt: moved, classification: model.classifySourceObservation(moved)};
    }
    if (!countResponse.ok) {
      const unavailable = unavailableReceipt(receipt, countResponse);
      return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
    }
    const parsed = await readResponse(countResponse);
    receipt.countResponseHash = sha256(parsed.text);
    receipt.rawPageHashes.push(receipt.countResponseHash);
    const row = Array.isArray(parsed.json) ? parsed.json[0] : null;
    publisherCount = row && row.count !== undefined ? Number(row.count) : NaN;
    if (!Number.isInteger(publisherCount) || publisherCount < 0) {
      receipt.transportOk = false;
      receipt.httpStatus = countResponse.status;
      return {records: [], receipt, classification: model.classifySourceObservation(receipt)};
    }
    receipt.publisherCount = publisherCount;
  } catch (error) {
    const unavailable = unavailableReceipt(receipt, error);
    return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
  }

  if (publisherCount === 0) {
    const emptyParams = {'$limit': 1, '$offset': 0};
    if (normalized.where) emptyParams['$where'] = normalized.where;
    if (normalized.select) emptyParams['$select'] = normalized.select;
    if (normalized.order) emptyParams['$order'] = normalized.order;

    try {
      const emptyResponse = await fetchImpl(buildResourceUrl(source, emptyParams), {headers, redirect: 'manual'});
      if (emptyResponse.status >= 300 && emptyResponse.status < 400) {
        const moved = movedReceipt(receipt, emptyResponse);
        return {records: [], receipt: moved, classification: model.classifySourceObservation(moved)};
      }
      if (!emptyResponse.ok) {
        const unavailable = unavailableReceipt(receipt, emptyResponse);
        return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
      }
      const parsed = await readResponse(emptyResponse);
      receipt.rawPageHashes.push(sha256(parsed.text));
      if (!Array.isArray(parsed.json)) {
        receipt.transportOk = false;
        receipt.httpStatus = emptyResponse.status;
        return {records: [], receipt, classification: model.classifySourceObservation(receipt)};
      }
      receipt.fetchedCount = parsed.json.length;
      receipt.cursorClosed = parsed.json.length === 0;
      const classification = model.classifySourceObservation(receipt);
      return {records: parsed.json, receipt, classification};
    } catch (error) {
      const unavailable = unavailableReceipt(receipt, error);
      return {records: [], receipt: unavailable, classification: model.classifySourceObservation(unavailable)};
    }
  }

  const records = [];
  let offset = 0;

  while (offset < publisherCount && records.length < maxRows) {
    const remainingBudget = maxRows - records.length;
    const limit = Math.min(pageSize, remainingBudget);
    const params = {'$limit': limit, '$offset': offset};
    if (normalized.where) params['$where'] = normalized.where;
    if (normalized.select) params['$select'] = normalized.select;
    if (normalized.order) params['$order'] = normalized.order;

    let pageResponse;
    try {
      pageResponse = await fetchImpl(buildResourceUrl(source, params), {headers, redirect: 'manual'});
      if (pageResponse.status >= 300 && pageResponse.status < 400) {
        movedReceipt(receipt, pageResponse);
        receipt.fetchedCount = records.length;
        return {records, receipt, classification: model.classifySourceObservation(receipt)};
      }
      if (!pageResponse.ok) {
        unavailableReceipt(receipt, pageResponse);
        receipt.fetchedCount = records.length;
        return {records, receipt, classification: model.classifySourceObservation(receipt)};
      }
      const parsed = await readResponse(pageResponse);
      receipt.rawPageHashes.push(sha256(parsed.text));
      if (!Array.isArray(parsed.json)) {
        receipt.transportOk = false;
        receipt.fetchedCount = records.length;
        return {records, receipt, classification: model.classifySourceObservation(receipt)};
      }
      records.push(...parsed.json);
      receipt.fetchedCount = records.length;
      offset += parsed.json.length;

      if (parsed.json.length === 0) break;
      if (parsed.json.length < limit && records.length < publisherCount) break;
    } catch (error) {
      unavailableReceipt(receipt, error);
      receipt.fetchedCount = records.length;
      return {records, receipt, classification: model.classifySourceObservation(receipt)};
    }
  }

  receipt.fetchedCount = records.length;
  receipt.cursorClosed = records.length === publisherCount;
  const classification = model.classifySourceObservation(receipt);
  return {records, receipt, classification};
}

module.exports = {
  stableStringify,
  sha256,
  normalizeScope,
  queryFingerprint,
  connectorConfigHash,
  schemaFingerprint,
  metadataUpdatedAt,
  isFresh,
  buildResourceUrl,
  observeSocrataQuery
};
