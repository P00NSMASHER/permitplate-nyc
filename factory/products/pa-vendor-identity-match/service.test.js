"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVendorIdentityService, entityAddress } = require("./service");

function adapters(overrides = {}) {
  return {
    registry: overrides.registry || {
      async lookup({ company }) {
        return {
          available: true,
          strongMatch: true,
          entity: {
            businessName: company,
            filingNumber: "123",
            address1: "100 Market St",
            address2: null,
            city: "Pottsville",
            state: "PA",
            zip: "17901",
          },
          provenance: { source: "PA Department of State" },
        };
      },
    },
    address: overrides.address || {
      async compare({ suppliedAddress, registryAddress }) {
        assert.equal(suppliedAddress, "100 Market St, Pottsville, PA 17901");
        assert.equal(registryAddress, "100 Market St, Pottsville, PA, 17901");
        return {
          available: true,
          suppliedMatched: true,
          registryMatched: true,
          distanceMiles: 0.01,
          provenance: { source: "Census Geocoder" },
        };
      },
    },
    rdap: overrides.rdap || {
      async lookup({ domain }) {
        assert.equal(domain, "example.com");
        return {
          available: true,
          registered: true,
          provenance: { source: "RDAP" },
        };
      },
    },
  };
}

test("entityAddress builds a normalized comparison string", () => {
  assert.equal(
    entityAddress({
      address1: "100 Market St",
      address2: "Suite 2",
      city: "Pottsville",
      state: "PA",
      zip: "17901",
    }),
    "100 Market St, Suite 2, Pottsville, PA, 17901"
  );
});

test("service composes three passing adapters into consistent", async () => {
  const service = createVendorIdentityService({
    ...adapters(),
    now: () => "2026-10-02T09:00:00.000Z",
  });
  const result = await service.check({
    company: "Example LLC",
    address: "100 Market St, Pottsville, PA 17901",
    domain: "EXAMPLE.COM",
  });
  assert.equal(result.decision, "consistent");
  assert.equal(result.input.domain, "example.com");
  assert.equal(result.evidence.registry.available, true);
  assert.equal(result.evidence.address.available, true);
  assert.equal(result.evidence.rdap.available, true);
});

test("registry adapter failure becomes human review without throwing", async () => {
  const service = createVendorIdentityService({
    ...adapters({
      registry: {
        async lookup() {
          const error = new Error("upstream timeout");
          error.code = "UPSTREAM_TIMEOUT";
          throw error;
        },
      },
    }),
    now: () => "2026-10-02T09:00:00.000Z",
  });
  const result = await service.check({
    company: "Example LLC",
    address: "100 Market St, Pottsville, PA 17901",
    domain: "example.com",
  });
  assert.equal(result.decision, "human_review");
  assert.ok(result.reasonCodes.includes("PA_REGISTRY_UNAVAILABLE"));
  assert.ok(result.reasonCodes.includes("ADDRESS_EVIDENCE_UNAVAILABLE"));
  assert.equal(result.evidence.registry.detail, "UPSTREAM_TIMEOUT");
});

test("RDAP adapter failure becomes human review without throwing", async () => {
  const service = createVendorIdentityService({
    ...adapters({
      rdap: {
        async lookup() {
          throw new Error("rdap unavailable");
        },
      },
    }),
  });
  const result = await service.check({
    company: "Example LLC",
    address: "100 Market St, Pottsville, PA 17901",
    domain: "example.com",
  });
  assert.equal(result.decision, "human_review");
  assert.ok(result.reasonCodes.includes("RDAP_EVIDENCE_UNAVAILABLE"));
});

test("address adapter failure becomes human review without throwing", async () => {
  const service = createVendorIdentityService({
    ...adapters({
      address: {
        async compare() {
          throw new Error("geocoder unavailable");
        },
      },
    }),
  });
  const result = await service.check({
    company: "Example LLC",
    address: "100 Market St, Pottsville, PA 17901",
    domain: "example.com",
  });
  assert.equal(result.decision, "human_review");
  assert.ok(result.reasonCodes.includes("ADDRESS_EVIDENCE_UNAVAILABLE"));
});

test("invalid user input is rejected before any adapter work", async () => {
  let called = 0;
  const base = adapters();
  const service = createVendorIdentityService({
    registry: { async lookup() { called++; return base.registry.lookup({ company: "x" }); } },
    address: base.address,
    rdap: base.rdap,
  });
  await assert.rejects(
    () => service.check({ company: " ", address: "x", domain: "x" }),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.equal(called, 0);
});
