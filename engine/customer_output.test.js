'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {selectForProfile,neutralize,toCsv,buildCustomerPackage}=require('./customer_output');

function row(id,overrides={}){
  return {
    'Lead Key':`sig:${id}`,'Venue Key':`${id} MAIN ST|10001`,'Best Name':`Business ${id}`,'Legal Name':`Legal ${id}`,
    'Address':`${id} Main St, New York, NY 10001`,'Borough':'Manhattan','ZIP':'10001','Phone':'2125550000',
    'Commercial Fit':'HIGH','Stage':'JUST FILED','Latest Signal Date':'2026-09-18','Purchase Window':'EARLY','Confidence':'MEDIUM',
    'Best Vendor Fit':'POS/payments','Best Score':80,'POS Score':80,'Insurance Score':75,'Equipment Score':60,'Hood/Fire Score':55,
    'Waste Score':60,'Pest Score':58,'Linen Score':50,'Distribution Score':62,'Source Count':1,'Sources':'DOHMH',
    'DOHMH CAMIS':`5000${id}`,'SLA Application ID':'','DOB Job Filing':'','Buildout Cost':'','Work Types':'',
    'Why Now':'Fresh source event','Watch Next':'Next official event','Evidence Summary':`Observed DOHMH 5000${id}`,
    ...overrides,
  };
}

test('General NYC ranks by Best Score and caps at 25',()=>{
  const rows=Array.from({length:30},(_,i)=>row(i,{ 'Best Score':100-i,'POS Score':100-i }));
  const selected=selectForProfile(rows,{Categories:'','Boroughs/Territory':'All NYC','Minimum Score':0});
  assert.equal(selected.length,25);
  assert.equal(selected[0]['Venue Key'],'0 MAIN ST|10001');
});

test('category profile filters on category score, not Best Score',()=>{
  const rows=[
    row(1,{'Borough':'Brooklyn','Best Score':99,'Equipment Score':64}),
    row(2,{'Borough':'Queens','Best Score':80,'Equipment Score':70}),
    row(3,{'Borough':'Manhattan','Best Score':100,'Equipment Score':100}),
  ];
  const selected=selectForProfile(rows,{Categories:'Equipment','Boroughs/Territory':'Brooklyn; Queens','Minimum Score':65});
  assert.deepEqual(selected.map(r=>r['Venue Key']),['2 MAIN ST|10001']);
  assert.equal(selected[0]._selection.score,70);
});

test('LOW EXCLUDE and SUPPRESSED never appear',()=>{
  const selected=selectForProfile([
    row(1,{'Commercial Fit':'LOW'}),
    row(2,{'Commercial Fit':'EXCLUDE'}),
    row(3,{'Purchase Window':'SUPPRESSED'}),
    row(4),
  ],{Categories:'','Boroughs/Territory':'All NYC','Minimum Score':0});
  assert.deepEqual(selected.map(r=>r['Venue Key']),['4 MAIN ST|10001']);
});

test('formula-leading strings are neutralized before CSV serialization',()=>{
  assert.equal(neutralize('=HYPERLINK("x")'),'\'=HYPERLINK("x")');
  assert.equal(neutralize('+SUM(1,1)'),"'+SUM(1,1)");
  assert.equal(neutralize('-10'),"'-10");
  assert.equal(neutralize('@cmd'),"'@cmd");
  assert.equal(neutralize('safe'),'safe');
  assert.equal(neutralize(42),42);
});

test('CSV quoting escapes commas quotes newlines and formula injection',()=>{
  const csv=toCsv([{
    'Signal Key':'sig1','Venue Key':'v1','Business':'=BAD','Legal Name':'A, Inc.','Address':'He said "Hi"\nFloor 1'
  }]);
  assert.match(csv,/\'=BAD/);
  assert.match(csv,/"A, Inc\."/);
  assert.match(csv,/"He said ""Hi""\nFloor 1"/);
  assert.ok(csv.startsWith('\uFEFF'));
});

test('customer package has exact email CSV row parity and official source URLs',()=>{
  const graph=[row(1)];
  const sourceEvents=[
    {'Venue Key':'1 MAIN ST|10001','Source URL':'https://data.cityofnewyork.us/source1'},
    {'Venue Key':'1 MAIN ST|10001','Source URL':'https://data.ny.gov/source2'},
  ];
  const p=buildCustomerPackage({graphRows:graph,profile:{Categories:'POS/payments',Boroughs:'All NYC','Minimum Score':60},sourceEvents,date:'2026-09-18'});
  assert.equal(p.emailRows.length,1);
  assert.equal(p.csvRows.length,1);
  assert.equal(p.emailRows[0].venueKey,p.csvRows[0]['Venue Key']);
  assert.equal(p.filename,'permitplate-nyc-2026-09-18.csv');
  assert.match(p.csvRows[0]['Source URLs'],/data\.cityofnewyork\.us/);
  assert.match(p.csvRows[0]['Source URLs'],/data\.ny\.gov/);
  assert.equal(p.csvRows[0]['Selected Category'],'POS/payments');
  assert.equal(p.csvRows[0]['Selected Score'],80);
});

test('five canonical shadow profiles produce deterministic category-specific selections',()=>{
  const graph=[
    row(1,{'Borough':'Manhattan','POS Score':90,'Best Score':90}),
    row(2,{'Borough':'Brooklyn','Equipment Score':80,'Best Vendor Fit':'Equipment','Best Score':80}),
    row(3,{'Borough':'Queens','Equipment Score':70,'Best Vendor Fit':'Equipment','Best Score':70}),
    row(4,{'Borough':'Brooklyn','Waste Score':75,'Best Vendor Fit':'Waste','Best Score':75}),
    row(5,{'Borough':'Bronx','Hood/Fire Score':72,'Best Vendor Fit':'Hood/Fire','Best Score':72}),
  ];
  const profiles=[
    {name:'General NYC',Categories:'','Boroughs/Territory':'All NYC','Minimum Score':0},
    {name:'Equipment BQ',Categories:'Equipment','Boroughs/Territory':'Brooklyn; Queens','Minimum Score':65},
    {name:'Waste Brooklyn',Categories:'Waste','Boroughs/Territory':'Brooklyn','Minimum Score':60},
    {name:'POS Manhattan',Categories:'POS/payments','Boroughs/Territory':'Manhattan','Minimum Score':60},
    {name:'Hood All',Categories:'Hood/Fire','Boroughs/Territory':'All NYC','Minimum Score':70},
  ];
  const out=profiles.map(p=>[p.name,selectForProfile(graph,p).map(r=>r['Venue Key'])]);
  assert.deepEqual(out[1][1],['2 MAIN ST|10001','3 MAIN ST|10001']);
  assert.ok(out[2][1].includes('4 MAIN ST|10001'));
  assert.ok(out[3][1].includes('1 MAIN ST|10001'));
  assert.ok(out[4][1].includes('5 MAIN ST|10001'));
});
