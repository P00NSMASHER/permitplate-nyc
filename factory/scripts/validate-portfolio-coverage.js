"use strict";

const fs=require("node:fs");
const path=require("node:path");

function validatePortfolioCoverage(root=path.resolve(__dirname,"../..")){
  const read=(relative)=>fs.readFileSync(path.join(root,relative),"utf8");
  const exists=(relative)=>fs.existsSync(path.join(root,relative));

  const registry=JSON.parse(read("factory/product-registry.json"));
  const migration=JSON.parse(read("factory/MIGRATION_MANIFEST.json"));
  const generator=read("factory/packages/discovery/generator.js");
  const runtime=read("factory/runtime/create-runtime.js");
  const ci=read(".github/workflows/factory-pa-vendor-gate-ci.yml");
  const smoke=read(".github/workflows/factory-product-003-live-smoke.yml");
  const readme=read("factory/README.md");

  const products=registry.products.filter(p=>/staging$/.test(String(p.status)));
  const problems=[];

  const requiredProductFiles=[
    "decision.js",
    "decision.test.js",
    "service.js",
    "service.test.js",
    "paid-handler.js",
    "paid-handler.test.js",
    "metadata.js",
    "metadata.test.js",
    "live-smoke.js",
    "DEPLOYMENT_PLAN.md"
  ];

  for(const product of products){
    const base="factory/products/"+product.id;

    for(const name of requiredProductFiles){
      const relative=base+"/"+name;
      if(!exists(relative))problems.push(product.id+":missing_file:"+name);
    }

    if(!product.release_gate){
      problems.push(product.id+":missing_registry_release_gate");
    }else if(!exists(product.release_gate)){
      problems.push(product.id+":release_gate_file_missing:"+product.release_gate);
    }

    if(!product.deployment_blocker){
      problems.push(product.id+":missing_registry_deployment_blocker");
    }

    if(!migration.products.includes(product.number)){
      problems.push(product.id+":missing_migration_manifest_number");
    }

    if(!generator.includes('"'+product.id+'"')){
      problems.push(product.id+":missing_discovery_wiring");
    }

    if(!runtime.includes('"'+product.id+'"')){
      problems.push(product.id+":missing_runtime_wiring");
    }

    if(product.release_gate&&!ci.includes(path.basename(product.release_gate))){
      problems.push(product.id+":missing_ci_release_gate");
    }

    if(!ci.includes("factory/products/"+product.id+"/")){
      problems.push(product.id+":missing_ci_product_tests");
    }

    if(!smoke.includes("factory/products/"+product.id+"/")){
      problems.push(product.id+":missing_live_smoke_trigger");
    }

    if(!smoke.includes("factory/products/"+product.id+"/live-smoke.js")){
      problems.push(product.id+":missing_live_smoke_step");
    }

    if(!readme.includes("| "+product.number+" |")){
      problems.push(product.id+":missing_readme_portfolio_row");
    }
  }

  return {
    ok:problems.length===0,
    stagingProductCount:products.length,
    stagingProductIds:products.map(p=>p.id),
    problems
  };
}

if(require.main===module){
  const result=validatePortfolioCoverage();
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=2;
}

module.exports={validatePortfolioCoverage};
