"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {encodeHeader}=require("../../packages/x402/payment");
const {AMOUNT_ATOMIC,PRICE,RESOURCE_PATH,productPaymentDocument,createPaidLocalVendorPolicyHandler}=require("./paid-handler");
function response(body,status=200){return{status,ok:status>=200&&status<300,async json(){return body;}};}
const sig=()=>encodeHeader({x402Version:2,payload:{signed:true}});
const q=()=>({company:"OpenAI OpCo",allowedKinds:"llc,corporation",allowedCounties:"Dauphin,Schuylkill",minAgeDays:"30"});

test("Product 023 advertises 4000 atomic / $0.004",()=>{
  const d=productPaymentDocument("https://example.test");
  assert.equal(AMOUNT_ATOMIC,"4000");assert.equal(PRICE,"$0.004");assert.equal(d.resource.url,"https://example.test"+RESOURCE_PATH);
});
test("unpaid request returns 402 before work",async()=>{
  let c=0;const h=createPaidLocalVendorPolicyHandler({publicApiBase:"https://example.test",service:{async check(){c++;}},fetchImpl:async()=>response({})});
  const r=await h({query:q(),event:{headers:{}}});assert.equal(r.statusCode,402);assert.equal(c,0);
});
test("invalid caller policy stops before verify",async()=>{
  let n=0;const h=createPaidLocalVendorPolicyHandler({publicApiBase:"https://example.test",service:{async check(){throw new Error("should not run");}},fetchImpl:async()=>{n++;return response({});}});
  const r=await h({query:{company:"OpenAI",allowedKinds:"bank",allowedCounties:"Dauphin",minAgeDays:"30"},event:{headers:{"payment-signature":sig()}}});
  assert.equal(r.statusCode,400);assert.equal(n,0);
});
test("valid policy result verifies then settles",async()=>{
  const urls=[];const h=createPaidLocalVendorPolicyHandler({
    publicApiBase:"https://example.test",
    service:{async check(){return{decision:"proceed",reasonCodes:[],sourceFailures:[],chargeable:true};}},
    fetchImpl:async url=>{urls.push(url);return url.endsWith("/verify")?response({isValid:true}):response({success:true,transaction:"0x23"});}
  });
  const r=await h({query:q(),event:{headers:{"payment-signature":sig()}}});
  assert.equal(r.statusCode,200);assert.deepEqual(urls.map(x=>x.split("/").pop()),["verify","settle"]);
});
test("registry outage never settles",async()=>{
  const urls=[];const h=createPaidLocalVendorPolicyHandler({
    publicApiBase:"https://example.test",
    service:{async check(){return{decision:"human_review",sourceFailures:[{source:"pa_registry",detail:"timeout"}],chargeable:false};}},
    fetchImpl:async url=>{urls.push(url);return response({isValid:true});}
  });
  const r=await h({query:q(),event:{headers:{"payment-signature":sig()}}});
  assert.equal(r.statusCode,502);assert.equal(urls.length,1);
});
