"use strict";

const assert=require("node:assert/strict");
const registry=require("../product-registry.json");
const manifest=require("../MIGRATION_MANIFEST.json");

function unique(values,label){
  const seen=new Set();
  for(const value of values){
    assert.ok(!seen.has(value),"duplicate "+label+": "+value);
    seen.add(value);
  }
}

function main(){
  const registryNumbers=registry.products.map(p=>p.number);
  const all=manifest.products||[];
  const production=manifest.production_products||[];
  const staging=manifest.staging_products||[];
  const design=manifest.design_products||[];

  unique(all,"manifest product");
  unique(production,"production product");
  unique(staging,"staging product");
  unique(design,"design product");

  assert.deepEqual(all,registryNumbers,"migration manifest products must exactly match registry numbers");

  const classified=[...production,...staging,...design];
  unique(classified,"classified product");
  assert.deepEqual(
    [...classified].sort(),
    [...registryNumbers].sort(),
    "every registry product must be classified exactly once"
  );

  const byNumber=new Map(registry.products.map(p=>[p.number,p]));
  for(const number of production){
    const p=byNumber.get(number);
    assert.ok(p,"unknown production product "+number);
    assert.ok(
      ["reference-production","production-reference"].includes(p.status),
      number+" production classification conflicts with status "+p.status
    );
  }
  for(const number of staging){
    const p=byNumber.get(number);
    assert.ok(p,"unknown staging product "+number);
    assert.match(p.status,/staging$/);
  }
  for(const number of design){
    const p=byNumber.get(number);
    assert.ok(p,"unknown design product "+number);
    assert.equal(p.status,"design");
  }

  console.log(JSON.stringify({
    ok:true,
    productCount:registryNumbers.length,
    production,
    staging,
    design,
    intendedRepository:manifest.intended_repository
  },null,2));
}
main();
