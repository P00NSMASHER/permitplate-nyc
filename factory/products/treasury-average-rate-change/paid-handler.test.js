"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {encodeHeader}=require("../../packages/x402/payment");
const {
  AMOUNT_ATOMIC,
  PRICE,
  RESOURCE_PATH,
  productPaymentDocument,
  createPaidTreasuryRateChangeHandler
}=require("./paid-handler");

function response(body,status=200){
  return {status,ok:status>=200&&status<300,async json(){return body;}};
}
const signature=()=>encodeHeader({x402Version:2,payload:{signed:true}});

test("Product 014 terms are $0.003 / 3000 atomic",()=>{
  const d=productPaymentDocument("https://example.test");
  assert.equal(PRICE,"$0.003");
  assert.equal(AMOUNT_ATOMIC,"3000");
  assert.equal(d.resource.url,"https://example.test"+RESOURCE_PATH);
  assert.equal(d.accepts[0].amount,"3000");
});

test("unpaid request returns 402 before service work",async()=>{
  let calls=0;
  const handler=createPaidTreasuryRateChangeHandler({
    publicApiBase:"https://example.test",
    service:{async check(){calls++;}},
    fetchImpl:async()=>response({})
  });
  const r=await handler({query:{security:"Total Marketable"},event:{headers:{}}});
  assert.equal(r.statusCode,402);
  assert.equal(calls,0);
});

test("invalid input is rejected before facilitator work",async()=>{
  let network=0;
  const handler=createPaidTreasuryRateChangeHandler({
    publicApiBase:"https://example.test",
    service:{async check(){throw new Error("should not run");}},
    fetchImpl:async()=>{network++;return response({});}
  });
  const r=await handler({
    query:{security:"",toleranceBps:"-1"},
    event:{headers:{"payment-signature":signature()}}
  });
  assert.equal(r.statusCode,400);
  assert.equal(network,0);
});

test("valid payment verifies then settles after chargeable result",async()=>{
  const urls=[];
  const handler=createPaidTreasuryRateChangeHandler({
    publicApiBase:"https://example.test",
    service:{async check(){return{
      decision:"decreased",
      deltaBps:-5,
      toleranceBps:2,
      sourceFailures:[],
      chargeable:true
    };}},
    fetchImpl:async url=>{
      urls.push(url);
      return url.endsWith("/verify")
        ?response({isValid:true})
        :response({success:true,transaction:"0x014"});
    }
  });
  const r=await handler({
    query:{security:"Total Marketable",toleranceBps:"2"},
    event:{headers:{"payment-signature":signature()}}
  });
  assert.equal(r.statusCode,200);
  assert.deepEqual(urls.map(u=>u.split("/").pop()),["verify","settle"]);
  assert.equal(JSON.parse(r.body).paid,true);
  assert.equal(r.headers["x402-settled"],"true");
});

test("Treasury transport failure never settles",async()=>{
  const urls=[];
  const handler=createPaidTreasuryRateChangeHandler({
    publicApiBase:"https://example.test",
    service:{async check(){return{
      decision:"human_review",
      sourceFailures:[{source:"treasury_fiscal_data",detail:"SOURCE_HTTP_ERROR"}],
      chargeable:false
    };}},
    fetchImpl:async url=>{urls.push(url);return response({isValid:true});}
  });
  const r=await handler({
    query:{security:"Total Marketable"},
    event:{headers:{"payment-signature":signature()}}
  });
  assert.equal(r.statusCode,502);
  assert.equal(urls.length,1);
  assert.ok(urls[0].endsWith("/verify"));
});
