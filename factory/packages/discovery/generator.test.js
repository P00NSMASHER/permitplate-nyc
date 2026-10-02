"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const registry=require("../../product-registry.json");
const {
  MODULES,
  managedProducts,
  buildCatalog,
  buildOpenApi,
  buildLlmsText,
  validateCompiled,
}=require("./generator");

const BASE="https://candidate.example";

function expectedManaged(){
  return registry.products.filter(
    product=>MODULES[product.id]&&/staging$/.test(product.status)
  );
}

test("compiler includes every modular staging product exactly once",()=>{
  const products=managedProducts();
  const expected=expectedManaged();
  assert.deepEqual(products.map(p=>p.id),expected.map(p=>p.id));
  assert.deepEqual(products.map(p=>p.number),expected.map(p=>p.number));
  assert.equal(new Set(products.map(p=>p.path)).size,products.length);
});

test("compiled x402 catalog uses resource-level accepts for every product",()=>{
  const products=managedProducts();
  const catalog=buildCatalog(BASE);
  assert.equal(catalog.x402Version,2);
  assert.equal(catalog.resources.length,products.length);
  for(const resource of catalog.resources){
    assert.ok(resource.resource.startsWith("https://candidate.example/api/"));
    assert.ok(Array.isArray(resource.accepts));
    assert.equal(resource.accepts.length,1);
    assert.equal(resource.accepts[0].scheme,"exact");
    assert.equal(resource.accepts[0].network,"eip155:8453");
    assert.match(resource.accepts[0].payTo,/^0x[0-9a-f]{40}$/);
  }
});

test("compiled OpenAPI has one path for every managed product",()=>{
  const api=buildOpenApi(BASE);
  const products=managedProducts();
  assert.equal(api.openapi,"3.1.0");
  assert.deepEqual(Object.keys(api.paths),products.map(p=>p.path));
  for(const product of products){
    assert.equal(
      api.paths[product.path].get["x-payment-info"].price.amount,
      Number(product.price_usdc).toFixed(6)
    );
  }
});

test("compiled agent text contains every managed route and price",()=>{
  const output=buildLlmsText(BASE);
  for(const product of managedProducts()){
    assert.ok(output.includes(product.path));
    assert.ok(output.includes("$"+product.price_usdc+" USDC"));
  }
  assert.match(output,/retry the same payment authorization/i);
});

test("compiled package passes cross-surface validation",()=>{
  const built=validateCompiled(BASE);
  const expected=managedProducts().length;
  assert.equal(built.productCount,expected);
  assert.equal(built.catalog.resources.length,expected);
  assert.equal(Object.keys(built.openapi.paths).length,expected);
});

test("design products are never published solely because metadata exists",()=>{
  const published=new Set(managedProducts().map(p=>p.id));
  for(const product of registry.products.filter(p=>p.status==="design"&&MODULES[p.id])){
    assert.ok(!published.has(product.id),product.id+" must remain unpublished while design");
  }
});
