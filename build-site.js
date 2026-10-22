'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const ROOT=__dirname;
const OUT=path.join(ROOT,'dist');
const LEGACY_SITE_BASE='https://p00nsmasher.github.io/permitplate-nyc/';
const STANDALONE_SITE_BASE='https://permitplate.retallyrecovery.com/';
const GROUP_URL='https://group.retallyrecovery.com/';
const STANDALONE_GENERATED_FILES=Object.freeze(['_headers']);
const STANDALONE_HEADERS="/*\n"+
  "  Strict-Transport-Security: max-age=86400\n"+
  "  X-Content-Type-Options: nosniff\n"+
  "  Referrer-Policy: strict-origin-when-cross-origin\n"+
  "  Content-Security-Policy: object-src 'none'; frame-ancestors 'none'; base-uri 'self'\n";

const PUBLIC_FILES=Object.freeze([
  "assets/brand/permitplate-emblem.webp",
  "assets/brand/permitplate-favicon.png",
  "assets/brand/native-brand-assets.json",
  "assets/brand/permitplate-600-20261022.webp",
  "assets/brand/permitplate-1200-20261022.webp",
  "assets/brand/permitplate-wordmark-20261022.webp",
  "assets/brand/permitplate-social-20261022.png",
  "assets/brand/permitplate-icon-20261022.png",
  "assets/brand/approved-brand-assets.json",
  "assets/brand/approved-brand-20261022.css",
  '404.html',
  'apple-touch-icon.png',
  'assets/fonts/familjen-grotesk-latin.woff2',
  'assets/fonts/LICENSE-Familjen-Grotesk.txt',
  'assets/fonts/LICENSE-Newsreader.txt',
  'assets/fonts/newsreader-latin-variable.woff2',
  'assets/images/hero-restaurant-large.webp',
  'assets/images/hero-restaurant-small.webp',
  'assets/images/kitchen-install-large.webp',
  'assets/images/kitchen-install-small.webp',
  'assets/images/pos-commissioning-large.webp',
  'assets/images/pos-commissioning-small.webp',
  'assets/images/research-desk-large.webp',
  'assets/images/research-desk-small.webp',
  'assets/images/service-operations-large.webp',
  'assets/images/service-operations-small.webp',
  'assets/images/storefront-renovation-large.webp',
  'assets/images/storefront-renovation-small.webp',
  'favicon.svg',
  'field-notes.html',
  'index.html',
  'manifest.webmanifest',
  'methodology.html',
  'og-card.png',
  'permit-pack.html',
  'privacy.html',
  'refunds.html',
  'release-manifest.json',
  'robots.txt',
  'sample.html',
  'site.css',
  'site.js',
  'start.html',
  'sitemap.xml',
  'terms.html',
  'welcome.html'
]);

function sha256File(filePath){
  const hash=crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}
function publicSourceFingerprint(files){
  const lines=(files||[]).slice()
    .sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
    .map((item)=>item.path+':'+item.sha256)
    .join('\n');
  return crypto.createHash('sha256').update(lines).digest('hex');
}
function listFilesRecursive(directory,prefix=''){
  const out=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const relative=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isDirectory()) out.push(...listFilesRecursive(path.join(directory,entry.name),relative));
    else if(entry.isFile()) out.push(relative);
  }
  return out.sort();
}

function validateAllowlist(){
  const failures=[];
  for(const file of PUBLIC_FILES){
    const source=path.join(ROOT,file);
    if(!fs.existsSync(source)||!fs.statSync(source).isFile()){
      failures.push('MISSING_PUBLIC_FILE:'+file);
    }
    if(
      file.startsWith('pipeline/') ||
      file.startsWith('operations/') ||
      file.startsWith('state/') ||
      file.startsWith('scoring/') ||
      /(?:^|\/)model-v7(?:\.test)?\.js$/.test(file) ||
      /\.md$/i.test(file)
    ){
      failures.push('BACKEND_FILE_IN_PUBLIC_ALLOWLIST:'+file);
    }
  }
  return failures;
}

function siteBaseOption(value){
  const siteBase=value||LEGACY_SITE_BASE;
  if(![LEGACY_SITE_BASE,STANDALONE_SITE_BASE].includes(siteBase)){
    throw new Error('UNSUPPORTED_SITE_BASE: '+siteBase);
  }
  return siteBase;
}

function cleanHtmlUrl(value){
  return value.replace(/\/index\.html(?=[?#]|$)/,'/')
    .replace(/\.html(?=[?#]|$)/,'');
}

function standaloneContent(file,source,siteBase){
  if(!/\.(?:html|css|js|json|webmanifest|xml|txt)$/.test(file)) return source;
  let text=source.toString('utf8').split(LEGACY_SITE_BASE).join(siteBase)
    .replace(/(["'(=])\/permitplate-nyc\//g,'$1/');
  // Pages redirects .html requests to extensionless routes. Keep metadata and
  // first-party navigation aligned with the destination, without changing files.
  const escapedBase=siteBase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  text=text.replace(new RegExp(escapedBase+'[^\\s"\'<>]*','g'),cleanHtmlUrl);
  if(file.endsWith('.html')){
    // Each responsive candidate is a URL; later srcset entries can follow commas.
    text=text.replace(/\bsrcset=(["'])([^"']*)\1/g,(_match,quote,value)=>
      'srcset='+quote+value.replace(/(^|,\s*)\/permitplate-nyc\//g,'$1/')+quote);
    if(file==='privacy.html'){
      text=text.replace('Effective October 1, 2026','Effective October 22, 2026')
        .replace('<h2 id="providers">3. Service providers</h2>',
          '<h2 id="providers">3. Service providers</h2>\n'+
          '      <p>This public website is hosted on Cloudflare Pages. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>.</p>');
    }
    text=text.replace(/\b(href|action)=(["'])(\/[^"']*)\2/g,
      (match,attribute,quote,value)=>attribute+'='+quote+cleanHtmlUrl(value)+quote);
    const affiliation='<div class="shell retally-affiliation"><a href="'+GROUP_URL+'">Part of RETALLY Group</a></div>';
    if(text.includes('</footer>')) text=text.replace('</footer>',affiliation+'\n  </footer>');
    else text=text.replace('</body>','<footer class="retally-affiliation-footer">'+affiliation+'</footer>\n</body>');
    // Keep the existing public contact usable without an injected decode script.
    text=text.replace(/<body\b[^>]*>/,'$&\n<!--email_off-->')
      .replace('</body>','<!--/email_off-->\n</body>');
  }
  if(file==='site.css'){
    text+='\n/* Affiliation on the standalone company site. */\n'+
      '.retally-affiliation{padding-top:20px;font-size:14px}\n'+
      '.retally-affiliation a{display:inline-flex;align-items:center;min-height:44px;color:inherit;font-weight:700;text-decoration-thickness:1px}\n'+
      '.retally-affiliation-footer{background:#11070d;color:var(--paper);padding:8px 0 24px}\n';
  }
  if(file==='release-manifest.json'){
    const release=JSON.parse(text);
    release.deployment.provider='Cloudflare Pages';
    release.deployment.url=siteBase;
    text=JSON.stringify(release,null,2)+'\n';
  }
  return Buffer.from(text);
}

function build(options={}){
  const siteBase=siteBaseOption(options.siteBase);
  const standalone=siteBase===STANDALONE_SITE_BASE;
  const failures=validateAllowlist();
  if(standalone){
    for(const file of ['functions','_worker.js','wrangler.toml','wrangler.json','wrangler.jsonc']){
      if(fs.existsSync(path.join(ROOT,file))) failures.push('UNEXPECTED_PAGES_RUNTIME:'+file);
    }
  }
  if(failures.length) throw new Error(failures.join('\n'));

  fs.rmSync(OUT,{recursive:true,force:true});
  fs.mkdirSync(OUT,{recursive:true});

  const files=[];
  for(const file of PUBLIC_FILES){
    const source=path.join(ROOT,file);
    const target=path.join(OUT,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(standalone) fs.writeFileSync(target,standaloneContent(file,fs.readFileSync(source),siteBase));
    else fs.copyFileSync(source,target);
    files.push({
      path:file,
      sha256:sha256File(target),
      bytes:fs.statSync(target).size
    });
  }

  if(standalone){
    const target=path.join(OUT,'_headers');
    fs.writeFileSync(target,STANDALONE_HEADERS);
    files.push({path:'_headers',sha256:sha256File(target),bytes:fs.statSync(target).size});
  }

  const buildInfo={
    buildInfoVersion:'PermitPlate-public-build-v1.0.0',
    sourceCommit:(standalone&&process.env.CF_PAGES_COMMIT_SHA)||process.env.COMMIT_REF||process.env.GITHUB_SHA||'local',
    deployContext:standalone?'cloudflare-pages':process.env.CONTEXT||process.env.DEPLOY_CONTEXT||'local',
    builtAt:new Date().toISOString(),
    publicFileCount:files.length,
    publicSourceFingerprint:publicSourceFingerprint(files),
    files
  };
  if(standalone){
    buildInfo.company='PermitPlate';
    buildInfo.canonical=siteBase;
    buildInfo.group=GROUP_URL;
    buildInfo.sourceBranch=process.env.CF_PAGES_BRANCH||'main';
  }
  fs.writeFileSync(
    path.join(OUT,'build-info.json'),
    JSON.stringify(buildInfo,null,2)+'\n'
  );

  const actual=listFilesRecursive(OUT);
  const expected=PUBLIC_FILES.concat(standalone?STANDALONE_GENERATED_FILES:[],'build-info.json').sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)){
    throw new Error('DIST_CONTENT_MISMATCH');
  }

  return buildInfo;
}

if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length&&(args.length!==2||args[0]!=='--site-base')){
    throw new Error('Usage: node build-site.js [--site-base '+STANDALONE_SITE_BASE+']');
  }
  const info=build({siteBase:args[1]});
  console.log(JSON.stringify({
    sourceCommit:info.sourceCommit,
    deployContext:info.deployContext,
    publicFileCount:info.publicFileCount,
    output:'dist'
  },null,2));
}

module.exports={
  PUBLIC_FILES,
  ROOT,
  OUT,
  LEGACY_SITE_BASE,
  STANDALONE_SITE_BASE,
  GROUP_URL,
  STANDALONE_GENERATED_FILES,
  siteBaseOption,
  standaloneContent,
  sha256File,
  publicSourceFingerprint,
  listFilesRecursive,
  validateAllowlist,
  build
};
