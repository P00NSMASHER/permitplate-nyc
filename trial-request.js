(function(root){
  'use strict';
  const categories=['pos','insurance','equipment','hoodfire','waste','pest','linen','distribution'];
  const territories=['AllNYC','Manhattan','Brooklyn','Queens','Bronx','StatenIsland',
    'ManhattanBrooklyn','ManhattanQueens','BrooklynQueens','ManhattanBronx',
    'ManhattanBrooklynQueens','BrooklynStatenIsland'];
  const origin='https://permitplate.retallyrecovery.com';
  function publicDomain(value){
    const name=String(value||'').toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
    if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)||
      /\.(?:local|localhost|localdomain|internal|lan|home|test|example|invalid|onion)$/.test(name))
      throw Error('Use a public business domain, such as yourbusiness.com.');
    return name;
  }
  function normalizeEmail(value,required){
    const email=String(value||'').trim().toLowerCase();
    if(!email&&!required)return '';
    if(email.length>254||!(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email)))
      throw Error('Enter a valid work email where we can reply.');
    try{publicDomain(email.split('@')[1]);}catch{throw Error('Enter a valid work email where we can reply.');}
    return email;
  }
  function normalizeRequest(input,requireEmail){
    const name=String(input.businessName||'').trim();
    if(name.length<2||name.length>160||/[\r\n\x00-\x1f<>]/.test(name))
      throw Error('Enter your business name.');
    let website;
    try{website=new URL(String(input.website||'').trim());}
    catch{throw Error('Enter a full business website, starting with https://.');}
    if(website.protocol!=='https:'||website.username||website.password||
       !website.hostname.includes('.')||website.port)
      throw Error('Use your public business website with https://.');
    publicDomain(website.hostname);
    if(!categories.includes(input.category)||!territories.includes(input.territory))
      throw Error('Choose one vendor category and NYC territory.');
    return {businessName:name,website:website.origin,
      email:normalizeEmail(input.email,requireEmail),category:input.category,
      territory:input.territory,fax:typeof input.fax==='string'?input.fax:'',consent:true};
  }
  function buildRequest(input){
    const value=normalizeRequest(input,false);
    const lines=['Hello, I would like to request the PermitPlate 14-day free trial.','',
      'Business: '+value.businessName,'Business website: '+value.website];
    if(value.email)lines.push('Contact email: '+value.email);
    lines.push('Vendor category: '+value.category,'NYC territory: '+value.territory,'',
      'Please confirm whether my business and territory are supported before enrollment.',
      'I understand the trial includes up to five source-linked signals per report, a starter brief and one weekly update.',
      'The 14 days start with the first useful report sent successfully. No card or automatic paid upgrade.',
      'If I choose to continue, the separate paid membership is $79/month.');
    const body=lines.join('\n');
    return {body,mailto:'mailto:jay@retallyrecovery.com?subject='+
      encodeURIComponent('PermitPlate free-trial request')+'&body='+encodeURIComponent(body)};
  }
  // An honest research-scope preview, not a claim that any specific lead exists.
  const categoryTopics=Object.freeze({
    pos:['POS and payments','publicly documented changes that may affect checkout, payment, or POS needs'],
    insurance:['Insurance','publicly documented changes that may warrant insurance follow-up'],
    equipment:['Kitchen equipment','publicly documented changes that may involve equipment planning'],
    hoodfire:['Hood and fire','publicly documented changes that may involve hood, ventilation, or fire safety scope'],
    waste:['Waste','publicly documented changes that may involve waste and collection needs'],
    pest:['Pest control','publicly documented changes that may involve pest management needs'],
    linen:['Linen','publicly documented changes that may involve linen service needs'],
    distribution:['Food distribution','publicly documented changes that may involve food-supply planning']
  });
  const territoryNames=Object.freeze({
    AllNYC:'All NYC',Manhattan:'Manhattan',Brooklyn:'Brooklyn',Queens:'Queens',
    Bronx:'Bronx',StatenIsland:'Staten Island',
    ManhattanBrooklyn:'Manhattan and Brooklyn',ManhattanQueens:'Manhattan and Queens',
    BrooklynQueens:'Brooklyn and Queens',ManhattanBronx:'Manhattan and Bronx',
    ManhattanBrooklynQueens:'Manhattan, Brooklyn and Queens',
    BrooklynStatenIsland:'Brooklyn and Staten Island'
  });
  function scopePreview(category,territory){
    if(!categories.includes(category)||!territories.includes(territory))return null;
    const [label,focus]=categoryTopics[category],place=territoryNames[territory];
    const scope=label+' in '+place;
    return Object.freeze({
      scope,focus,
      copy:'PermitPlate supervised free-trial research scope\n'+scope+'\n'+
        'Research focus: '+focus+'.\n'+
        'Starter brief and one weekly update. Up to five reviewed, source-linked signals per report.\n'+
        'Public records do not prove buying intent. A no-matches note does not start the 14-day clock.\n'+
        'One trial per business; maximum ten independently approved businesses; no card or automatic paid upgrade.'
    });
  }
  function onlineOrigin(location){return location&&location.origin===origin;}
  if(typeof module==='object'&&module.exports)
    module.exports={buildRequest,scopePreview,categories,territories,publicDomain,normalizeRequest,normalizeEmail,onlineOrigin};
  if(!root.document)return;
  const form=root.document.querySelector('[data-trial-request]');
  if(!form)return;
  const link=root.document.querySelector('[data-trial-email]');
  const status=root.document.querySelector('[data-trial-status]');
  const fallback=root.document.querySelector('[data-trial-fallback]');
  const body=root.document.querySelector('[data-trial-body]');
  const copy=root.document.querySelector('[data-trial-copy]');
  const success=root.document.querySelector('[data-trial-success]');
  const intro=root.document.querySelector('[data-trial-intro]');
  const legal=root.document.querySelector('[data-trial-legal]');
  const submit=form.querySelector?form.querySelector('button[type="submit"]'):null;
  const direct=onlineOrigin(root.location);
  const scopeCard=root.document.querySelector('[data-trial-scope]');
  const scopeSummary=root.document.querySelector('[data-trial-scope-summary]');
  const scopeFocus=root.document.querySelector('[data-trial-scope-focus]');
  const scopeCopy=root.document.querySelector('[data-trial-scope-copy]');
  const scopeCopyStatus=root.document.querySelector('[data-trial-scope-copy-status]');
  const categoryField=form.querySelector?form.querySelector('#trial-category'):null;
  const territoryField=form.querySelector?form.querySelector('#trial-territory'):null;
  let scopeRevision=0;
  function currentScope(){return categoryField&&territoryField?scopePreview(categoryField.value,territoryField.value):null;}
  function renderScope(){
    scopeRevision++;
    const plan=currentScope();
    if(scopeCopyStatus)scopeCopyStatus.textContent='';
    if(!scopeCard||!scopeSummary||!scopeFocus)return;
    scopeCard.hidden=!plan;
    if(!plan){scopeSummary.textContent='';scopeFocus.textContent='';return;}
    scopeSummary.textContent='Selected: '+plan.scope+'.';
    scopeFocus.textContent='We will examine '+plan.focus+' when the official source supports it. This is not a guarantee that matching projects exist.';
  }
  if(categoryField&&territoryField){
    for(const field of [categoryField,territoryField]){
      field.addEventListener('change',renderScope);
      field.addEventListener('input',renderScope);
    }
    renderScope();
  }
  if(scopeCopy&&scopeCopy.addEventListener){
    scopeCopy.addEventListener('click',async()=>{
      const plan=currentScope();if(!plan)return;
      const revision=scopeRevision;
      try{
        if(!root.navigator?.clipboard?.writeText)throw Error('COPY_UNAVAILABLE');
        await root.navigator.clipboard.writeText(plan.copy);
        if(scopeCopyStatus)scopeCopyStatus.textContent=revision===scopeRevision
          ?'Scope copied. This page did not send or enroll anyone.'
          :'Scope changed during copying. Review the new selection and copy again.';
      }catch{
        if(scopeCopyStatus)scopeCopyStatus.textContent='Copy unavailable. You can select the preview text to copy it manually. Nothing was sent.';
      }
    });
  }
  if(!direct){
    if(submit)submit.textContent='Prepare my free-trial request';
    if(intro)intro.textContent='To request a free trial here, prepare an email you can review and send. For an immediate on-screen request receipt, visit permitplate.retallyrecovery.com/trial.';
    if(legal)legal.textContent='This version prepares an email draft on your device. Nothing is submitted until you send it from your email app. No card or automatic paid upgrade.';
  }
  function resetDraft(){
    link.hidden=true;link.removeAttribute('href');status.textContent='';
    fallback.hidden=true;body.value='';
  }
  function offerEmail(request,message){
    link.href=request.mailto;
    link.hidden=false;
    body.value=request.body;
    fallback.hidden=false;
    status.textContent=message;
  }
  form.addEventListener('input',()=>{if(!form.hidden)resetDraft();});
  if(copy&&copy.addEventListener){
    copy.addEventListener('click',async()=>{
      if(!body.value)return;
      try{
        if(!root.navigator?.clipboard?.writeText)throw Error('COPY_UNAVAILABLE');
        await root.navigator.clipboard.writeText(body.value);
        status.textContent='Request text copied. Paste it into your email app, then press Send.';
      }catch{
        if(body.select)body.select();
        status.textContent='Select and copy the request text, then email jay@retallyrecovery.com.';
      }
    });
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    let values,request;
    try{
      values=Object.fromEntries(new FormData(form));
      request=buildRequest(values);
      normalizeRequest(values,true);
    }catch(error){
      status.textContent=error.message;resetDraft();status.textContent=error.message;return;
    }
    resetDraft();
    if(!direct){
      offerEmail(request,'Your draft is ready. Open your email app to review and send it. Your trial has not started.');
      return;
    }
    if(submit){submit.disabled=true;submit.textContent='Sending request…';}
    status.textContent='Sending securely. Your trial has not started.';
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),12000);
    Promise.resolve().then(async()=>{
      const response=await root.fetch('/api/trial-request',{
        method:'POST',mode:'same-origin',credentials:'omit',redirect:'error',
        cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(normalizeRequest(values,true)),signal:abort.signal
      });
      const data=await response.json();
      if(response.status!==202||data?.status!=='RECEIVED_FOR_REVIEW')throw Error('REQUEST_NOT_CONFIRMED');
      clearTimeout(timeout);
      if(success){success.hidden=false;success.querySelector('h3')?.focus();}
      form.hidden=true;
      resetDraft();
      status.textContent='Request received for personal review. Not enrolled, no charge, no trial clock started.';
    }).catch(()=>{
      clearTimeout(timeout);
      offerEmail(request,'We could not confirm an online receipt. Your trial has not started. You may send this email request instead; duplicate businesses are reviewed only once.');
    }).finally(()=>{
      if(submit){submit.disabled=false;submit.textContent='Send my free-trial request';}
    });
  });
})(typeof window==='undefined'?globalThis:window);
