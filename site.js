(function(){
  'use strict';

  const toggle=document.querySelector('[data-menu-toggle]');
  const menu=document.querySelector('[data-menu]');
  if(toggle&&menu){
    const close=(restoreFocus=false)=>{
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded','false');
      if(restoreFocus)toggle.focus();
    };
    toggle.addEventListener('click',()=>{
      const open=menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded',String(open));
    });
    menu.addEventListener('click',(event)=>{
      if(event.target.closest('a'))close();
    });
    document.addEventListener('keydown',(event)=>{
      if(event.key==='Escape'&&menu.classList.contains('open'))close(true);
    });
    document.addEventListener('click',(event)=>{
      if(menu.classList.contains('open')&&!menu.contains(event.target)&&
         !toggle.contains(event.target))close();
    });
  }

  // Every description below is a fictional educational scenario. This is not
  // a prediction engine, a production lead, or independently adjudicated proof.
  // Use textContent to keep display data out of the HTML interpreter.
  const demoSelect=document.querySelector('[data-demo-select]');
  const demoHeading=document.querySelector('[data-demo-heading]');
  const demoRelevance=document.querySelector('[data-demo-relevance]');
  const demoVerification=document.querySelector('[data-demo-verification]');
  const examples=Object.freeze({
    equipment:{
      heading:'Kitchen-equipment context',
      relevance:'An interior-renovation filing might justify investigating commercial equipment work. It never proves an order or who will purchase.',
      verify:'Read the complete scope, project status, and the actual restaurant-operator identity before any outreach.'
    },
    pos:{
      heading:'POS & payments context',
      relevance:'A possible restaurant buildout can prompt further research into operational setup. No filing proves a POS decision or contract.',
      verify:'Confirm the business identity, timing and whether any current operating location or existing system is relevant.'
    },
    insurance:{
      heading:'Coverage-review context',
      relevance:'Construction-related activity may raise questions about insurance needs, but the public record says nothing about coverage decisions.',
      verify:'Check the exact operator, property, construction stage and any publicly documented use before drawing conclusions.'
    },
    hoodfire:{
      heading:'Ventilation and life-safety context',
      relevance:'Mechanical or kitchen scope can be relevant to a hood/fire provider, but a generic renovation is not evidence of a system purchase.',
      verify:'Check the complete scope for actual ventilation or suppression work and confirm who controls the project.'
    },
    waste:{
      heading:'Waste-service context',
      relevance:'Building work or operations activity may make a location worth researching. It does not establish a hauling requirement.',
      verify:'Distinguish active operation from renovation and confirm the real operator and site.'
    },
    pest:{
      heading:'Pest-prevention context',
      relevance:'Restaurant activity can provide a research starting point for service vendors, but inspection records are not sales leads.',
      verify:'Look up the current restaurant record and do not infer a procurement need from an inspection or dataset update.'
    },
    linen:{
      heading:'Linen and laundry context',
      relevance:'Restaurant activity may warrant vendor research, without proving launch timing or whether linen services are needed.',
      verify:'Confirm that the venue is operating or preparing to operate and that the identified business is current.'
    },
    distribution:{
      heading:'Food-distribution context',
      relevance:'A possible restaurant project is a reason to investigate, not evidence of food purchasing or projected sales.',
      verify:'Independently verify operator identity, business stage and the current official source record.'
    }
  });
  if(demoSelect&&demoHeading&&demoRelevance&&demoVerification){
    const render=()=>{
      const choice=examples[demoSelect.value];
      if(!choice)return;
      demoHeading.textContent=choice.heading;
      demoRelevance.textContent=choice.relevance;
      demoVerification.textContent=choice.verify;
    };
    demoSelect.addEventListener('change',render);
    render();
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
        if(!response.ok)throw new Error('SOURCE_METADATA_UNAVAILABLE');
        return response.json();
      })
      .then((metadata)=>{
        const raw=Number(metadata.rowsUpdatedAt||0);
        if(!raw)throw new Error('SOURCE_TIMESTAMP_UNAVAILABLE');
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
        if(!response.ok)throw new Error('BUILD_IDENTITY_UNAVAILABLE');
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
