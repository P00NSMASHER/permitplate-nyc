'use strict';

const assert = require('assert');
const {observeSocrataQuery, queryFingerprint} = require('./socrata-observer');
const {getSource} = require('./source-registry');

function response(status, body, headers) {
  const map = new Map(Object.entries(headers || {}).map(([k,v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {get: (name) => map.get(String(name).toLowerCase()) || null},
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function mockFetch(handler) {
  return async (url, options) => handler(new URL(url), options || {});
}

const NOW = Date.parse('2026-09-21T14:00:00Z');
const FRESH = Math.floor(Date.parse('2026-09-21T13:00:00Z') / 1000);
const STALE = Math.floor(Date.parse('2026-09-01T13:00:00Z') / 1000);
const META = {
  rowsUpdatedAt: FRESH,
  columns: [
    {id:1, fieldName:'id', dataTypeName:'text', position:1},
    {id:2, fieldName:'status', dataTypeName:'text', position:2}
  ]
};

(async () => {
  {
    const source = getSource('DOHMH');
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) return response(200, META);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'3'}]);
      const offset = Number(url.searchParams.get('$offset') || 0);
      if (offset === 0) return response(200, [{id:'1'}, {id:'2'}]);
      if (offset === 2) return response(200, [{id:'3'}]);
      return response(200, []);
    });
    const result = await observeSocrataQuery(source, {where:"status='ACTIVE'", order:'id'}, {
      fetchImpl, nowMs:NOW, pageSize:2, maxRows:10
    });
    assert.equal(result.records.length, 3);
    assert.equal(result.receipt.publisherCount, 3);
    assert.equal(result.receipt.cursorClosed, true);
    assert(result.receipt.queryFingerprint);
    assert.equal(result.classification.state, 'COMPLETE_NONEMPTY');
    assert.equal(result.classification.supportsAbsenceConclusion, true);
  }

  {
    const source = getSource('SLA');
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) return response(200, META);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'0'}]);
      return response(200, []);
    });
    const result = await observeSocrataQuery(source, {where:"premises_county='NEW YORK'"}, {
      fetchImpl, nowMs:NOW
    });
    assert.equal(result.records.length, 0);
    assert.equal(result.receipt.cursorClosed, true);
    assert.equal(result.receipt.rawPageHashes.length, 2);
    assert.equal(result.classification.state, 'VERIFIED_EMPTY');
  }

  {
    const source = getSource('SLA');
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) return response(200, META);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'0'}]);
      return response(200, [{id:'unexpected-row'}]);
    });
    const result = await observeSocrataQuery(source, {where:"status='PENDING'"}, {
      fetchImpl, nowMs:NOW
    });
    assert.equal(result.records.length, 1);
    assert.equal(result.receipt.cursorClosed, false);
    assert.equal(result.classification.state, 'PARTIAL');
    assert.equal(result.classification.supportsAbsenceConclusion, false);
  }

  {
    const source = getSource('DOB');
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) return response(200, META);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'5'}]);
      return response(200, [{id:'1'}, {id:'2'}]);
    });
    const result = await observeSocrataQuery(source, {where:"borough='MANHATTAN'"}, {
      fetchImpl, nowMs:NOW, pageSize:2, maxRows:2
    });
    assert.equal(result.records.length, 2);
    assert.equal(result.receipt.publisherCount, 5);
    assert.equal(result.receipt.cursorClosed, false);
    assert.equal(result.classification.state, 'PARTIAL');
    assert.equal(result.classification.supportsAbsenceConclusion, false);
  }

  {
    const source = getSource('DOHMH');
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) {
        return response(301, '', {location:'https://new.example/api/views/43nn-pn8j'});
      }
      throw new Error('should stop on moved metadata source');
    });
    const result = await observeSocrataQuery(source, {}, {fetchImpl, nowMs:NOW});
    assert.equal(result.classification.state, 'SOURCE_MOVED');
    assert.equal(result.receipt.redirectTarget, 'https://new.example/api/views/43nn-pn8j');
  }

  {
    const source = getSource('DOHMH');
    let page = 0;
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) return response(200, META);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'3'}]);
      page += 1;
      if (page === 1) return response(200, [{id:'1'}, {id:'2'}]);
      return response(503, {error:'down'});
    });
    const result = await observeSocrataQuery(source, {}, {
      fetchImpl, nowMs:NOW, pageSize:2, maxRows:10
    });
    assert.equal(result.records.length, 2);
    assert.equal(result.receipt.transportOk, false);
    assert.equal(result.classification.state, 'PARTIAL');
    assert.equal(result.classification.reason, 'PARTIAL_FETCH_BEFORE_FAILURE');
  }

  {
    const source = Object.assign({}, getSource('DOB'), {maxFreshnessHours:24});
    const fetchImpl = mockFetch((url) => {
      if (url.pathname.includes('/api/views/')) return response(200, Object.assign({}, META, {rowsUpdatedAt:STALE}));
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'0'}]);
      throw new Error('unexpected');
    });
    const result = await observeSocrataQuery(source, {}, {fetchImpl, nowMs:NOW});
    assert.equal(result.receipt.sourceFresh, false);
    assert.equal(result.classification.state, 'UNKNOWN');
    assert.equal(result.classification.reason, 'SOURCE_NOT_FRESH');
  }

  {
    const source = getSource('DOB');
    const a = queryFingerprint(source, {where:"borough='MANHATTAN'", select:'a,b'});
    const b = queryFingerprint(source, {select:'a,b', where:"borough='MANHATTAN'"});
    const c = queryFingerprint(source, {where:"borough='QUEENS'", select:'a,b'});
    assert.equal(a, b);
    assert.notEqual(a, c);
  }

  console.log('PermitPlate Socrata observer regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
