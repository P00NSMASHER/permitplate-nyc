"use strict";

const fs=require("node:fs");
const path=require("node:path");
const registry=require("../product-registry.json");
const {
  MODULES,
  managedProducts,
  buildCatalog,
  buildOpenApi,
}=require("../packages/discovery/generator");

const ROOT=path.resolve(__dirname,"..");
const DEFAULT_BASE="https://candidate.example";

function expectedAtomic(priceUsdc){
  const n=Number(priceUsdc);
  if(!Number.isFinite(n)||n<0)throw new Error("invalid registry price "+priceUsdc);
  return String(Math.round(n*1_000_000));
}

function buildReleaseBundle(publicApiBase=DEFAULT_BASE){
  const base=String(publicApiBase).replace(/\/$/,"");
  if(!/^https:\/\//.test(base))throw new Error("publicApiBase must use https");

  const products=managedProducts();
  const catalog=buildCatalog(base);
  const openapi=buildOpenApi(base);

  if(catalog.resources.length!==products.length)throw new Error("catalog product-count drift");
  if(Object.keys(openapi.paths).length!==products.length)throw new Error("OpenAPI product-count drift");

  const manifestProducts=[];
  for(let i=0;i<products.length;i++){
    const p=products[i];
    const resource=catalog.resources[i];
    const metadata=MODULES[p.id];
    if(!metadata)throw new Error("missing metadata module "+p.id);
    if(resource.resource!==base+p.path)throw new Error(p.id+" resource path drift");
    if(resource.method!==p.method)throw new Error(p.id+" method drift");
    if(resource.price!=="$"+p.price_usdc)throw new Error(p.id+" price drift");
    if(!Array.isArray(resource.accepts)||resource.accepts.length!==1)throw new Error(p.id+" must expose one accepts entry");

    const accept=resource.accepts[0];
    if(accept.amount!==expectedAtomic(p.price_usdc))throw new Error(p.id+" atomic amount drift");
    if(accept.network!=="eip155:8453")throw new Error(p.id+" network drift");
    if(String(accept.asset).toLowerCase()!=="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")throw new Error(p.id+" asset drift");
    if(String(accept.payTo).toLowerCase()!=="0x708f7b52b56eafd7fc1de65fc7752ed732914021")throw new Error(p.id+" payTo drift");
    if(!openapi.paths[p.path])throw new Error(p.id+" OpenAPI path missing");

    manifestProducts.push({
      id:p.id,
      number:p.number,
      path:p.path,
      price_usdc:p.price_usdc,
      status:p.status
    });
  }

  return {
    catalog:{
      ...catalog,
      name:"x402 Product Factory staging catalog",
      description:"Machine-generated catalog for every registry product that is both modular and currently in a staging status. Production references 001–002 are not replaced by this bundle."
    },
    openapi:{
      ...openapi,
      info:{
        ...openapi.info,
        title:"x402 Product Factory staging API",
        description:"Machine-generated staging OpenAPI derived from the canonical product registry and metadata module map."
      }
    },
    manifest:{
      schema_version:1,
      public_api_base:base,
      registry_version:registry.version,
      product_count:manifestProducts.length,
      products:manifestProducts
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
  console.log(JSON.stringify({
    ok:true,
    outDir,
    productCount:bundle.manifest.product_count,
    products:bundle.manifest.products.map(p=>p.number+" "+p.id),
    paths:Object.keys(bundle.openapi.paths)
  },null,2));
}

module.exports={expectedAtomic,buildReleaseBundle,writeReleaseBundle};
