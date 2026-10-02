"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const { createVendorIdentityHttpHandler }=require("./http-handler");

test("handler returns 200 with service result", async () => {
  const handler=createVendorIdentityHttpHandler({service:{async check(){return {decision:"consistent"};}}});
  const res=await handler({company:"Example",address:"100 Main St",domain:"example.com"});
  assert.equal(res.statusCode,200);
  assert.equal(JSON.parse(res.body).decision,"consistent");
});

test("handler converts invalid input to 400", async () => {
  const error=new Error("company length must be 2-120"); error.code="INVALID_INPUT";
  const handler=createVendorIdentityHttpHandler({service:{async check(){throw error;}}});
  const res=await handler({});
  assert.equal(res.statusCode,400);
  assert.equal(JSON.parse(res.body).error,"invalid_input");
});
