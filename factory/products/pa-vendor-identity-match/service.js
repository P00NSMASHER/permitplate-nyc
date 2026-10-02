"use strict";

const { assessVendorIdentity } = require("./decision");
const {
  sourceUnavailable,
  requireAdapter,
  normalizedEvidence,
} = require("../../packages/sources/contracts");

function cleanRequired(value, field, minLength, maxLength) {
  if (typeof value !== "string") {
    const error = new TypeError(`${field} must be a string`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  const cleaned = value.trim();
  if (cleaned.length < minLength || cleaned.length > maxLength) {
    const error = new RangeError(`${field} length must be ${minLength}-${maxLength}`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  return cleaned;
}

function entityAddress(entity) {
  if (!entity || typeof entity !== "object") return null;
  const parts = [
    entity.address1,
    entity.address2,
    entity.city,
    entity.state,
    entity.zip,
  ].filter((value) => typeof value === "string" && value.trim());
  return parts.length ? parts.join(", ") : null;
}

function createVendorIdentityService({ registry, address, rdap, now = () => new Date().toISOString() }) {
  requireAdapter("registry", registry, "lookup");
  requireAdapter("address", address, "compare");
  requireAdapter("rdap", rdap, "lookup");

  async function check(input) {
    const company = cleanRequired(input?.company, "company", 2, 120);
    const suppliedAddress = cleanRequired(input?.address, "address", 5, 240);
    const domain = cleanRequired(input?.domain, "domain", 3, 253).toLowerCase();

    let registryEvidence;
    try {
      registryEvidence = normalizedEvidence(
        "pa_registry",
        await registry.lookup({ company })
      );
    } catch (error) {
      registryEvidence = sourceUnavailable("pa_registry", error?.code || error?.message || "lookup failed");
    }

    let addressEvidence;
    const matchedEntity = registryEvidence?.entity ?? null;
    const registeredAddress = entityAddress(matchedEntity);
    if (registryEvidence.available !== true || registryEvidence.strongMatch !== true || !registeredAddress) {
      addressEvidence = sourceUnavailable(
        "census_address",
        "registry identity/address unavailable for comparison"
      );
    } else {
      try {
        addressEvidence = normalizedEvidence(
          "census_address",
          await address.compare({
            suppliedAddress,
            registryAddress: registeredAddress,
          })
        );
      } catch (error) {
        addressEvidence = sourceUnavailable("census_address", error?.code || error?.message || "comparison failed");
      }
    }

    let rdapEvidence;
    try {
      rdapEvidence = normalizedEvidence(
        "rdap",
        await rdap.lookup({ domain })
      );
    } catch (error) {
      rdapEvidence = sourceUnavailable("rdap", error?.code || error?.message || "lookup failed");
    }

    const checkedAt = now();
    const decision = assessVendorIdentity(
      {
        registry: registryEvidence,
        address: addressEvidence,
        rdap: rdapEvidence,
      },
      checkedAt
    );

    return {
      ...decision,
      input: { company, address: suppliedAddress, domain },
      evidence: {
        registry: registryEvidence,
        address: addressEvidence,
        rdap: rdapEvidence,
      },
    };
  }

  return { check };
}

module.exports = {
  createVendorIdentityService,
  entityAddress,
};
