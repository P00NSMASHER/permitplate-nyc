"use strict";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
});

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

function createVendorIdentityHttpHandler({ service }) {
  if (!service || typeof service.check !== "function") {
    throw new TypeError("service.check() is required");
  }

  return async function handle(query = {}) {
    let result;
    try {
      result = await service.check({
        company: query.company ?? "",
        address: query.address ?? "",
        domain: query.domain ?? "",
      });
    } catch (error) {
      if (error?.code === "INVALID_INPUT") {
        return json(400, {
          error: "invalid_request",
          detail: error.message,
        });
      }
      return json(500, {
        error: "internal_error",
      });
    }

    if (Array.isArray(result.sourceFailures) && result.sourceFailures.length > 0) {
      return json(502, {
        error: "required_source_unavailable",
        sourceFailures: result.sourceFailures,
        checkedAt: result.checkedAt,
        chargeable: false,
      });
    }

    return json(200, result);
  };
}

module.exports = { createVendorIdentityHttpHandler, json };
