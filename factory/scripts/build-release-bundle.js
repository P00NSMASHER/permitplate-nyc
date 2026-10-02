"use strict";

const fs=require("node:fs");
const path=require("node:path");
const registry=require("../product-registry.json");

const ROOT=path.resolve(__dirname,"..");
const DEFAULT_BASE="https://candidate.example";

const PRODUCT_MODULES=[
  ["pa-vendor-identity-match","products/pa-vendor-identity-match/metadata.js"],
  ["pa-business-address-match","products/pa-business-address-match/metadata.js"],
  ["pa-business-domain-match","products/pa-business-domain-match/metadata.js"],
  ["sec-filing-freshness","products/sec-filing-freshness/metadata.js"],
  ["domain-registration-age","products/domain-registration-age/metadata.js"],
  ["treasury-average-rate-threshold","products/treasury-average-rate-threshold/metadata.js"]
];

function expectedAtomic(priceUsdc){
  const n=Number(priceUsdc);
  if(!Number.isFinite(n)||n<0)throw new Error("invalid registry price "+priceUsdc);
  return String(Math.round(n*1_000_000));
}

function buildReleaseBundle(publicApiBase=DEFAULT_BASE){
  const base=String(publicApiBase).replace(/\/$/,"");
  if(!/^https:\/\//.test(base))throw new Error("publicApiBase must use https");

  const resources=[];
  const paths={};
  const products=[];

  for(const [id,modulePath] of PRODUCT_MODULES){
    const p=registry.products.find(row=>row.id===id);
    if(!p)throw new Error("missing registry product "+id);
    const metadata=require(path.join(ROOT,modulePath));
    if(typeof metadata.catalogResource!=="function"||typeof metadata.openApiPath!=="function"){
      throw new Error("metadata module incomplete for "+id);
    }
    const resource=metadata.catalogResource(base);
    const api=metadata.openApiPath();
    if(resource.resource!==base+p.path)throw new Error(id+" resource path drift");
    if(resource.method!==p.method)throw new Error(id+" method drift");
    if(resource.price!=="$"+p.price_usdc)throw new Error(id+" price drift");
    if(!Array.isArray(resource.accepts)||resource.accepts.length!==1)throw new Error(id+" must expose one accepts entry");
    const accept=resource.accepts[0];
    if(accept.amount!==expectedAtomic(p.price_usdc))throw new Error(id+" atomic amount drift");
    if(accept.network!=="eip155:8453")throw new Error(id+" network drift");
    if(String(accept.asset).toLowerCase()!=="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")throw new Error(id+" asset drift");
    if(String(accept.payTo).toLowerCase()!=="0x708f7b52b56eafd7fc1de65fc7752ed732914021")throw new Error(id+" payTo drift");
    if(!api||typeof api!=="object")throw new Error(id+" openapi path missing");

    resources.push(resource);
    paths[p.path]=api;
    products.push({id,number:p.number,path:p.path,price_usdc:p.price_usdc,status:p.status});
  }

  return {
    catalog:{
      x402Version:2,
      name:"x402 Product Factory staging catalog",
      description:"Machine-generated candidate catalog for factory Products 003–008. Production references 001–002 are intentionally not replaced by this staging bundle.",
      resources
    },
    openapi:{
      openapi:"3.1.0",
      info:{
        title:"x402 Product Factory staging API",
        version:"0.1.0",
        description:"Machine-generated staging OpenAPI for Products 003–008."
      },
      servers:[{url:base}],
      paths
    },
    manifest:{
      schema_version:1,
      public_api_base:base,
      product_count:products.length,
      products
    }
  };
}

function writeReleaseBundle(outDir,publicApiBase=DEFAULT_BASE){
  const bundle=buildReleaseBundle(publicApiBase);
  fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,"x402-catalog.json"),JSON.stringify(bundle.catalog,null,2)+"\n");
  fs.writeFileSync(path.join(outDir,"openapi.json"),JSON.stringify(bundle.openapi,null,2)+"\n");
  fs.writeFileSync(path.join(outDir,"release-manifest.json"),JSON.stringify(bundle.manifest,null,2)+"\n");
  return bundle;
}

if(require.main===module){
  const outDir=process.argv[2]||path.join(ROOT,"generated");
  const base=process.argv[3]||process.env.PUBLIC_API_BASE||DEFAULT_BASE;
  const bundle=writeReleaseBundle(outDir,base);
  console.log(JSON.stringify({ok:true,outDir,productCount:bundle.manifest.product_count,paths:Object.keys(bundle.openapi.paths)},null,2));
}

module.exports={PRODUCT_MODULES,expectedAtomic,buildReleaseBundle,writeReleaseBundle};
