(function(){
  const sourceEl=document.querySelector('[data-source-freshness]');
  const buildEl=document.querySelector('[data-product-build]');
  const formatter=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'});

  if(sourceEl){
    fetch('https://data.cityofnewyork.us/api/views/43nn-pn8j',{headers:{Accept:'application/json'}})
      .then(r=>{if(!r.ok) throw new Error(); return r.json();})
      .then(meta=>{
        const raw=Number(meta.rowsUpdatedAt||0); if(!raw) throw new Error();
        sourceEl.textContent='Source updated '+formatter.format(new Date(raw*1000))+' · upstream metadata only; not a filing/opening or product-build date';
      })
      .catch(()=>{sourceEl.textContent='Source freshness unavailable · no product-build inference';});
  }

  if(buildEl){
    fetch('/build-info.json',{cache:'no-store'})
      .then(r=>{if(!r.ok) throw new Error(); return r.json();})
      .then(info=>{
        const commit=String(info.sourceCommit||'');
        const builtAt=new Date(info.builtAt||'');
        if(!/^[0-9a-f]{40}$/i.test(commit)||Number.isNaN(builtAt.getTime())) throw new Error();
        buildEl.textContent='Product build '+formatter.format(builtAt)+' · commit '+commit.slice(0,7);
      })
      .catch(()=>{buildEl.textContent='Product build identity unavailable · source freshness does not imply build freshness';});
  }
})();

(function(){
  const form=document.querySelector('form[name="permitplate-onboarding"]');
  if(!form) return;

  const submit=document.getElementById('checkout-submit');
  const status=document.getElementById('checkout-status');
  const activation=document.getElementById('activation_ref');
  const stripeBase='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';

  function makeActivationRef(){
    if(!window.crypto) return null;
    if(typeof window.crypto.randomUUID==='function'){
      return 'pp_'+window.crypto.randomUUID().replace(/-/g,'');
    }
    if(typeof window.crypto.getRandomValues==='function'){
      const bytes=new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return 'pp_'+Array.from(bytes)
        .map(function(b){return b.toString(16).padStart(2,'0');})
        .join('');
    }
    return null;
  }

  document.documentElement.classList.add('js-ready');

  form.addEventListener('submit',async function(event){
    event.preventDefault();
    if(!form.reportValidity()) return;

    const email=form.elements.email.value.trim().toLowerCase();
    const ref=makeActivationRef();
    if(!ref){
      status.textContent='Secure checkout could not initialize in this browser. No charge was started.';
      return;
    }

    activation.value=ref;
    submit.disabled=true;
    status.textContent='Saving your preferences…';

    try{
      const body=new URLSearchParams(new FormData(form));
      const response=await fetch('/',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:body.toString()
      });
      if(!response.ok) throw new Error('Preference save failed');

      const checkout=new URL(stripeBase);
      checkout.searchParams.set('locked_prefilled_email',email);
      checkout.searchParams.set('client_reference_id',ref);
      status.textContent='Preferences saved. Opening secure Stripe checkout…';
      window.location.assign(checkout.toString());
    }catch(error){
      activation.value='';
      submit.disabled=false;
      status.textContent='We could not safely save your preferences. Please try again; you have not been charged.';
    }
  });
})();
