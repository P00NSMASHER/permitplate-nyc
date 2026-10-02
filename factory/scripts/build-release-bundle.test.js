"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const os=require("node:os");
const fs=require("node:fs");
const path=require("node:path");
const {managedProducts}=require("../packages/discovery/generator");
const {expectedAtomic,buildReleaseBundle,writeReleaseBundle}=require("./build-release-bundle");

test("USDC prices convert deterministically to six-decimal atomic amounts",()=>{
  assert.equal(expectedAtomic("0.002"),"2000");
  assert.equal(expectedAtomic("0.003"),"3000");
  assert.equal(expectedAtomic("0.005"),"5000");
});

test("bundle contains every modular staging product exactly once",()=>{
  const expected=managedProducts();
  const b=buildReleaseBundle("https://candidate.example");
  assert.equal(b.manifest.product_count,expected.length);
  assert.deepEqual(b.manifest.products.map(p=>p.id),expected.map(p=>p.id));
  assert.deepEqual(b.manifest.products.map(p=>p.number),expected.map(p=>p.number));
  assert.equal(new Set(b.catalog.resources.map(r=>r.resource)).size,expected.length);
  assert.equal(Object.keys(b.openapi.paths).length,expected.length);
});

test("design products are not emitted into release bundle",()=>{
  const ids=new Set(buildReleaseBundle("https://candidate.example").manifest.products.map(p=>p.id));
  assert.ok(!ids.has("ofac-name-review-gate")||managedProducts().some(p=>p.id==="ofac-name-review-gate"));
  assert.ok(!ids.has("pa-business-formation-age")||managedProducts().some(p=>p.id==="pa-business-formation-age"));
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
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,"release-manifest.json"),"utf8"));
  assert.equal(catalog.resources.length,b.catalog.resources.length);
  assert.equal(manifest.product_count,managedProducts().length);
});

test("release manifest preserves per-product deployment prerequisites",()=>{
  const b=buildReleaseBundle("https://candidate.example");
  const sec=b.manifest.products.find(p=>p.id==="sec-filing-freshness");
  assert.ok(sec);
  assert.deepEqual(sec.required_env,["SEC_USER_AGENT"]);
  assert.ok(sec.deployment_requirements.some(text=>/contact email/i.test(text)));
  for(const p of b.manifest.products.filter(p=>p.id!=="sec-filing-freshness")){
    assert.ok(Array.isArray(p.required_env));
  }
});
