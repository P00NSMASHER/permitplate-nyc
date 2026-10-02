"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TICKERS_URL,
  SUBMISSIONS_BASE,
  normalizeCik,
  normalizeTicker,
  createSecFilingsAdapter,
} = require("./sec-filings");

function response(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

test("normalizes CIK and ticker", () => {
  assert.equal(normalizeCik("320193"), "0000320193");
  assert.equal(normalizeCik("CIK 320193"), "0000320193");
  assert.equal(normalizeCik(""), null);
  assert.equal(normalizeTicker(" aapl "), "AAPL");
  assert.equal(normalizeTicker("brk.b"), "BRK.B");
});

test("ticker resolves through SEC map and returns filings", async () => {
  const calls = [];
  const adapter = createSecFilingsAdapter({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === TICKERS_URL) {
        return response({
          "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
        });
      }
      assert.equal(url, SUBMISSIONS_BASE + "0000320193.json");
      return response({
        name: "Apple Inc.",
        tickers: ["AAPL"],
        exchanges: ["Nasdaq"],
        sic: "3571",
        sicDescription: "Electronic Computers",
        filings: {
          recent: {
            form: ["8-K", "10-Q"],
            filingDate: ["2026-10-01", "2026-08-01"],
            reportDate: ["2026-09-30", "2026-06-30"],
            acceptanceDateTime: ["20261001120000", "20260801120000"],
            accessionNumber: ["0000320193-26-000001", "0000320193-26-000002"],
            primaryDocument: ["a8k.htm", "a10q.htm"],
            primaryDocDescription: ["8-K", "10-Q"],
          },
        },
      });
    },
  });

  const result = await adapter.lookup({ ticker: "AAPL", limit: 25 });
  assert.equal(calls.length, 2);
  assert.equal(result.available, true);
  assert.equal(result.found, true);
  assert.equal(result.company.cik, "0000320193");
  assert.equal(result.filings.length, 2);
  assert.match(result.filings[0].filingUrl, /Archives\/edgar\/data\/320193/);
});

test("form filter is exact and case-insensitive", async () => {
  const adapter = createSecFilingsAdapter({
    fetchImpl: async () => response({
      name: "Apple Inc.",
      tickers: ["AAPL"],
      exchanges: ["Nasdaq"],
      filings: {
        recent: {
          form: ["8-K", "10-Q"],
          filingDate: ["2026-10-01", "2026-08-01"],
          accessionNumber: ["1", "2"],
          primaryDocument: ["a.htm", "b.htm"],
        },
      },
    }),
  });
  const result = await adapter.lookup({ cik: "320193", form: "8-k" });
  assert.deepEqual(result.filings.map((f) => f.form), ["8-K"]);
});

test("unknown ticker is a completed not-found result", async () => {
  const adapter = createSecFilingsAdapter({
    fetchImpl: async () => response({
      "0": { cik_str: 320193, ticker: "AAPL" },
    }),
  });
  const result = await adapter.lookup({ ticker: "ZZZZ" });
  assert.equal(result.available, true);
  assert.equal(result.found, false);
  assert.deepEqual(result.filings, []);
});

test("SEC transport error throws source error", async () => {
  const adapter = createSecFilingsAdapter({
    fetchImpl: async () => response({}, 503),
  });
  await assert.rejects(
    () => adapter.lookup({ cik: "320193" }),
    (error) => error.code === "SOURCE_HTTP_ERROR"
  );
});

test("invalid SEC recent-filings shape throws contract error", async () => {
  const adapter = createSecFilingsAdapter({
    fetchImpl: async () => response({ name: "Apple Inc.", filings: {} }),
  });
  await assert.rejects(
    () => adapter.lookup({ cik: "320193" }),
    (error) => error.code === "SOURCE_CONTRACT_INVALID"
  );
});
