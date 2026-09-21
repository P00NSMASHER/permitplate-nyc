'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const ROOT=__dirname;
const OUT=path.join(ROOT,'dist');

const PUBLIC_FILES=Object.freeze([
  '404.html',
  '_headers',
  '_redirects',
  'apple-touch-icon.png',
  'favicon.svg',
  'index.html',
  'manifest.webmanifest',
  'methodology.html',
  'og-card.png',
  'privacy.html',
  'refunds.html',
  'release-manifest.json',
  'robots.txt',
  'sample.html',
  'site.css',
  'site.js',
  'start.html',
  'start-checkout.html',
  'sitemap.xml',
  'terms.html'
]);

function sha256File(filePath){
  const hash=crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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

function build(){
  const failures=validateAllowlist();
  if(failures.length) throw new Error(failures.join('\n'));

  fs.rmSync(OUT,{recursive:true,force:true});
  fs.mkdirSync(OUT,{recursive:true});

  const files=[];
  for(const file of PUBLIC_FILES){
    const source=path.join(ROOT,file);
    const target=path.join(OUT,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);
    files.push({
      path:file,
      sha256:sha256File(target),
      bytes:fs.statSync(target).size
    });
  }

  const buildInfo={
    buildInfoVersion:'PermitPlate-public-build-v1.0.0',
    sourceCommit:process.env.COMMIT_REF||process.env.GITHUB_SHA||'local',
    deployContext:process.env.CONTEXT||process.env.DEPLOY_CONTEXT||'local',
    builtAt:new Date().toISOString(),
    publicFileCount:files.length,
    files
  };
  fs.writeFileSync(
    path.join(OUT,'build-info.json'),
    JSON.stringify(buildInfo,null,2)+'\n'
  );

  const actual=fs.readdirSync(OUT).sort();
  const expected=PUBLIC_FILES.concat(['build-info.json']).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)){
    throw new Error('DIST_CONTENT_MISMATCH');
  }

  return buildInfo;
}

if(require.main===module){
  const info=build();
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
  sha256File,
  validateAllowlist,
  build
};
