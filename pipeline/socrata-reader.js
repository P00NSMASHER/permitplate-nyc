'use strict';

const crypto = require('crypto');
const adapters = require('./source-adapters');

const READER_VERSION = 'PermitPlate-socrata-reader-v1.0.0';

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

function datasetId(config) {
  return String(config.sourceId || '').split(':').pop();
}

function originFor(config) {
  return new URL(config.apiUrl).origin;
}

function queryScope(config, options) {
  const opts = options || {};
  return {
    readerVersion: READER_VERSION,
    sourceId: config.sourceId,
    where: opts.where || null,
    order: opts.order || null,
    select: opts.select || config.recordFields.join(',')
  };
}

function resourceUrl(config, params) {
  const url = new URL(config.apiUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function metadataUrl(config) {
  return `${originFor(config)}/api/views/${datasetId(config)}`;
}

async function responseBody(response) {
  const body = await response.text();
  return {body, json: body ? JSON.parse(body) : null};
}

function movedResult(response) {
  return response && response.status >= 300 && response.status < 400;
}

async function getText(fetchFn, url, options) {
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      headers: Object.assign({
        'Accept': 'application/json',
        'User-Agent': 'PermitPlate/1.0 public-source-monitor'
      }, options && options.headers || {})
    });
    if (movedResult(response)) {
      return {
        ok: false,
        moved: true,
        status: response.status,
        redirectTarget: response.headers && response.headers.get ?
          response.headers.get('location') : null,
        body: ''
      };
    }
    const body = await response.text();
    return {
      ok: response.ok,
      moved: false,
      status: response.status,
      redirectTarget: null,
      body
    };
  } catch (error) {
    return {
      ok: false,
      moved: false,
      status: null,
      redirectTarget: null,
      body: '',
      error: error && error.message ? error.message : String(error)
    };
  }
}

function parseJson(body, fallback) {
  if (!body) return fallback;
  try {
    return JSON.parse(body);
  } catch (_) {
    return fallback;
  }
}

function epochSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function metadataFreshness(metadata, observedAt, maxAgeDays) {
  const candidates = [
    epochSeconds(metadata && metadata.rowsUpdatedAt),
    epochSeconds(metadata && metadata.dataUpdatedAt),
    epochSeconds(metadata && metadata.viewLastModified)
  ].filter(Boolean);
  if (!candidates.length) return {fresh: false, ageMs: null, updatedAt: null};
  const latest = Math.max(...candidates) * 1000;
  const now = Date.parse(observedAt);
  const ageMs = Number.isFinite(now) ? Math.max(0, now - latest) : null;
  const maxAgeMs = Math.max(0, Number(maxAgeDays) || 0) * 24 * 60 * 60 * 1000;
  return {
    fresh: ageMs !== null && ageMs <= maxAgeMs,
    ageMs,
    updatedAt: new Date(latest).toISOString()
  };
}

function schemaFields(metadata) {
  return Array.isArray(metadata && metadata.columns) ?
    metadata.columns.map((column) => column && column.fieldName).filter(Boolean) : [];
}

function countFromPayload(payload) {
  if (!Array.isArray(payload) || !payload.length) return null;
  const value = payload[0] && (payload[0].count ?? payload[0].COUNT ?? payload[0].Count);
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function readSocrataSource(sourceKey, options) {
  const opts = options || {};
  const fetchFn = opts.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('fetch implementation is required');
  const config = adapters.SOURCE_CONFIGS[sourceKey];
  if (!config) throw new Error(`Unknown sourceKey: ${sourceKey}`);

  const observedAt = opts.observedAt || new Date().toISOString();
  const pageSize = Math.max(1, Math.min(50000, Number(opts.pageSize) || 5000));
  const maxRows = Number.isFinite(Number(opts.maxRows)) ? Math.max(0, Number(opts.maxRows)) : Infinity;
  const maxAgeDays = Number.isFinite(Number(opts.maxAgeDays)) ? Math.max(0, Number(opts.maxAgeDays)) : 7;
  const scope = queryScope(config, opts);
  const queryScopeHash = sha256(stableStringify(scope));
  const headers = opts.appToken ? {'X-App-Token': opts.appToken} : {};

  const metaResp = await getText(fetchFn, metadataUrl(config), {headers});
  if (metaResp.moved) {
    return adapters.normalizeBatch(sourceKey, {
      observedAt,
      sourceFresh:false,
      transportOk:true,
      httpStatus:metaResp.status,
      redirected:true,
      sourceMoved:true,
      redirectTarget:metaResp.redirectTarget,
      intendedFullScope:true,
      queryScope:scope,
      queryScopeHash,
      publisherCount:null,
      cursorClosed:false,
      schemaFields:[],
      rawPages:[],
      rows:[]
    });
  }
  if (!metaResp.ok) {
    return adapters.normalizeBatch(sourceKey, {
      observedAt,
      sourceFresh:false,
      transportOk:false,
      httpStatus:metaResp.status,
      intendedFullScope:true,
      queryScope:scope,
      queryScopeHash,
      publisherCount:null,
      cursorClosed:false,
      schemaFields:[],
      rawPages:[],
      rows:[]
    });
  }

  const metadata = parseJson(metaResp.body, {});
  const fields = schemaFields(metadata);
  const freshness = metadataFreshness(metadata, observedAt, maxAgeDays);

  const countParams = {'$select':'count(*)'};
  if (opts.where) countParams['$where'] = opts.where;
  const countResp = await getText(fetchFn, resourceUrl(config, countParams), {headers});
  if (countResp.moved) {
    return adapters.normalizeBatch(sourceKey, {
      observedAt,
      sourceFresh:freshness.fresh,
      transportOk:true,
      httpStatus:countResp.status,
      redirected:true,
      sourceMoved:true,
      redirectTarget:countResp.redirectTarget,
      intendedFullScope:true,
      queryScope:scope,
      queryScopeHash,
      publisherCount:null,
      cursorClosed:false,
      schemaFields:fields,
      rawPages:[],
      rows:[]
    });
  }
  if (!countResp.ok) {
    return adapters.normalizeBatch(sourceKey, {
      observedAt,
      sourceFresh:freshness.fresh,
      transportOk:false,
      httpStatus:countResp.status,
      intendedFullScope:true,
      queryScope:scope,
      queryScopeHash,
      publisherCount:null,
      cursorClosed:false,
      schemaFields:fields,
      rawPages:[],
      rows:[]
    });
  }

  const publisherCount = countFromPayload(parseJson(countResp.body, []));
  if (publisherCount === null) {
    return adapters.normalizeBatch(sourceKey, {
      observedAt,
      sourceFresh:freshness.fresh,
      transportOk:false,
      httpStatus:countResp.status,
      intendedFullScope:true,
      queryScope:scope,
      queryScopeHash,
      publisherCount:null,
      cursorClosed:false,
      schemaFields:fields,
      rawPages:[countResp.body],
      rows:[]
    });
  }

  const rows = [];
  const rawPages = [];
  let offset = 0;
  let transportOk = true;
  let httpStatus = 200;
  let sourceMoved = false;
  let redirectTarget = null;

  // Even when count=0, fetch one empty data page so the receipt binds the actual
  // query response in addition to the count and schema metadata.
  do {
    const remaining = Math.min(pageSize, Number.isFinite(maxRows) ? Math.max(0, maxRows - rows.length) : pageSize);
    if (remaining <= 0) break;
    const params = {
      '$select': opts.select || config.recordFields.join(','),
      '$limit': publisherCount === 0 ? 1 : remaining,
      '$offset': offset
    };
    if (opts.where) params['$where'] = opts.where;
    if (opts.order) params['$order'] = opts.order;

    const pageResp = await getText(fetchFn, resourceUrl(config, params), {headers});
    if (pageResp.moved) {
      sourceMoved = true;
      redirectTarget = pageResp.redirectTarget;
      httpStatus = pageResp.status;
      transportOk = true;
      break;
    }
    if (!pageResp.ok) {
      transportOk = false;
      httpStatus = pageResp.status;
      break;
    }

    rawPages.push(pageResp.body);
    const pageRows = parseJson(pageResp.body, null);
    if (!Array.isArray(pageRows)) {
      transportOk = false;
      httpStatus = pageResp.status;
      break;
    }

    rows.push(...pageRows);
    offset += pageRows.length;

    if (publisherCount === 0 || pageRows.length === 0 || offset >= publisherCount) break;
    if (pageRows.length < remaining) break;
    if (rows.length >= maxRows) break;
  } while (true);

  const intendedFullScope = maxRows >= publisherCount;
  const cursorClosed = transportOk && !sourceMoved && intendedFullScope && rows.length === publisherCount;

  return adapters.normalizeBatch(sourceKey, {
    observedAt,
    sourceFresh:freshness.fresh,
    transportOk,
    httpStatus,
    redirected:sourceMoved,
    sourceMoved,
    redirectTarget,
    intendedFullScope,
    queryScope:scope,
    queryScopeHash,
    publisherCount,
    cursorClosed,
    schemaFields:fields,
    rawPages,
    rows
  });
}

module.exports = {
  READER_VERSION,
  stableStringify,
  sha256,
  datasetId,
  queryScope,
  resourceUrl,
  metadataUrl,
  metadataFreshness,
  schemaFields,
  countFromPayload,
  readSocrataSource
};
