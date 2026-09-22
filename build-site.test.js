'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const build=require('./build-site');

const PROJECT_PREFIX='/permitplate-nyc/';

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
  if(!clean||clean===PROJECT_PREFIX) return 'index.html';

  let relative=clean;
  if(relative.startsWith(PROJECT_PREFIX)) relative=relative.slice(PROJECT_PREFIX.length);
  relative=relative.replace(/^\.\//,'').replace(/^\//,'');
  if(!relative) return 'index.html';
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
    'model-v7.test.js','BUSINESS_MODEL_V7.md','MODEL_V7.md',
    '_headers','_redirects','netlify.toml','start-checkout.html'
  ]){
    assert.equal(fs.existsSync(path.join(build.OUT,forbidden)),false,forbidden+' leaked into dist');
  }

  for(const file of build.PUBLIC_FILES.filter((name)=>name.endsWith('.html'))){
    const html=fs.readFileSync(path.join(build.OUT,file),'utf8');
    assert(!/netlify/i.test(html),file+' still contains Netlify coupling');
    assert(!html.includes('data-netlify'),file+' still contains Netlify Forms');
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
  const stripeUrl='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';
  assert.equal(startHtml.split(stripeUrl).length-1,0);
  assert(startHtml.includes('Stripe will be the authoritative onboarding record.'));
  assert(startHtml.includes('Activation stays fail-closed.'));
  assert(startHtml.includes('Checkout activation is temporarily blocked.'));
  assert(startHtml.includes('No payment can start from this page'));
  assert(!startHtml.includes('<form'));
  assert(!startHtml.includes('activation_ref'));
  assert(!startHtml.includes('locked_prefilled_email'));
  assert(!startHtml.includes('client_reference_id'));

  const stripeOccurrences=[];
  for(const file of build.PUBLIC_FILES.filter((name)=>name.endsWith('.html'))){
    const html=fs.readFileSync(path.join(build.OUT,file),'utf8');
    const count=html.split(stripeUrl).length-1;
    if(count) stripeOccurrences.push({file,count});
  }
  assert.deepEqual(stripeOccurrences,[]);

  const siteJs=fs.readFileSync(path.join(build.OUT,'site.js'),'utf8');
  assert(!siteJs.includes(stripeUrl));
  assert(!siteJs.includes('permitplate-onboarding'));
  assert(!siteJs.includes('client_reference_id'));

  const indexHtml=fs.readFileSync(path.join(build.OUT,'index.html'),'utf8');
  assert(indexHtml.includes('https://p00nsmasher.github.io/permitplate-nyc/'));
  assert(!indexHtml.includes('permitplate-nyc.netlify.app'));

  const manifest=JSON.parse(fs.readFileSync(path.join(build.OUT,'build-info.json'),'utf8'));
  assert.equal(manifest.publicFileCount,build.PUBLIC_FILES.length);
  assert.equal(manifest.files.length,build.PUBLIC_FILES.length);
  assert.equal(manifest.publicSourceFingerprint,build.publicSourceFingerprint(manifest.files));
  assert.match(manifest.publicSourceFingerprint,/^[0-9a-f]{64}$/);
  assert(manifest.files.every((item)=>/^[0-9a-f]{64}$/.test(item.sha256)));
  assert(manifest.files.every((item)=>item.bytes>0));

  console.log('PermitPlate GitHub Pages deployment boundary tests passed.');
}finally{
  fs.rmSync(build.OUT,{recursive:true,force:true});
}
