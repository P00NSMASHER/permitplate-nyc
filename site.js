(function(){
  'use strict';

  const toggle=document.querySelector('[data-menu-toggle]');
  const menu=document.querySelector('[data-menu]');
  if(toggle&&menu){
    const close=()=>{
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded','false');
    };
    toggle.addEventListener('click',()=>{
      const open=menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded',String(open));
    });
    menu.addEventListener('click',(event)=>{
      if(event.target.closest('a')) close();
    });
    document.addEventListener('keydown',(event)=>{
      if(event.key==='Escape') close();
    });
  }

  const sourceEl=document.querySelector('[data-source-freshness]');
  const buildEl=document.querySelector('[data-product-build]');
  const formatter=new Intl.DateTimeFormat('en-US',{
    month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',
    timeZone:'America/New_York',timeZoneName:'short'
  });

  if(sourceEl){
    fetch('https://data.cityofnewyork.us/api/views/43nn-pn8j',{
      headers:{Accept:'application/json'}
    })
      .then((response)=>{
        if(!response.ok) throw new Error('SOURCE_METADATA_UNAVAILABLE');
        return response.json();
      })
      .then((metadata)=>{
        const raw=Number(metadata.rowsUpdatedAt||0);
        if(!raw) throw new Error('SOURCE_TIMESTAMP_UNAVAILABLE');
        sourceEl.textContent='DOHMH source metadata: '+formatter.format(new Date(raw*1000))+
          ' · upstream metadata only, not a filing or opening date';
      })
      .catch(()=>{
        sourceEl.textContent='DOHMH source metadata unavailable · no freshness inference';
      });
  }

  if(buildEl){
    fetch('/permitplate-nyc/build-info.json',{cache:'no-store'})
      .then((response)=>{
        if(!response.ok) throw new Error('BUILD_IDENTITY_UNAVAILABLE');
        return response.json();
      })
      .then((info)=>{
        const commit=String(info.sourceCommit||'');
        const builtAt=new Date(info.builtAt||'');
        if(!/^[0-9a-f]{40}$/i.test(commit)||Number.isNaN(builtAt.getTime())){
          throw new Error('BUILD_IDENTITY_INVALID');
        }
        buildEl.textContent='Site built '+formatter.format(builtAt)+' · commit '+commit.slice(0,7);
      })
      .catch(()=>{
        buildEl.textContent='Public build identity unavailable · source freshness does not imply site freshness';
      });
  }
})();
