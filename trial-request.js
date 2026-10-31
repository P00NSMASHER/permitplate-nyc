(function(root){
  'use strict';
  const categories=['pos','insurance','equipment','hoodfire','waste','pest','linen','distribution'];
  const territories=['AllNYC','Manhattan','Brooklyn','Queens','Bronx','StatenIsland',
    'ManhattanBrooklyn','ManhattanQueens','BrooklynQueens','ManhattanBronx',
    'ManhattanBrooklynQueens','BrooklynStatenIsland'];
  const origin='https://permitplate.retallyrecovery.com';
  // Category-specific research prompts are examples, NOT live-lead assertions.
  const categoryLens=Object.freeze({
    equipment:['Kitchen equipment','Look for public restaurant-project activity where equipment outreach may be worth investigating.'],
    hoodfire:['Hood and fire','Look for restaurant project and permitting context relevant to fire or ventilation suppliers.'],
    pos:['POS and payments','Look for public operating and project signals that may warrant a POS conversation.'],
    insurance:['Insurance','Look for public activity that may warrant an independent coverage conversation.'],
    waste:['Waste','Look for publicly recorded restaurant activity that could warrant waste-service outreach.'],
    pest:['Pest control','Look for public restaurant activity that could warrant pest-service outreach.'],
    linen:['Linen','Look for public restaurant activity that could warrant a linen-service conversation.'],
    distribution:['Food distribution','Look for public restaurant activity where distribution outreach may be worth investigating.']
  });
  const territoryNames=Object.freeze({
    AllNYC:'All NYC',Manhattan:'Manhattan',Brooklyn:'Brooklyn',Queens:'Queens',
    Bronx:'Bronx',StatenIsland:'Staten Island',
    ManhattanBrooklyn:'Manhattan and Brooklyn',ManhattanQueens:'Manhattan and Queens',
    BrooklynQueens:'Brooklyn and Queens',ManhattanBronx:'Manhattan and Bronx',
    ManhattanBrooklynQueens:'Manhattan, Brooklyn and Queens',
    BrooklynStatenIsland:'Brooklyn and Staten Island'
  });
  function scopePreview(input){
    if(!input||!categories.includes(input.category)||!territories.includes(input.territory))return null;
    const lens=categoryLens[input.category];
    return Object.freeze({category:input.category,territory:input.territory,
      categoryLabel:lens[0],territoryLabel:territoryNames[input.territory],
      focus:lens[1],maxSignalsPerReport:5,trialDays:14,
      reports:['Starter brief','One weekly update'],automaticPaidUpgrade:false});
  }
  function buildScopeSummary(input){
    const p=scopePreview(input);
    if(!p)return null;
    return [
      'PermitPlate 3.0 — draft trial research plan (not a submitted request)',
      'Vendor category: '+p.categoryLabel,
      'NYC territory: '+p.territoryLabel,
      'Research lens: '+p.focus,
      'Included: starter research brief and one weekly update, up to five source-linked reviewed signals per report.',
      'Trial clock: 14 days starting only after the first useful report is successfully sent.',
      'Zero matches: reported honestly; a no-matches note does not start the trial clock.',
      'Public records do not establish buying intent, customer demand, or guaranteed leads.',
      'No card, no automatic upgrade, no reservation or enrollment from this preview.'
    ].join('\n');
  }
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
    // Keep the public page path for founder review (shared hosts distinguish businesses
    // by path). Strip query/fragment and retain hostname-only duplicate checks server-side.
    const websitePath=website.origin+(website.pathname==='/'?'':website.pathname);
    if(websitePath.length>700)throw Error('Use a shorter public business website URL.');
    return {businessName:name,website:websitePath,
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
  function onlineOrigin(location){return location&&location.origin===origin;}
  if(typeof module==='object'&&module.exports)
    module.exports={buildRequest,scopePreview,buildScopeSummary,categories,territories,publicDomain,normalizeRequest,normalizeEmail,onlineOrigin};
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
  const preview=root.document.querySelector('[data-trial-preview]');
  const categoryField=root.document.querySelector('#trial-category');
  const territoryField=root.document.querySelector('#trial-territory');
  const previewSummary=root.document.querySelector('[data-trial-preview-summary]');
  const previewFocus=root.document.querySelector('[data-trial-preview-focus]');
  const previewTerritory=root.document.querySelector('[data-trial-preview-territory]');
  const previewCopy=root.document.querySelector('[data-trial-preview-copy]');
  const previewStatus=root.document.querySelector('[data-trial-preview-status]');
  const previewFallback=root.document.querySelector('[data-trial-preview-fallback]');
  const previewPlain=root.document.querySelector('[data-trial-preview-plain]');
  let scopeRevision=0;
  function refreshScope(){
    if(!preview||!categoryField||!territoryField||!previewCopy)return;
    scopeRevision+=1;
    const value=scopePreview({category:categoryField.value,territory:territoryField.value});
    preview.hidden=false;
    if(previewFallback)previewFallback.hidden=true;
    if(previewPlain)previewPlain.value='';
    if(previewStatus)previewStatus.textContent='';
    previewCopy.disabled=!value;
    if(previewSummary)previewSummary.textContent=value
      ?'Draft scope: '+value.categoryLabel+' in '+value.territoryLabel+'.'
      :'Choose both a vendor category and NYC territory above to preview your scope.';
    if(previewFocus)previewFocus.textContent=value?value.focus:'Select a vendor category';
    if(previewTerritory)previewTerritory.textContent=value?value.territoryLabel:'Select an NYC territory';
  }
  refreshScope();
  form.addEventListener('change',refreshScope);
  if(previewCopy)previewCopy.addEventListener('click',async()=>{
    const plain=buildScopeSummary({category:categoryField?.value,territory:territoryField?.value});
    if(!plain)return;
    const revision=scopeRevision;
    const stillCurrent=()=>revision===scopeRevision;
    try{
      if(!root.navigator?.clipboard?.writeText)throw Error('COPY_UNAVAILABLE');
      await root.navigator.clipboard.writeText(plain);
      if(!stillCurrent()){if(previewStatus)previewStatus.textContent='Scope changed while copying; copy the new plan.';return;}
      if(previewFallback)previewFallback.hidden=true;
      if(previewStatus)previewStatus.textContent='Scope copied locally. This does not submit or reserve a trial.';
    }catch{
      if(!stillCurrent()){if(previewStatus)previewStatus.textContent='Scope changed while copying; copy again.';return;}
      if(previewPlain){previewPlain.value=plain;previewFallback.hidden=false;previewPlain.select();}
      if(previewStatus)previewStatus.textContent='Clipboard unavailable. Select the complete plan below and copy it manually. Nothing was submitted.';
    }
  });
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
  form.addEventListener('input',()=>{if(!form.hidden)resetDraft();refreshScope();});
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
