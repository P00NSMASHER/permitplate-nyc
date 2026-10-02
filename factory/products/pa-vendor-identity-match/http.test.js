"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVendorIdentityHttpHandler } = require("./http");

function parsed(response) {
  return JSON.parse(response.body);
}

test("200 returns completed consistent result", async () => {
  const handler=createVendorIdentityHttpHandler({service:{async check(){return {
    decision:"consistent",reasonCodes:[],sourceFailures:[],chargeable:true,checkedAt:"2026-10-02T09:00:00.000Z"
  };}}});
  const response=await handler({company:"Example LLC",address:"100 Market St, Pottsville, PA 17901",domain:"example.com"});
  assert.equal(response.statusCode,200);
  assert.equal(parsed(response).decision,"consistent");
  assert.equal(parsed(response).chargeable,true);
});

test("200 may return human_review for completed contradictory evidence", async () => {
  const handler=createVendorIdentityHttpHandler({service:{async check(){return {
    decision:"human_review",reasonCodes:["DOMAIN_VENDOR_NAME_MISMATCH"],sourceFailures:[],chargeable:true,checkedAt:"2026-10-02T09:00:00.000Z"
  };}}});
  const response=await handler({company:"Example LLC",address:"100 Market St, Pottsville, PA 17901",domain:"unrelated.com"});
  assert.equal(response.statusCode,200);
  assert.equal(parsed(response).decision,"human_review");
  assert.equal(parsed(response).chargeable,true);
});

test("upstream transport failure returns 502 and is explicitly non-chargeable", async () => {
  const handler=createVendorIdentityHttpHandler({service:{async check(){return {
    decision:"human_review",
    reasonCodes:["RDAP_EVIDENCE_UNAVAILABLE"],
    sourceFailures:[{source:"rdap",detail:"SOURCE_HTTP_ERROR"}],
    chargeable:false,
    checkedAt:"2026-10-02T09:00:00.000Z"
  };}}});
  const response=await handler({company:"Example LLC",address:"100 Market St, Pottsville, PA 17901",domain:"example.com"});
  const body=parsed(response);
  assert.equal(response.statusCode,502);
  assert.equal(body.error,"required_source_unavailable");
  assert.equal(body.chargeable,false);
});

test("invalid input returns 400", async () => {
  const handler=createVendorIdentityHttpHandler({service:{async check(){const e=new Error("company length must be 2-120");e.code="INVALID_INPUT";throw e;}}});
  const response=await handler({company:"",address:"x",domain:"x"});
  assert.equal(response.statusCode,400);
  assert.equal(parsed(response).error,"invalid_request");
});
