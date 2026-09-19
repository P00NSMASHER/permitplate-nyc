(function(){
  const el=document.querySelector('[data-source-freshness]');
  if(!el) return;
  fetch('https://data.cityofnewyork.us/api/views/43nn-pn8j',{headers:{Accept:'application/json'}})
    .then(r=>{if(!r.ok) throw new Error(); return r.json();})
    .then(meta=>{
      const raw=Number(meta.rowsUpdatedAt||0); if(!raw) throw new Error();
      const d=new Date(raw*1000);
      el.textContent='DOHMH source last updated '+new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(d);
    })
    .catch(()=>{el.textContent='source freshness checked during processing';});
})();