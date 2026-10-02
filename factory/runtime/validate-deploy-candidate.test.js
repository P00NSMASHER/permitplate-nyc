"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {validateDeployCandidate}=require("./validate-deploy-candidate");

test("candidate is blocked when required SEC identity is absent",()=>{
  const result=validateDeployCandidate({
    publicApiBase:"https://candidate.example",
    env:{}
  });
  assert.equal(result.ready,false);
  assert.ok(result.problems.includes("deployment_prerequisites_missing"));
  assert.ok(result.prerequisites.missing.some(x=>x.productId==="sec-filing-freshness"));
});

test("candidate is structurally ready with a declared SEC contact",()=>{
  const result=validateDeployCandidate({
    publicApiBase:"https://candidate.example",
    env:{SEC_USER_AGENT:"x402-product-factory-ci/1.0 ci@example.com"}
  });
  assert.equal(result.ready,true,JSON.stringify(result.problems));
  assert.equal(result.productCount,10);
  assert.equal(result.paidRouteCount,10);
  assert.equal(result.optionsRouteCount,10);
  assert.equal(result.appDeployRouteCount,result.staticRouteCount+20);
  assert.deepEqual(result.problems,[]);
  assert.ok(result.releaseFiles.includes("x402-catalog.json"));
  assert.ok(result.releaseFiles.includes("openapi.json"));
  assert.ok(result.releaseFiles.includes("llms.txt"));
  assert.ok(result.releaseFiles.includes("product-index.json"));
  assert.ok(result.releaseFiles.includes("bundle-manifest.json"));
  assert.ok(result.releaseFiles.includes("release-manifest.json"));
});
