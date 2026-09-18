(function(){
  const el=document.querySelector('[data-source-freshness]');
  if(!el) return;
  const endpoint='https://data.cityofnewyork.us/api/views/43nn-pn8j';
  fetch(endpoint,{headers:{'Accept':'application/json'}})
    .then(r=>{if(!r.ok) throw new Error('source status unavailable'); return r.json();})
    .then(meta=>{
      const raw=Number(meta.rowsUpdatedAt||0);
      if(!raw) throw new Error('no timestamp');
      const d=new Date(raw*1000);
      const text=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(d);
      el.textContent='NYC source last updated '+text;
      el.dataset.state='ok';
    })
    .catch(()=>{el.textContent='NYC Open Data source checked during daily processing';});
})();
