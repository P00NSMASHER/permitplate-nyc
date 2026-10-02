"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {buildDeploymentBundle,sha256}=require("./bundle");

const BASE="https://candidate.example";

test("deployment bundle emits all discovery surfaces deterministically",()=>{
  const a=buildDeploymentBundle(BASE);
  const b=buildDeploymentBundle(BASE);
  assert.deepEqual(a,b);
  assert.deepEqual(Object.keys(a.files).sort(),[
    "bundle-manifest.json",
    "llms.txt",
    "openapi.json",
    "product-index.json",
    "x402-catalog.json"
  ]);
  assert.equal(a.products.length,6);
  assert.deepEqual(a.products.map(p=>p.number),["003","004","005","006","007","008"]);
});

test("bundle catalog and OpenAPI contain every managed route",()=>{
  const bundle=buildDeploymentBundle(BASE);
  const catalog=JSON.parse(bundle.files["x402-catalog.json"]);
  const openapi=JSON.parse(bundle.files["openapi.json"]);
  assert.equal(catalog.resources.length,bundle.products.length);
  for(const p of bundle.products){
    assert.ok(catalog.resources.some(r=>r.resource===BASE+p.path));
    assert.ok(openapi.paths[p.path]);
  }
});

test("manifest fingerprints every non-manifest artifact",()=>{
  const bundle=buildDeploymentBundle(BASE);
  const manifest=JSON.parse(bundle.files["bundle-manifest.json"]);
  assert.equal(manifest.product_count,bundle.products.length);
  for(const entry of manifest.files){
    assert.equal(entry.sha256,sha256(bundle.files[entry.name]));
    assert.match(entry.sha256,/^[0-9a-f]{64}$/);
  }
});

test("bundle preserves resource-level x402 accepts",()=>{
  const bundle=buildDeploymentBundle(BASE);
  const catalog=JSON.parse(bundle.files["x402-catalog.json"]);
  for(const resource of catalog.resources){
    assert.ok(Array.isArray(resource.accepts));
    assert.equal(resource.accepts.length,1);
    assert.equal(resource.accepts[0].scheme,"exact");
    assert.equal(resource.accepts[0].network,"eip155:8453");
    assert.match(resource.accepts[0].payTo,/^0x[0-9a-f]{40}$/);
  }
});
