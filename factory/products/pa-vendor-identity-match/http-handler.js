"use strict";

function createVendorIdentityHttpHandler({ service }) {
  if (!service || typeof service.check !== "function") throw new TypeError("service.check required");

  return async function handle(query) {
    try {
      const result = await service.check({
        company: query?.company,
        address: query?.address,
        domain: query?.domain
      });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(result)
      };
    } catch (error) {
      if (error?.code === "INVALID_INPUT") {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
          body: JSON.stringify({ error: "invalid_input", detail: error.message })
        };
      }
      return {
        statusCode: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ error: "internal_error" })
      };
    }
  };
}

module.exports = { createVendorIdentityHttpHandler };
