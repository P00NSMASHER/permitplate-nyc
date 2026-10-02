'use strict';

const CATEGORY_SCORE={
  'POS/payments':'POS Score',
  'POS':'POS Score',
  'Insurance':'Insurance Score',
  'Equipment':'Equipment Score',
  'Hood/Fire':'Hood/Fire Score',
  'Waste':'Waste Score',
  'Pest':'Pest Score',
  'Linen':'Linen Score',
  'Distribution':'Distribution Score',
};
const CATEGORY_ORDER=['POS/payments','Insurance','Equipment','Hood/Fire','Waste','Pest','Linen','Distribution'];

const CSV_HEADERS=[
  'Signal Key','Venue Key','Business','Legal Name','Address','Borough','ZIP','Phone',
  'Commercial Fit','Stage','Purchase Window','Confidence','Selected Category','Selected Score',
  'POS Score','Insurance Score','Equipment Score','Hood/Fire Score','Waste Score','Pest Score','Linen Score','Distribution Score',
  'Source Count','Sources','DOHMH CAMIS','SLA Application ID','DOB Job Filing','Buildout Cost','Work Types',
  'Why Now','Watch Next','Evidence Summary','Source URLs'
];

function blank(v){ return v===null||v===undefined||String(v).trim()===''; }
function parts(value){
  if(Array.isArray(value)) return value.map(String).map(x=>x.trim()).filter(Boolean);
  return String(value??'').split(/[;,]/).map(x=>x.trim()).filter(Boolean);
}
function canonicalCategory(value){
  const v=String(value||'').trim();
  const hit=Object.keys(CATEGORY_SCORE).find(k=>k.toLowerCase()===v.toLowerCase());
  return hit==='POS'?'POS/payments':hit||null;
}
function profileCategories(profile){
  return parts(profile.Categories??profile.categories).map(canonicalCategory).filter(Boolean);
}
function profileBoroughs(profile){
  return parts(profile['Boroughs/Territory']??profile.boroughs).map(x=>x.toUpperCase());
}

function selectedCategoryAndScore(row,profile){
  const cats=profileCategories(profile);
  if(!cats.length){
    const best=canonicalCategory(row['Best Vendor Fit'])||String(row['Best Vendor Fit']||'');
    return {category:best,score:Number(row['Best Score'])};
  }
  const candidates=cats.map(category=>({category,score:Number(row[CATEGORY_SCORE[category]])}))
    .filter(x=>Number.isFinite(x.score));
  if(!candidates.length) return {category:null,score:NaN};
  candidates.sort((a,b)=>b.score-a.score||CATEGORY_ORDER.indexOf(a.category)-CATEGORY_ORDER.indexOf(b.category));
  return candidates[0];
}

function profileMatch(row,profile){
  const fit=String(row['Commercial Fit']||'').toUpperCase();
  if(!['HIGH','MEDIUM'].includes(fit)) return false;
  if(String(row['Purchase Window']||'').toUpperCase()==='SUPPRESSED') return false;

  const boroughs=profileBoroughs(profile);
  if(boroughs.length && !boroughs.includes('ALL NYC') && !boroughs.includes(String(row.Borough||'').toUpperCase())) return false;

  const selected=selectedCategoryAndScore(row,profile);
  if(!selected.category||!Number.isFinite(selected.score)) return false;
  const min=Number(profile['Minimum Score']??profile.minScore??0);
  if(!Number.isFinite(min)||min<0||min>100) throw new Error('Minimum Score must be 0..100');
  return selected.score>=min;
}

function selectForProfile(rows,profile,{maxSignals=25}={}){
  if(!Number.isInteger(maxSignals)||maxSignals<0||maxSignals>25) throw new Error('maxSignals must be 0..25');
  return (rows||[])
    .filter(row=>profileMatch(row,profile))
    .map(row=>({...row,_selection:selectedCategoryAndScore(row,profile)}))
    .sort((a,b)=>
      b._selection.score-a._selection.score ||
      String(b['Latest Signal Date']||'').localeCompare(String(a['Latest Signal Date']||'')) ||
      String(a['Venue Key']||'').localeCompare(String(b['Venue Key']||''))
    )
    .slice(0,maxSignals);
}

function urlsForVenue(venueKey,sourceEvents){
  return [...new Set((sourceEvents||[])
    .filter(e=>String(e['Venue Key']||'')===String(venueKey))
    .map(e=>String(e['Source URL']||'').trim())
    .filter(Boolean))].sort();
}

function customerRow(row,profile,sourceEvents){
  const selected=row._selection||selectedCategoryAndScore(row,profile);
  return {
    'Signal Key':String(row['Lead Key']||row.signalKey||row['Venue Key']||''),
    'Venue Key':row['Venue Key']??'',
    'Business':row['Best Name']??row.Business??'',
    'Legal Name':row['Legal Name']??'',
    'Address':row.Address??'',
    'Borough':row.Borough??'',
    'ZIP':row.ZIP??'',
    'Phone':row.Phone??'',
    'Commercial Fit':row['Commercial Fit']??'',
    'Stage':row.Stage??'',
    'Purchase Window':row['Purchase Window']??'',
    'Confidence':row.Confidence??'',
    'Selected Category':selected.category??'',
    'Selected Score':selected.score,
    'POS Score':row['POS Score'],
    'Insurance Score':row['Insurance Score'],
    'Equipment Score':row['Equipment Score'],
    'Hood/Fire Score':row['Hood/Fire Score'],
    'Waste Score':row['Waste Score'],
    'Pest Score':row['Pest Score'],
    'Linen Score':row['Linen Score'],
    'Distribution Score':row['Distribution Score'],
    'Source Count':row['Source Count'],
    'Sources':row.Sources??'',
    'DOHMH CAMIS':row['DOHMH CAMIS']??'',
    'SLA Application ID':row['SLA Application ID']??'',
    'DOB Job Filing':row['DOB Job Filing']??'',
    'Buildout Cost':row['Buildout Cost']??'',
    'Work Types':row['Work Types']??'',
    'Why Now':row['Why Now']??'',
    'Watch Next':row['Watch Next']??'',
    'Evidence Summary':row['Evidence Summary']??'',
    'Source URLs':urlsForVenue(row['Venue Key'],sourceEvents).join(' | '),
  };
}

function neutralize(value){
  if(typeof value!=='string') return value;
  return /^[=+\-@]/.test(value)?"'"+value:value;
}
function escapeCsv(value){
  let v=neutralize(value);
  if(v===null||v===undefined) v='';
  v=String(v);
  if(/[",\r\n]/.test(v)) return '"'+v.replace(/"/g,'""')+'"';
  return v;
}
function toCsv(rows){
  const lines=[CSV_HEADERS.map(escapeCsv).join(',')];
  for(const row of rows) lines.push(CSV_HEADERS.map(h=>escapeCsv(row[h])).join(','));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}

function renderEmailRows(rows){
  return rows.map(r=>({
    signalKey:r['Signal Key'],
    venueKey:r['Venue Key'],
    headline:`${r.Business} — ${r.Address}`,
    categoryScore:`${r['Selected Category']} ${r['Selected Score']}`,
    fit:r['Commercial Fit'],stage:r.Stage,
    whyNow:r['Why Now'],purchaseWindow:r['Purchase Window'],confidence:r.Confidence,
    evidence:r['Evidence Summary'],watchNext:r['Watch Next'],sourceUrls:r['Source URLs'],
    phone:r.Phone,
  }));
}

function buildCustomerPackage({graphRows,profile,sourceEvents=[],date='1970-01-01'}){
  const selected=selectForProfile(graphRows,profile,{maxSignals:25});
  const csvRows=selected.map(row=>customerRow(row,profile,sourceEvents));
  const emailRows=renderEmailRows(csvRows);
  const emailKeys=emailRows.map(r=>r.venueKey);
  const csvKeys=csvRows.map(r=>r['Venue Key']);
  if(JSON.stringify(emailKeys)!==JSON.stringify(csvKeys)) throw new Error('EMAIL_CSV_ROW_PARITY_FAIL');
  return {
    selected,
    emailRows,csvRows,
    csv:toCsv(csvRows),
    filename:`permitplate-nyc-${date}.csv`,
  };
}

module.exports={
  CATEGORY_SCORE,CSV_HEADERS,profileMatch,selectedCategoryAndScore,selectForProfile,
  customerRow,neutralize,escapeCsv,toCsv,buildCustomerPackage
};
