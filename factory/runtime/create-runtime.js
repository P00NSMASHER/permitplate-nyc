"use strict";

const {managedProducts,buildCatalog,buildOpenApi,buildProductIndex,buildLlmsText}=require("../packages/discovery/generator");
const {createPaRegistryAdapter,createCensusAddressAdapter,createRdapAdapter}=require("../packages/sources/live-pa-identity");
const {createSecFilingsAdapter}=require("../packages/sources/sec-filings");
const {createTreasuryAverageRatesAdapter}=require("../packages/sources/treasury-average-rates");
const {createOfacNameAdapter}=require("../packages/sources/ofac-name-screen");

const {createVendorIdentityService}=require("../products/pa-vendor-identity-match/service");
const {createPaidVendorIdentityHandler}=require("../products/pa-vendor-identity-match/paid-handler");
const {createBusinessAddressService}=require("../products/pa-business-address-match/service");
const {createPaidBusinessAddressHandler}=require("../products/pa-business-address-match/paid-handler");
const {createBusinessDomainService}=require("../products/pa-business-domain-match/service");
const {createPaidBusinessDomainHandler}=require("../products/pa-business-domain-match/paid-handler");
const {createSecFilingFreshnessService}=require("../products/sec-filing-freshness/service");
const {createPaidSecFilingFreshnessHandler}=require("../products/sec-filing-freshness/paid-handler");
const {createSecCompanyIdentityService}=require("../products/sec-company-identity-match/service");
const {createPaidSecCompanyIdentityHandler}=require("../products/sec-company-identity-match/paid-handler");
const {createDomainAgeService}=require("../products/domain-registration-age/service");
const {createPaidDomainAgeHandler}=require("../products/domain-registration-age/paid-handler");
const {createTreasuryRateThresholdService}=require("../products/treasury-average-rate-threshold/service");
const {createPaidTreasuryThresholdHandler}=require("../products/treasury-average-rate-threshold/paid-handler");
const {createOfacReviewService}=require("../products/ofac-name-review-gate/service");
const {createPaidOfacReviewHandler}=require("../products/ofac-name-review-gate/paid-handler");
const {createFormationAgeService}=require("../products/pa-business-formation-age/service");
const {createPaidFormationAgeHandler}=require("../products/pa-business-formation-age/paid-handler");
const {createDomainExpirationService}=require("../products/domain-expiration-horizon/service");
const {createPaidDomainExpirationHandler}=require("../products/domain-expiration-horizon/paid-handler");
const {createDomainLastChangedService}=require("../products/domain-last-changed-recency/service");
const {createPaidDomainLastChangedHandler}=require("../products/domain-last-changed-recency/paid-handler");

const PREFLIGHT_HEADERS=Object.freeze({
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET, OPTIONS",
  "access-control-allow-headers":"PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept",
  "access-control-expose-headers":"PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, x402-price, x402-network, x402-asset, x402-pay-to, Retry-After",
  "cache-control":"no-store"
});

function json(statusCode,body,headers={}){
  return {
    statusCode,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*",
      ...headers
    },
    body:JSON.stringify(body)
  };
}

function plain(statusCode,body,headers={}){
  return {
    statusCode,
    headers:{
      "content-type":"text/plain; charset=utf-8",
      "cache-control":"public, max-age=300",
      "access-control-allow-origin":"*",
      ...headers
    },
    body:String(body)
  };
}

function defaultAdapters({fetchImpl=fetch,secUserAgent}={}){
  return {
    registry:createPaRegistryAdapter({fetchImpl}),
    address:createCensusAddressAdapter({fetchImpl}),
    rdap:createRdapAdapter({fetchImpl}),
    sec:createSecFilingsAdapter({fetchImpl,userAgent:secUserAgent}),
    treasury:createTreasuryAverageRatesAdapter({fetchImpl}),
    ofac:createOfacNameAdapter({fetchImpl})
  };
}

function createFactoryRuntime({
  publicApiBase,
  fetchImpl=fetch,
  secUserAgent,
  adapters,
  now=()=>new Date().toISOString()
}={}){
  if(typeof publicApiBase!=="string"||!/^https:\/\//.test(publicApiBase)){
    throw new TypeError("https publicApiBase is required");
  }
  const base=publicApiBase.replace(/\/$/,"");
  const a=adapters||defaultAdapters({fetchImpl,secUserAgent});

  const services={
    "pa-vendor-identity-match":createVendorIdentityService({registry:a.registry,address:a.address,rdap:a.rdap,now}),
    "pa-business-address-match":createBusinessAddressService({registry:a.registry,address:a.address,now}),
    "pa-business-domain-match":createBusinessDomainService({registry:a.registry,rdap:a.rdap,now}),
    "sec-filing-freshness":createSecFilingFreshnessService({sec:a.sec,now}),
    "sec-company-identity-match":createSecCompanyIdentityService({sec:a.sec,now}),
    "domain-registration-age":createDomainAgeService({rdap:a.rdap,now}),
    "treasury-average-rate-threshold":createTreasuryRateThresholdService({treasury:a.treasury,now}),
    "ofac-name-review-gate":createOfacReviewService({ofac:a.ofac,now}),
    "pa-business-formation-age":createFormationAgeService({registry:a.registry,now}),
    "domain-expiration-horizon":createDomainExpirationService({rdap:a.rdap,now}),
    "domain-last-changed-recency":createDomainLastChangedService({rdap:a.rdap,now}),
    "sec-company-identity-match":createSecCompanyIdentityService({sec:a.sec,now})
  };

  const handlerFactories={
    "pa-vendor-identity-match":createPaidVendorIdentityHandler,
    "pa-business-address-match":createPaidBusinessAddressHandler,
    "pa-business-domain-match":createPaidBusinessDomainHandler,
    "sec-filing-freshness":createPaidSecFilingFreshnessHandler,
    "sec-company-identity-match":createPaidSecCompanyIdentityHandler,
    "domain-registration-age":createPaidDomainAgeHandler,
    "treasury-average-rate-threshold":createPaidTreasuryThresholdHandler,
    "ofac-name-review-gate":createPaidOfacReviewHandler,
    "pa-business-formation-age":createPaidFormationAgeHandler,
    "domain-expiration-horizon":createPaidDomainExpirationHandler,
    "domain-last-changed-recency":createPaidDomainLastChangedHandler,
    "sec-company-identity-match":createPaidSecCompanyIdentityHandler
  };

  const routes=new Map();
  for(const product of managedProducts()){
    const service=services[product.id];
    const factory=handlerFactories[product.id];
    if(!service||!factory)throw new Error("runtime wiring missing for "+product.id);
    routes.set(product.method+" "+product.path,factory({
      service,
      publicApiBase:base,
      fetchImpl
    }));
  }

  async function handle({method="GET",path="/",query={},event={}}={}){
    const verb=String(method).toUpperCase();
    if(verb==="OPTIONS"&&managedProducts().some(product=>product.path===path)){
      return {
        statusCode:204,
        headers:{...PREFLIGHT_HEADERS},
        body:""
      };
    }
    if(verb==="GET"&&path==="/api/_healthcheck"){
      return json(200,{
        ok:true,
        service:"x402-product-factory",
        stagingProductCount:managedProducts().length,
        stagingProducts:managedProducts().map(p=>p.id)
      });
    }
    if(verb==="GET"&&(path==="/.well-known/x402"||path==="/.well-known/x402.json"||path==="/.well-known/x402-catalog.json")){
      return json(200,buildCatalog(base),{"cache-control":"public, max-age=300"});
    }
    if(verb==="GET"&&path==="/openapi.json"){
      return json(200,buildOpenApi(base),{"cache-control":"public, max-age=300"});
    }
    if(verb==="GET"&&path==="/product-index.json"){
      return json(200,buildProductIndex(base),{"cache-control":"public, max-age=300"});
    }
    if(verb==="GET"&&path==="/llms.txt"){
      return plain(200,buildLlmsText(base));
    }
    const handler=routes.get(verb+" "+path);
    if(!handler)return json(404,{error:"not_found"});
    return await handler({query,event});
  }

  return {
    base,
    adapters:a,
    services,
    routes,
    handle,
    stagingProducts:managedProducts()
  };
}

module.exports={PREFLIGHT_HEADERS,defaultAdapters,createFactoryRuntime};
