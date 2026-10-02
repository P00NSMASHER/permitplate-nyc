"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessVendorIdentity } = require("./decision");

const PASSING = Object.freeze({
  registry: {
    available: true,
    strongMatch: true,
    entity: { businessName: "Example LLC", filingNumber: "123" },
  },
  address: {
    available: true,
    suppliedMatched: true,
    registryMatched: true,
    distanceMiles: 0.10,
  },
  rdap: {
    available: true,
    registered: true,
  },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

test("all three identity checks passing returns consistent", () => {
  const result = assessVendorIdentity(clone(PASSING), "2026-10-02T09:00:00.000Z");
  assert.equal(result.decision, "consistent");
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.matchedEntity.businessName, "Example LLC");
});

test("uncertain registry match requires human review", () => {
  const evidence = clone(PASSING);
  evidence.registry.strongMatch = false;
  const result = assessVendorIdentity(evidence);
  assert.equal(result.decision, "human_review");
  assert.ok(result.reasonCodes.includes("PA_REGISTRY_MATCH_UNCERTAIN"));
});

test("address exactly at threshold is consistent", () => {
  const evidence = clone(PASSING);
  evidence.address.distanceMiles = 0.25;
  assert.equal(assessVendorIdentity(evidence).decision, "consistent");
});

test("address above threshold requires human review", () => {
  const evidence = clone(PASSING);
  evidence.address.distanceMiles = 0.250001;
  const result = assessVendorIdentity(evidence);
  assert.equal(result.decision, "human_review");
  assert.ok(result.reasonCodes.includes("ADDRESS_DISTANCE_EXCEEDS_THRESHOLD"));
});

test("unregistered domain requires human review", () => {
  const evidence = clone(PASSING);
  evidence.rdap.registered = false;
  const result = assessVendorIdentity(evidence);
  assert.equal(result.decision, "human_review");
  assert.ok(result.reasonCodes.includes("DOMAIN_NOT_CONFIRMED_REGISTERED"));
});

test("unavailable evidence fails closed to human review, never rejection", () => {
  const evidence = clone(PASSING);
  evidence.registry.available = false;
  evidence.address.available = false;
  evidence.rdap.available = false;
  const result = assessVendorIdentity(evidence);
  assert.equal(result.decision, "human_review");
  assert.equal(result.policy.automaticReject, false);
  assert.deepEqual(result.reasonCodes, [
    "PA_REGISTRY_UNAVAILABLE",
    "ADDRESS_EVIDENCE_UNAVAILABLE",
    "RDAP_EVIDENCE_UNAVAILABLE",
  ]);
});
