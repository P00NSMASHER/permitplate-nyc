'use strict';

const assert = require('assert');
const r = require('./socrata-reader');

function response(status, body, headers) {
  const h = Object.assign({}, headers || {});
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {get(name) { return h[String(name).toLowerCase()] || h[name] || null; }},
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

function makeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({url, options});
    return handler(new URL(url), options, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const freshEpoch = Math.floor(Date.parse('2026-09-21T13:00:00Z') / 1000);
const metadata = {
  rowsUpdatedAt:freshEpoch,
  columns:[
    {fieldName:'camis'},
    {fieldName:'dba'},
    {fieldName:'record_date'}
  ]
};

(async () => {
  // Complete three-row scan over two pages.
  {
    const fetchFn = makeFetch((url) => {
      if (url.pathname === '/api/views/43nn-pn8j') return response(200, metadata);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'3'}]);
      const offset = Number(url.searchParams.get('$offset') || 0);
      if (offset === 0) return response(200, [
        {camis:'1',dba:'A',record_date:'2026-09-21'},
        {camis:'2',dba:'B',record_date:'2026-09-21'}
      ]);
      if (offset === 2) return response(200, [
        {camis:'3',dba:'C',record_date:'2026-09-21'}
      ]);
      return response(200, []);
    });

    const batch = await r.readSocrataSource('DOHMH', {
      fetchFn,
      observedAt:'2026-09-21T14:00:00Z',
      pageSize:2,
      where:"record_date >= '2026-09-21T00:00:00.000'",
      order:'camis ASC',
      maxAgeDays:3
    });

    assert.equal(batch.observation.state, 'COMPLETE_NONEMPTY');
    assert.equal(batch.observation.publisherCount, 3);
    assert.equal(batch.observation.fetchedCount, 3);
    assert.equal(batch.observation.cursorClosed, true);
    assert.equal(batch.records.length, 3);
    assert.equal(batch.observation.rawPageHashes.length, 2);
    assert(batch.observation.queryScopeHash);

    const countCall = fetchFn.calls.find((call) => new URL(call.url).searchParams.get('$select') === 'count(*)');
    const dataCalls = fetchFn.calls.filter((call) => new URL(call.url).searchParams.get('$limit'));
    assert(countCall);
    assert.equal(new URL(countCall.url).searchParams.get('$where'), "record_date >= '2026-09-21T00:00:00.000'");
    assert(dataCalls.every((call) => new URL(call.url).searchParams.get('$where') === "record_date >= '2026-09-21T00:00:00.000'"));
  }

  // Verified empty requires metadata + count + actual [] page.
  {
    const fetchFn = makeFetch((url) => {
      if (url.pathname === '/api/views/f8i8-k2gm') {
        return response(200, {
          rowsUpdatedAt:freshEpoch,
          columns:[{fieldName:'application_id'},{fieldName:'status'}]
        });
      }
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'0'}]);
      return response(200, []);
    });

    const batch = await r.readSocrataSource('SLA_PENDING', {
      fetchFn,
      observedAt:'2026-09-21T14:00:00Z',
      maxAgeDays:7
    });
    assert.equal(batch.observation.state, 'VERIFIED_EMPTY');
    assert.equal(batch.observation.supportsAbsenceConclusion, true);
    assert.equal(batch.observation.rawPageHashes.length, 1);
  }

  // Mid-pagination failure retains the positive first page as PARTIAL.
  {
    const fetchFn = makeFetch((url) => {
      if (url.pathname === '/api/views/43nn-pn8j') return response(200, metadata);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'3'}]);
      const offset = Number(url.searchParams.get('$offset') || 0);
      if (offset === 0) return response(200, [
        {camis:'1',dba:'A',record_date:'2026-09-21'},
        {camis:'2',dba:'B',record_date:'2026-09-21'}
      ]);
      return response(503, {error:'temporary'});
    });

    const batch = await r.readSocrataSource('DOHMH', {
      fetchFn,
      observedAt:'2026-09-21T14:00:00Z',
      pageSize:2,
      maxAgeDays:3
    });
    assert.equal(batch.observation.state, 'PARTIAL');
    assert.equal(batch.observation.supportsPositiveObservation, true);
    assert.equal(batch.observation.supportsAbsenceConclusion, false);
    assert.equal(batch.records.length, 2);
  }

  // Explicit maxRows sample is PARTIAL, never complete.
  {
    const fetchFn = makeFetch((url) => {
      if (url.pathname === '/api/views/43nn-pn8j') return response(200, metadata);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'3'}]);
      return response(200, [{camis:'1',dba:'A',record_date:'2026-09-21'}]);
    });

    const batch = await r.readSocrataSource('DOHMH', {
      fetchFn,
      observedAt:'2026-09-21T14:00:00Z',
      maxRows:1,
      maxAgeDays:3
    });
    assert.equal(batch.observation.state, 'PARTIAL');
    assert.equal(batch.observation.intendedFullScope, false);
  }

  // Metadata/source redirect is SOURCE_MOVED rather than empty.
  {
    const fetchFn = makeFetch((url) => {
      if (url.pathname === '/api/views/43nn-pn8j') {
        return response(301, '', {location:'https://new.example/api/views/43nn-pn8j'});
      }
      throw new Error('unexpected request');
    });

    const batch = await r.readSocrataSource('DOHMH', {
      fetchFn,
      observedAt:'2026-09-21T14:00:00Z'
    });
    assert.equal(batch.observation.state, 'SOURCE_MOVED');
    assert.equal(batch.observation.redirectTarget, 'https://new.example/api/views/43nn-pn8j');
  }

  // Stale metadata never authorizes positive delivery or absence.
  {
    const staleMetadata = {
      rowsUpdatedAt:Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000),
      columns:[{fieldName:'camis'},{fieldName:'dba'}]
    };
    const fetchFn = makeFetch((url) => {
      if (url.pathname === '/api/views/43nn-pn8j') return response(200, staleMetadata);
      if (url.searchParams.get('$select') === 'count(*)') return response(200, [{count:'1'}]);
      return response(200, [{camis:'1',dba:'A'}]);
    });

    const batch = await r.readSocrataSource('DOHMH', {
      fetchFn,
      observedAt:'2026-09-21T14:00:00Z',
      maxAgeDays:3
    });
    assert.equal(batch.observation.state, 'UNKNOWN');
    assert.equal(batch.observation.sourceFresh, false);
    assert.equal(batch.observation.supportsPositiveObservation, false);
  }

  // Deterministic scope hash is representation-stable for the same options.
  {
    const config = require('./source-adapters').SOURCE_CONFIGS.DOHMH;
    const a = r.queryScope(config, {where:'x = 1', order:'camis ASC'});
    const b = r.queryScope(config, {order:'camis ASC', where:'x = 1'});
    assert.equal(r.sha256(r.stableStringify(a)), r.sha256(r.stableStringify(b)));
  }

  console.log('PermitPlate Socrata reader tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
