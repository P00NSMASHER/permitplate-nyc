'use strict';

const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const site=require('./build-site');

const read=(file)=>fs.readFileSync(path.join(site.OUT,file),'utf8');
const original=site.PUBLIC_FILES.map(file=>({path:file,sha256:site.sha256File(path.join(site.ROOT,file))}));
const env={CF_PAGES_COMMIT_SHA:process.env.CF_PAGES_COMMIT_SHA,GITHUB_SHA:process.env.GITHUB_SHA,COMMIT_REF:process.env.COMMIT_REF};
const checkoutReferences=(html)=>Array.from(html.matchAll(/href=(["'])((?:https:\/\/(?:buy|billing)\.stripe\.com\/|mailto:)[^"']*)\1/g),match=>match[2]);

function checkReference(ref,from){
  if(!ref||ref.startsWith('#')||/^(?:mailto|tel|data):/.test(ref)) return;
  const url=new URL(ref,new URL(from,site.STANDALONE_SITE_BASE));
  if(url.origin!==new URL(site.STANDALONE_SITE_BASE).origin) return;
  const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
  const candidates=relative?[relative,relative+'.html',relative+'/index.html']:['index.html'];
  assert(candidates.some(file=>fs.existsSync(path.join(site.OUT,file))),'Missing reference '+from+': '+ref);
}

try{
  // The established GitHub Pages build remains an exact copy of its allowlist.
  site.build();
  for(const item of original) assert.equal(site.sha256File(path.join(site.OUT,item.path)),item.sha256,'Default output changed: '+item.path);
  assert(!read('index.html').includes('Part of RETALLY Group'));
  assert(!fs.existsSync(path.join(site.OUT,'_headers')),'Default build must not emit Cloudflare headers');
  assert(read('privacy.html').includes('Effective October 1, 2026'));
  assert(!read('privacy.html').includes('This public website is hosted on Cloudflare Pages.'));

  process.env.CF_PAGES_COMMIT_SHA='a'.repeat(40);
  process.env.GITHUB_SHA='b'.repeat(40);
  process.env.COMMIT_REF='c'.repeat(40);
  const info=site.build({siteBase:site.STANDALONE_SITE_BASE});
  assert.equal(info.sourceCommit,'a'.repeat(40),'Cloudflare revision must win');
  assert.equal(info.company,'PermitPlate');
  assert.equal(info.canonical,site.STANDALONE_SITE_BASE);
  assert.equal(info.deployContext,'cloudflare-pages');
  assert.deepEqual(site.listFilesRecursive(site.OUT),site.PUBLIC_FILES.concat('_headers','build-info.json').sort());
  assert.equal(info.publicFileCount,site.PUBLIC_FILES.length+1);
  assert.equal(read('_headers'),"/*\n"+
    "  Strict-Transport-Security: max-age=86400\n"+
    "  X-Content-Type-Options: nosniff\n"+
    "  Referrer-Policy: strict-origin-when-cross-origin\n"+
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()\n"+
    "  X-Frame-Options: DENY\n"+
    "  Content-Security-Policy: default-src 'self'; connect-src 'self' https://data.cityofnewyork.us; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests\n");
  assert(info.files.some(file=>file.path==='_headers'),'Header configuration must be fingerprinted');

  for(const file of site.PUBLIC_FILES.filter(name=>name.endsWith('.html'))){
    const html=read(file);
    const source=fs.readFileSync(path.join(site.ROOT,file),'utf8');
    assert(!html.includes(site.LEGACY_SITE_BASE),file+' has a legacy canonical');
    assert(!html.includes('"/permitplate-nyc/'),file+' has a legacy project path');
    assert.equal(html.split('Part of RETALLY Group').length-1,1,file+' needs one group affiliation');
    assert(html.includes('href="'+site.GROUP_URL+'"'));
    assert(html.includes('<!--email_off-->')&&html.includes('<!--/email_off-->'));
    assert(html.includes('http-equiv="Content-Security-Policy"'));
    assert.deepEqual(checkoutReferences(html),checkoutReferences(source),'Checkout or mail recipient changed: '+file);
    for(const match of html.matchAll(/\b(?:href|src|action)=(["'])([^"']*)\1/g)) checkReference(match[2],file);
    for(const match of html.matchAll(/\bsrcset=(["'])([^"']*)\1/g)){
      for(const candidate of match[2].split(',')) checkReference(candidate.trim().split(/\s+/)[0],file);
    }
    const canonical=html.match(/rel="canonical" href="([^"]+)"/);
    if(canonical){
      assert(canonical[1].startsWith(site.STANDALONE_SITE_BASE));
      assert(!canonical[1].endsWith('.html'),'Canonical should use Pages clean routes');
    }
  }
  for(const match of read('site.css').matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/g)) checkReference(match[1],'site.css');
  assert(read('site.js').includes("fetch('/build-info.json'"));
  assert(!read('site.js').includes('/permitplate-nyc/'));
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url,'/');
  checkReference(manifest.icons[0].src,'index.html');
  assert.equal(JSON.parse(read('release-manifest.json')).deployment.provider,'Cloudflare Pages');
  assert(read('sitemap.xml').includes(site.STANDALONE_SITE_BASE+'permit-pack</loc>'));
  assert(!read('sitemap.xml').includes('.html</loc>'));
  assert(read('robots.txt').includes(site.STANDALONE_SITE_BASE+'sitemap.xml'));
  assert(read('welcome.html').includes('Viewing this page alone is not payment confirmation.'));
  assert(read('start.html').includes('$79'));
  assert(read('permit-pack.html').includes('Buy securely for $29'));

  const hostingParagraph='<p>This public website is hosted on Cloudflare Pages. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>.</p>';
  const privacy=read('privacy.html');
  assert(privacy.includes(hostingParagraph),'Standalone privacy must disclose the actual public host');
  assert(privacy.includes('Effective October 22, 2026'));
  const proseText=html=>html.match(/<article class="prose">([\s\S]*?)<\/article>/)[1]
    .replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  assert.equal(proseText(privacy.replace(hostingParagraph,'')),
    proseText(fs.readFileSync(path.join(site.ROOT,'privacy.html'),'utf8')),
    'Hosting disclosure must preserve all existing provider and data-handling commitments');
  assert.equal(proseText(read('terms.html')),
    proseText(fs.readFileSync(path.join(site.ROOT,'terms.html'),'utf8')),
    'Standalone hosting must not alter the terms');

  for(const file of info.files){
    assert.equal(file.sha256,site.sha256File(path.join(site.OUT,file.path)));
    assert.equal(file.bytes,fs.statSync(path.join(site.OUT,file.path)).size);
  }
  assert.equal(info.publicSourceFingerprint,site.publicSourceFingerprint(info.files));
  assert.throws(()=>site.build({siteBase:'https://unowned.example/'}),/UNSUPPORTED_SITE_BASE/);
  for(const item of original) assert.equal(site.sha256File(path.join(site.ROOT,item.path)),item.sha256,'Source file was mutated: '+item.path);
  console.log('PermitPlate standalone paths, publication boundary, checkout continuity and revision identity passed.');
}finally{
  for(const [name,value] of Object.entries(env)){
    if(value===undefined) delete process.env[name];
    else process.env[name]=value;
  }
  fs.rmSync(site.OUT,{recursive:true,force:true});
}

