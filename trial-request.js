(function(root){
  'use strict';
  const categories=['pos','insurance','equipment','hoodfire','waste','pest','linen','distribution'];
  const territories=['AllNYC','Manhattan','Brooklyn','Queens','Bronx','StatenIsland',
    'ManhattanBrooklyn','ManhattanQueens','BrooklynQueens','ManhattanBronx',
    'ManhattanBrooklynQueens','BrooklynStatenIsland'];
  function publicDomain(value){
    const name=String(value||'').toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
    if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)||
      /\.(?:local|localhost|localdomain|internal|lan|home|test|example|invalid|onion)$/.test(name))
      throw Error('Use a public business domain, such as yourbusiness.com.');
    return name;
  }
  function buildRequest(input){
    const name=String(input.businessName||'').trim();
    if(name.length<2||name.length>160||/[\r\n\x00-\x1f]/.test(name))throw Error('Enter your business name.');
    let website;
    try{website=new URL(String(input.website||'').trim());}catch{throw Error('Enter a full business website, starting with https://.');}
    if(website.protocol!=='https:'||website.username||website.password||!website.hostname.includes('.')||website.port)
      throw Error('Use your public business website with https://.');
    publicDomain(website.hostname);
    if(!categories.includes(input.category)||!territories.includes(input.territory))
      throw Error('Choose one vendor category and NYC territory.');
    const body=['Hello, I would like to request the PermitPlate 14-day free trial.','',
      'Business: '+name,'Business website: '+website.origin,
      'Vendor category: '+input.category,'NYC territory: '+input.territory,'',
      'Please confirm whether my business and territory are supported before enrollment.',
      'I understand the trial includes up to five source-linked signals per report, a starter brief and one weekly update.',
      'The 14 days start with the first useful report sent successfully. No card or automatic paid upgrade.',
      'If I choose to continue, the separate paid membership is $79/month.'].join('\n');
    return {body,mailto:'mailto:jay@retallyrecovery.com?subject='+encodeURIComponent('PermitPlate free-trial request')+
      '&body='+encodeURIComponent(body)};
  }
  if(typeof module==='object'&&module.exports)module.exports={buildRequest,categories,territories,publicDomain};
  if(!root.document)return;
  const form=root.document.querySelector('[data-trial-request]');
  if(!form)return;
  const link=root.document.querySelector('[data-trial-email]');
  const status=root.document.querySelector('[data-trial-status]');
  const fallback=root.document.querySelector('[data-trial-fallback]');
  const body=root.document.querySelector('[data-trial-body]');
  form.addEventListener('input',()=>{link.hidden=true;link.removeAttribute('href');status.textContent='';fallback.hidden=true;body.value='';});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    try{
      const request=buildRequest(Object.fromEntries(new FormData(form)));
      link.href=request.mailto;link.hidden=false;
      body.value=request.body;fallback.hidden=false;
      status.textContent='Your draft is ready. Open your email app to review and send it. Your trial has not started.';
    }catch(error){status.textContent=error.message;link.hidden=true;link.removeAttribute('href');fallback.hidden=true;body.value='';}
  });
})(typeof window==='undefined'?globalThis:window);
