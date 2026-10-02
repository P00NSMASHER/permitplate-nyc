#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const timeout = (ms = 30000) => AbortSignal.timeout(ms);

async function fetchText(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    ...options,
    headers: {
      'user-agent': 'permitplate-vendor-gate-upstream-check/1.0',
      ...(options.headers ?? {}),
    },
    signal: timeout(options.timeoutMs ?? 30000),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    latencyMs: Date.now() - started,
    contentType: response.headers.get('content-type'),
    text,
  };
}

async function fetchJson(url, options = {}) {
  const result = await fetchText(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
  });
  let json = null;
  let error = null;
  try {
    json = JSON.parse(result.text);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { ...result, json, jsonError: error };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function main() {
  const checkedAt = new Date().toISOString();
  const report = {
    checkedAt,
    mode: 'zero-spend-direct-upstream-readiness',
    appdeployDependency: false,
    checks: {},
  };

  // Pennsylvania Department of State via data.pa.gov.
  {
    const url = new URL('https://data.pa.gov/resource/xvd7-5r2c.json');
    url.searchParams.set(
      '$select',
      [
        'business_name',
        'filing_number',
        'address_line1',
        'address_line2',
        'city',
        'state',
        'zip',
        'typeofbusinessregistration',
        'creationdate',
        'shortcountyname',
        'county_code',
      ].join(',')
    );
    url.searchParams.set('$where', "upper(business_name) like 'OPENAI%'");
    url.searchParams.set('$limit', '5');

    const result = await fetchJson(url.toString());
    const rows = Array.isArray(result.json) ? result.json : [];
    report.checks.paRegistry = {
      ok: result.ok && rows.length > 0,
      status: result.status,
      latencyMs: result.latencyMs,
      rowCount: rows.length,
      sample: rows.slice(0, 3).map((row) => ({
        business_name: row.business_name ?? null,
        filing_number: row.filing_number ?? null,
        registration_type: row.typeofbusinessregistration ?? null,
        address_line1: row.address_line1 ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        zip: row.zip ?? null,
      })),
      source: 'Pennsylvania Department of State via data.pa.gov',
      error: result.jsonError,
    };
  }

  // U.S. Census Geocoder.
  {
    const address =
      '600 North Second Street, Suite 401, Harrisburg, PA 17101';
    const url = new URL(
      'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
    );
    url.searchParams.set('address', address);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('vintage', 'Current_Current');
    url.searchParams.set('format', 'json');

    const result = await fetchJson(url.toString());
    const match = result.json?.result?.addressMatches?.[0] ?? null;
    report.checks.census = {
      ok:
        result.ok &&
        typeof match?.matchedAddress === 'string' &&
        Number.isFinite(Number(match?.coordinates?.x)) &&
        Number.isFinite(Number(match?.coordinates?.y)),
      status: result.status,
      latencyMs: result.latencyMs,
      input: address,
      matchedAddress: match?.matchedAddress ?? null,
      coordinates: match?.coordinates ?? null,
      source: 'U.S. Census Bureau Geocoding Services',
      error: result.jsonError,
    };
  }

  // OFAC SDN source files used by the current screening implementation.
  {
    const base =
      'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';
    const [sdn, alt] = await Promise.all([
      fetchText(base + '/SDN.CSV', {
        headers: { accept: 'text/csv,*/*' },
        timeoutMs: 45000,
      }),
      fetchText(base + '/ALT.CSV', {
        headers: { accept: 'text/csv,*/*' },
        timeoutMs: 45000,
      }),
    ]);

    report.checks.ofac = {
      ok:
        sdn.ok &&
        alt.ok &&
        sdn.text.length > 1000 &&
        alt.text.length > 1000,
      sdn: {
        status: sdn.status,
        latencyMs: sdn.latencyMs,
        bytes: Buffer.byteLength(sdn.text),
        sha256: sha256(sdn.text),
      },
      alt: {
        status: alt.status,
        latencyMs: alt.latencyMs,
        bytes: Buffer.byteLength(alt.text),
        sha256: sha256(alt.text),
      },
      source: 'U.S. Treasury OFAC Sanctions List Service',
    };
  }

  // IANA RDAP bootstrap + authoritative .com registry lookup.
  {
    const bootstrap = await fetchJson('https://data.iana.org/rdap/dns.json');
    const services = Array.isArray(bootstrap.json?.services)
      ? bootstrap.json.services
      : [];
    let base = null;
    for (const service of services) {
      const tlds = Array.isArray(service?.[0]) ? service[0] : [];
      const urls = Array.isArray(service?.[1]) ? service[1] : [];
      if (tlds.some((value) => String(value).toLowerCase() === 'com')) {
        base = urls[0] ?? null;
        break;
      }
    }

    let domain = null;
    if (base) {
      const url =
        String(base).replace(/\/+$/, '') +
        '/domain/' +
        encodeURIComponent('openai.com');
      domain = await fetchJson(url, {
        headers: { accept: 'application/rdap+json, application/json' },
      });
    }

    report.checks.rdap = {
      ok:
        bootstrap.ok &&
        typeof base === 'string' &&
        domain?.ok === true &&
        String(domain?.json?.ldhName ?? '').toLowerCase() === 'openai.com',
      bootstrapStatus: bootstrap.status,
      authoritativeBase: base,
      domainStatus: domain?.status ?? null,
      ldhName: domain?.json?.ldhName ?? null,
      handle: domain?.json?.handle ?? null,
      source: 'IANA RDAP bootstrap + authoritative registry RDAP',
      error: bootstrap.jsonError ?? domain?.jsonError ?? null,
    };
  }


  // SEC EDGAR ticker map + authoritative submissions feed.
  {
    const tickerMap = await fetchJson(
      'https://www.sec.gov/files/company_tickers.json',
      {
        headers: {
          accept: 'application/json',
          'user-agent':
            'permitplate-x402-rehost-readiness/1.0 https://pa-entity-x402.floot.app',
        },
      }
    );

    const rows =
      tickerMap.json && typeof tickerMap.json === 'object'
        ? Object.values(tickerMap.json)
        : [];
    const apple = rows.find(
      (row) => String(row?.ticker ?? '').toUpperCase() === 'AAPL'
    );
    const cik = apple?.cik_str == null
      ? null
      : String(apple.cik_str).replace(/\D/g, '').padStart(10, '0');

    let submissions = null;
    if (cik) {
      submissions = await fetchJson(
        'https://data.sec.gov/submissions/CIK' + cik + '.json',
        {
          headers: {
            accept: 'application/json',
            'user-agent':
              'permitplate-x402-rehost-readiness/1.0 https://pa-entity-x402.floot.app',
          },
        }
      );
    }

    const recentForms = Array.isArray(submissions?.json?.filings?.recent?.form)
      ? submissions.json.filings.recent.form
      : [];

    report.checks.sec = {
      ok:
        tickerMap.ok &&
        cik === '0000320193' &&
        submissions?.ok === true &&
        recentForms.length > 0,
      tickerMapStatus: tickerMap.status,
      tickerMapLatencyMs: tickerMap.latencyMs,
      cik,
      submissionsStatus: submissions?.status ?? null,
      submissionsLatencyMs: submissions?.latencyMs ?? null,
      recentFormCount: recentForms.length,
      source: 'U.S. Securities and Exchange Commission EDGAR',
      error: tickerMap.jsonError ?? submissions?.jsonError ?? null,
    };
  }

  // U.S. Treasury Fiscal Data average-interest-rates feed.
  {
    const url = new URL(
      'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates'
    );
    url.searchParams.set(
      'fields',
      'record_date,security_type_desc,security_desc,avg_interest_rate_amt'
    );
    url.searchParams.set('sort', '-record_date');
    url.searchParams.set('page[size]', '100');

    const result = await fetchJson(url.toString(), {
      headers: {
        accept: 'application/json',
        'user-agent':
          'permitplate-x402-rehost-readiness/1.0 https://pa-entity-x402.floot.app',
      },
    });
    const rows = Array.isArray(result.json?.data) ? result.json.data : [];
    const recordDate = rows[0]?.record_date ?? null;
    const totalMarketable = rows.find(
      (row) =>
        row?.record_date === recordDate &&
        String(row?.security_desc ?? '').toLowerCase() === 'total marketable'
    );

    report.checks.treasury = {
      ok:
        result.ok &&
        typeof recordDate === 'string' &&
        rows.length > 0 &&
        totalMarketable != null,
      status: result.status,
      latencyMs: result.latencyMs,
      rowCount: rows.length,
      latestRecordDate: recordDate,
      totalMarketableRate:
        totalMarketable?.avg_interest_rate_amt ?? null,
      source:
        'U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities',
      error: result.jsonError,
    };
  }

  const entries = Object.entries(report.checks);
  report.summary = {
    passed: entries.filter(([, value]) => value.ok).length,
    total: entries.length,
    allReady: entries.every(([, value]) => value.ok),
  };

  await mkdir('verification', { recursive: true });
  await writeFile(
    'verification/vendor-gate-upstreams-latest.json',
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );

  console.log(JSON.stringify(report.summary, null, 2));

  if (!report.summary.allReady) process.exitCode = 1;
}

await main();
