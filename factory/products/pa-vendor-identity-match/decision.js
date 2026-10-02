"use strict";

const POLICY = Object.freeze({
  censusMaxDistanceMiles: 0.25,
});

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assessVendorIdentity(evidence, checkedAt = new Date().toISOString()) {
  const registry = evidence?.registry || {};
  const address = evidence?.address || {};
  const rdap = evidence?.rdap || {};

  const checks = {};
  const reasonCodes = [];

  if (registry.available !== true) {
    checks.registry = { status: "review", reason: "PA_REGISTRY_UNAVAILABLE" };
    reasonCodes.push("PA_REGISTRY_UNAVAILABLE");
  } else if (registry.strongMatch !== true) {
    checks.registry = { status: "review", reason: "PA_REGISTRY_MATCH_UNCERTAIN" };
    reasonCodes.push("PA_REGISTRY_MATCH_UNCERTAIN");
  } else {
    checks.registry = { status: "pass", reason: "PA_REGISTRY_STRONG_MATCH" };
  }

  if (address.available !== true) {
    checks.address = { status: "review", reason: "ADDRESS_EVIDENCE_UNAVAILABLE" };
    reasonCodes.push("ADDRESS_EVIDENCE_UNAVAILABLE");
  } else if (address.suppliedMatched !== true || address.registryMatched !== true) {
    checks.address = { status: "review", reason: "ADDRESS_NOT_BOTH_GEOCODED" };
    reasonCodes.push("ADDRESS_NOT_BOTH_GEOCODED");
  } else if (!finiteNumber(address.distanceMiles)) {
    checks.address = { status: "review", reason: "ADDRESS_DISTANCE_UNAVAILABLE" };
    reasonCodes.push("ADDRESS_DISTANCE_UNAVAILABLE");
  } else if (address.distanceMiles > POLICY.censusMaxDistanceMiles) {
    checks.address = {
      status: "review",
      reason: "ADDRESS_DISTANCE_EXCEEDS_THRESHOLD",
      distanceMiles: address.distanceMiles,
    };
    reasonCodes.push("ADDRESS_DISTANCE_EXCEEDS_THRESHOLD");
  } else {
    checks.address = {
      status: "pass",
      reason: "ADDRESS_WITHIN_THRESHOLD",
      distanceMiles: address.distanceMiles,
    };
  }

  if (rdap.available !== true) {
    checks.rdap = { status: "review", reason: "RDAP_EVIDENCE_UNAVAILABLE" };
    reasonCodes.push("RDAP_EVIDENCE_UNAVAILABLE");
  } else if (rdap.registered !== true) {
    checks.rdap = { status: "review", reason: "DOMAIN_NOT_CONFIRMED_REGISTERED" };
    reasonCodes.push("DOMAIN_NOT_CONFIRMED_REGISTERED");
  } else {
    checks.rdap = { status: "pass", reason: "DOMAIN_REGISTERED" };
  }

  const decision = reasonCodes.length === 0 ? "consistent" : "human_review";

  return {
    decision,
    reasonCodes,
    checks,
    matchedEntity: registry.entity ?? null,
    policy: {
      registryStrongMatchRequired: true,
      censusMaxDistanceMiles: POLICY.censusMaxDistanceMiles,
      rdapRegisteredRequired: true,
      automaticReject: false,
    },
    checkedAt,
  };
}

module.exports = { POLICY, assessVendorIdentity };
