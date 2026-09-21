'use strict';

const assert=require('assert');
const m=require('./customer-message');

function artifact(rows){
  return {
    status:'READY',
    artifactFingerprint:'artifact-fp-1',
    filename:'permitplate-nyc-2026-09-21.csv',
    csv:'\uFEFFSignal Key,Business\r\n'+
      rows.map((row)=>row['Signal Key']+','+row.Business).join('\r\n')+'\r\n',
    csvRows:rows
  };
}
const rows=[
  {
    'Signal Key':'normal:sub:event-1',
    'Delivery Class':'NORMAL',
    Business:'Canary Pizza <Test>',
    Address:'10 Main St',
    Stage:'JUST FILED',
    'Commercial Fit':'HIGH',
    'Selected Category':'Equipment',
    'Selected Score':82,
    'Evidence Tags':'EQUIPMENT; HOOD_FIRE',
    'Source URLs':'https://data.cityofnewyork.us/a | http://unsafe.example/x'
  },
  {
    'Signal Key':'starter:sub:base:event-2',
    'Delivery Class':'STARTER',
    Business:'Starter Cafe',
    Address:'20 Main St',
    Stage:'BUILDOUT / LICENSING',
    'Commercial Fit':'HIGH',
    'Selected Category':'POS',
    'Selected Score':75,
    'Evidence Tags':'',
    'Source URLs':'https://data.ny.gov/b'
  }
];

{
  const out=m.renderCustomerMessage({artifact:artifact(rows),reportDate:'2026-09-21'});
  assert.equal(out.status,'READY');
  assert.equal(out.normalCount,1);
  assert.equal(out.starterCount,1);
  assert.equal(out.subject,'PermitPlate NYC — 2 opportunities — 2026-09-21');
  assert.deepEqual(out.signalKeys,['normal:sub:event-1','starter:sub:base:event-2']);
  assert(out.text.includes('NEW / CHANGED SINCE YOUR BASELINE (1)'));
  assert(out.text.includes('STARTER SNAPSHOT'));
  assert(out.text.includes('https://data.cityofnewyork.us/a'));
  assert(!out.text.includes('http://unsafe.example/x'));
  assert(out.html.includes('Canary Pizza &lt;Test&gt;'));
  assert(!out.html.includes('Canary Pizza <Test>'));
  assert(out.html.includes('href="https://data.cityofnewyork.us/a"'));
  assert(!out.html.includes('unsafe.example'));
  assert.equal(out.attachment.filename,'permitplate-nyc-2026-09-21.csv');
  assert.equal(out.attachment.mimeType,'text/csv; charset=utf-8');
  assert.equal(out.attachment.content,artifact(rows).csv);
  assert.match(out.attachment.sha256,/^[0-9a-f]{64}$/);
  assert.match(out.messageFingerprint,/^[0-9a-f]{64}$/);
}

{
  const out=m.renderCustomerMessage({
    artifact:artifact([rows[0]]),
    reportDate:'2026-09-21'
  });
  assert.equal(out.subject,'PermitPlate NYC — 1 opportunity — 2026-09-21');
  assert.equal(out.normalCount,1);
  assert.equal(out.starterCount,0);
  assert(!out.text.includes('STARTER SNAPSHOT'));
}

{
  const out=m.renderCustomerMessage({
    artifact:{
      status:'READY',
      artifactFingerprint:'empty-fp',
      filename:'empty.csv',
      csv:'\uFEFF',
      csvRows:[]
    },
    reportDate:'2026-09-21'
  });
  assert.equal(out.status,'NO_SEND');
  assert.equal(out.reason,'NO_QUALIFYING_SIGNALS');
  assert.equal(out.subject,null);
  assert.equal(out.attachment,null);
  assert.deepEqual(out.signalKeys,[]);
}

{
  const a=m.renderCustomerMessage({artifact:artifact(rows),reportDate:'2026-09-21'});
  const b=m.renderCustomerMessage({
    artifact:JSON.parse(JSON.stringify(artifact(rows))),
    reportDate:'2026-09-21'
  });
  assert.equal(a.messageFingerprint,b.messageFingerprint);
  assert.equal(a.attachment.sha256,b.attachment.sha256);
  assert.equal(a.html,b.html);
  assert.equal(a.text,b.text);
}

{
  assert.equal(m.htmlEscape('<script>"x"&\'y\'</script>'),'&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  assert.deepEqual(
    m.sourceUrls({'Source URLs':'javascript:alert(1) | https://safe.example/x | data:text/plain,x'}),
    ['https://safe.example/x']
  );
}

assert.throws(
  ()=>m.renderCustomerMessage({artifact:{status:'REVIEW'}}),
  /READY subscriber artifact required/
);

console.log('PermitPlate customer digest renderer tests passed.');
