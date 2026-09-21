'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const build=require('./build-site');

function localReferences(html){
  const refs=[];
  const regex=/(?:href|src|action)=["']([^"'#]+)["']/gi;
  let match;
  while((match=regex.exec(html))) refs.push(match[1]);
  return refs;
}
function resolvePublicRef(ref){
  if(
    /^https?:\/\//i.test(ref) ||
    /^(?:mailto|tel|data|javascript):/i.test(ref) ||
    ref.startsWith('//')
  ) return null;
  const clean=ref.split('?')[0].split('#')[0];
  if(!clean||clean==='/') return 'index.html';
  let relative=clean.replace(/^\.\//,'').replace(/^\//,'');
  if(!path.extname(relative)){
    const html=relative+'.html';
    if(fs.existsSync(path.join(build.OUT,html))) return html;
  }
  return relative;
}

try{
  const info=build.build();
  assert.equal(build.validateAllowlist().length,0);
  assert.equal(info.publicFileCount,build.PUBLIC_FILES.length);
  assert.equal(
    info.sourceCommit,
    process.env.COMMIT_REF||process.env.GITHUB_SHA||'local'
  );

  const deployed=fs.readdirSync(build.OUT).sort();
  assert.deepEqual(
    deployed,
    build.PUBLIC_FILES.concat(['build-info.json']).sort()
  );

  for(const forbidden of [
    'pipeline','operations','state','scoring','model-v7.js',
    'model-v7.test.js','BUSINESS_MODEL_V7.md','MODEL_V7.md'
  ]){
    assert.equal(fs.existsSync(path.join(build.OUT,forbidden)),false,forbidden+' leaked into dist');
  }

  for(const file of build.PUBLIC_FILES.filter((name)=>name.endsWith('.html'))){
    const html=fs.readFileSync(path.join(build.OUT,file),'utf8');
    for(const ref of localReferences(html)){
      const resolved=resolvePublicRef(ref);
      if(!resolved) continue;
      assert.equal(
        fs.existsSync(path.join(build.OUT,resolved)),
        true,
        file+' references missing public asset '+ref+' -> '+resolved
      );
    }
  }

  const startHtml=fs.readFileSync(path.join(build.OUT,'start.html'),'utf8');
  assert(startHtml.includes('name="permitplate-onboarding"'));
  assert(startHtml.includes('data-netlify="true"'));
  assert(startHtml.includes('netlify-honeypot="bot-field"'));
  assert(startHtml.includes('name="form-name" value="permitplate-onboarding"'));
  assert(startHtml.includes('action="/start-checkout"'));
  assert(startHtml.includes('name="email"'));
  assert(startHtml.includes('name="category"'));
  assert(startHtml.includes('name="starter"'));

  const stripeUrl='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';
  const stripeOccurrences=[];
  for(const file of build.PUBLIC_FILES.filter((name)=>name.endsWith('.html'))){
    const html=fs.readFileSync(path.join(build.OUT,file),'utf8');
    const count=html.split(stripeUrl).length-1;
    if(count) stripeOccurrences.push({file,count});
  }
  assert.deepEqual(stripeOccurrences,[{file:'start-checkout.html',count:2}]);

  const handoff=fs.readFileSync(path.join(build.OUT,'start-checkout.html'),'utf8');
  assert(handoff.includes('http-equiv="refresh"'));
  assert(handoff.includes(stripeUrl));

  const manifest=JSON.parse(fs.readFileSync(path.join(build.OUT,'build-info.json'),'utf8'));
  assert.equal(manifest.publicFileCount,build.PUBLIC_FILES.length);
  assert.equal(manifest.files.length,build.PUBLIC_FILES.length);
  assert(manifest.files.every((item)=>/^[0-9a-f]{64}$/.test(item.sha256)));
  assert(manifest.files.every((item)=>item.bytes>0));

  console.log('PermitPlate public deployment boundary tests passed.');
}finally{
  fs.rmSync(build.OUT,{recursive:true,force:true});
}
