"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const os=require("node:os");
const fs=require("node:fs");
const path=require("node:path");
const {expectedAtomic,buildReleaseBundle,writeReleaseBundle}=require("./build-release-bundle");

test("USDC prices convert deterministically to six-decimal atomic amounts",()=>{
  assert.equal(expectedAtomic("0.002"),"2000");
  assert.equal(expectedAtomic("0.003"),"3000");
  assert.equal(expectedAtomic("0.005"),"5000");
});

test("bundle contains Products 003 through 008 exactly once",()=>{
  const b=buildReleaseBundle("https://candidate.example");
  assert.equal(b.manifest.product_count,6);
  assert.deepEqual(b.manifest.products.map(p=>p.number),["003","004","005","006","007","008"]);
  assert.equal(new Set(b.catalog.resources.map(r=>r.resource)).size,6);
  assert.equal(Object.keys(b.openapi.paths).length,6);
});

test("every catalog resource has resource-level exact Base USDC accepts",()=>{
  const b=buildReleaseBundle("https://candidate.example");
  for(const r of b.catalog.resources){
    assert.equal(r.accepts.length,1);
    assert.equal(r.accepts[0].scheme,"exact");
    assert.equal(r.accepts[0].network,"eip155:8453");
    assert.equal(r.accepts[0].asset.toLowerCase(),"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    assert.equal(r.accepts[0].payTo.toLowerCase(),"0x708f7b52b56eafd7fc1de65fc7752ed732914021");
  }
});

test("writer produces deterministic catalog, OpenAPI, and manifest files",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"x402-factory-"));
  const b=writeReleaseBundle(dir,"https://candidate.example");
  for(const name of ["x402-catalog.json","openapi.json","release-manifest.json"]){
    assert.ok(fs.existsSync(path.join(dir,name)));
  }
  const catalog=JSON.parse(fs.readFileSync(path.join(dir,"x402-catalog.json"),"utf8"));
  assert.equal(catalog.resources.length,b.catalog.resources.length);
});
