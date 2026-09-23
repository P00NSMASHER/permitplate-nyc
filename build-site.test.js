'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const build=require('./build-site');

const PROJECT_PREFIX='/permitplate-nyc/';
const STRIPE_URL='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';

function localReferences(html){
  const refs=[];
  const regex=/(?:href|src|action|srcset)=["']([^"'#]+)["']/gi;
  let match;
  while((match=regex.exec(html))){
    for(const candidate of match[1].split(',').map((part)=>part.trim().split(/\s+/)[0])){
      if(candidate) refs.push(candidate);
    }
  }
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
  return relative||'index.html';
}

try{
  const info=build.build();
  assert.equal(build.validateAllowlist().length,0);
  assert.equal(info.publicFileCount,build.PUBLIC_FILES.length);
  assert.equal(info.sourceCommit,process.env.COMMIT_REF||process.env.GITHUB_SHA||'local');

  assert.deepEqual(
    build.listFilesRecursive(build.OUT),
    build.PUBLIC_FILES.concat(['build-info.json']).sort()
  );
  for(const forbidden of [
    'pipeline','operations','state','scoring','model-v7.js','model-v7.test.js',
    'BUSINESS_MODEL_V7.md','MODEL_V7.md','_headers','_redirects','netlify.toml'
  ]){
    assert.equal(fs.existsSync(path.join(build.OUT,forbidden)),false,forbidden+' leaked into dist');
  }

  const htmlFiles=build.PUBLIC_FILES.filter((name)=>name.endsWith('.html'));
  for(const file of htmlFiles){
    const html=fs.readFileSync(path.join(build.OUT,file),'utf8');
    assert(!/netlify/i.test(html),file+' still contains Netlify coupling');
    assert(!html.includes('data-netlify'),file+' still contains Netlify Forms');
    assert(html.includes('http-equiv="Content-Security-Policy"'),file+' is missing CSP');
    assert(html.includes("default-src 'self'"),file+' is missing restrictive default-src');
    assert(html.includes("object-src 'none'"),file+' does not disable objects');
    assert(html.includes('name="referrer" content="strict-origin-when-cross-origin"'),file+' is missing referrer policy');
    assert(!html.includes(' style='),file+' contains inline styling');
    assert(!/<script>([\s\S]*?)<\/script>/.test(html),file+' contains inline script');
    for(const ref of localReferences(html)){
      if(ref.startsWith('/')&&!ref.startsWith('//')){
        assert(ref.startsWith(PROJECT_PREFIX),file+' escapes the GitHub Pages project: '+ref);
      }
      const resolved=resolvePublicRef(ref);
      if(!resolved) continue;
      assert.equal(fs.existsSync(path.join(build.OUT,resolved)),true,file+' references missing '+ref);
    }
  }

  const index=fs.readFileSync(path.join(build.OUT,'index.html'),'utf8');
  assert(index.includes('Good timing starts with a'));
  assert(index.includes('Founder reviewed'));
  assert(index.includes('Up to 10'));
  assert(index.includes('First brief in 5 business days'));
  assert(index.includes('data-source-freshness'));
  assert(index.includes('data-product-build'));
  assert((index.match(/<img /g)||[]).length>=6,'homepage should use all six image scenes');
  assert((index.match(/assets\/images\//g)||[]).length>=12,'homepage needs responsive image variants');
  for(const stale of [
    'Request launch access','No payment collected yet','Self-serve checkout remains paused',
    'Up to 25 qualifying signals','Equipment priority','MODEL V7'
  ]) assert.equal(index.includes(stale),false,'stale public claim: '+stale);

  const start=fs.readFileSync(path.join(build.OUT,'start.html'),'utf8');
  assert(start.includes(STRIPE_URL));
  assert.equal(start.split(STRIPE_URL).length-1,1);
  assert(start.includes('Continue to secure checkout'));
  assert(start.includes('First brief within 5 business days'));
  assert(start.includes('7-day first-payment refund'));
  assert(start.includes('rel="noopener"'));
  assert(!start.includes('<form'));

  const stripeOccurrences=[];
  for(const file of htmlFiles){
    const html=fs.readFileSync(path.join(build.OUT,file),'utf8');
    const count=html.split(STRIPE_URL).length-1;
    if(count) stripeOccurrences.push({file,count});
  }
  assert.deepEqual(stripeOccurrences,[{file:'start.html',count:1}]);

  const methodology=fs.readFileSync(path.join(build.OUT,'methodology.html'),'utf8');
  const terms=fs.readFileSync(path.join(build.OUT,'terms.html'),'utf8');
  const welcome=fs.readFileSync(path.join(build.OUT,'welcome.html'),'utf8');
  assert(methodology.includes('paid brief does not use or show a model score'));
  assert(methodology.includes('Source updated'));
  assert(methodology.includes('PermitPlate reviewed'));
  assert(terms.includes('weekly brief contains up to 10 matching signals'));
  assert(terms.includes('costs $79 USD per month'));
  assert(welcome.includes('name="robots" content="noindex,nofollow"'));
  assert(welcome.includes('within five business days'));

  const siteJs=fs.readFileSync(path.join(build.OUT,'site.js'),'utf8');
  assert(!siteJs.includes(STRIPE_URL));
  assert(siteJs.includes("fetch('/permitplate-nyc/build-info.json'"));
  assert(siteJs.includes('upstream metadata only'));
  assert(siteJs.includes('Public build identity unavailable'));

  for(const asset of [
    'assets/fonts/newsreader-latin-variable.woff2',
    'assets/fonts/familjen-grotesk-latin.woff2',
    'assets/images/hero-restaurant-large.webp',
    'assets/images/research-desk-large.webp',
    'assets/images/kitchen-install-large.webp',
    'assets/images/pos-commissioning-large.webp',
    'assets/images/storefront-renovation-large.webp',
    'assets/images/service-operations-large.webp'
  ]) assert(fs.statSync(path.join(build.OUT,asset)).size>1000,asset+' is empty');

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
