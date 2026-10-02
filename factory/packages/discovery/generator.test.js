"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  managedProducts,
  buildCatalog,
  buildOpenApi,
  buildLlmsText,
  validateCompiled,
} = require("./generator");

const BASE = "https://candidate.example";

test("compiler includes every modular staging product exactly once", () => {
  const products = managedProducts();
  assert.deepEqual(
    products.map((product) => product.number),
    ["003", "004", "005", "006", "007", "008", "009"]
  );
  assert.equal(new Set(products.map((product) => product.path)).size, products.length);
});

test("compiled x402 catalog uses resource-level accepts for every product", () => {
  const catalog = buildCatalog(BASE);
  assert.equal(catalog.x402Version, 2);
  assert.equal(catalog.resources.length, 7);
  for (const resource of catalog.resources) {
    assert.ok(resource.resource.startsWith("https://candidate.example/api/"));
    assert.ok(Array.isArray(resource.accepts));
    assert.equal(resource.accepts.length, 1);
    assert.equal(resource.accepts[0].scheme, "exact");
    assert.equal(resource.accepts[0].network, "eip155:8453");
    assert.match(resource.accepts[0].payTo, /^0x[0-9a-f]{40}$/);
  }
});

test("compiled OpenAPI has one path for every managed product", () => {
  const api = buildOpenApi(BASE);
  const products = managedProducts();
  assert.equal(api.openapi, "3.1.0");
  assert.deepEqual(Object.keys(api.paths), products.map((product) => product.path));
  for (const product of products) {
    assert.equal(
      api.paths[product.path].get["x-payment-info"].price.amount,
      Number(product.price_usdc).toFixed(6)
    );
  }
});

test("compiled agent text contains every product route and price", () => {
  const text = buildLlmsText(BASE);
  for (const product of managedProducts()) {
    assert.ok(text.includes(product.path));
    assert.ok(text.includes("$" + product.price_usdc + " USDC"));
  }
  assert.match(text, /retry the same payment authorization/i);
});

test("compiled package passes cross-surface validation", () => {
  const built = validateCompiled(BASE);
  assert.equal(built.productCount, 7);
  assert.equal(built.catalog.resources.length, 7);
  assert.equal(Object.keys(built.openapi.paths).length, 7);
});


test("design products are not published even if metadata exists", () => {
  const ids = managedProducts().map((product) => product.id);
  assert.ok(!ids.includes("ofac-name-review-gate"));
  assert.ok(!ids.includes("pa-business-formation-age"));
});
