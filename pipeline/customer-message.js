'use strict';

const crypto=require('crypto');
const eventTime=require('./event-time');

const CUSTOMER_MESSAGE_VERSION='PermitPlate-customer-message-v1.1.0';

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function text(value){ return value==null?'':String(value).trim(); }
function htmlEscape(value){
  return String(value==null?'':value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function sourceUrls(row){
  return String(row&&row['Source URLs']||'')
    .split('|')
    .map((value)=>value.trim())
    .filter((url)=>/^https:\/\//i.test(url));
}
function plural(n,singular,pluralValue){
  return Number(n)===1?singular:(pluralValue||singular+'s');
}
function reportDate(value){
  const raw=text(value);
  const ms=Date.parse(raw);
  if(Number.isFinite(ms)) return new Date(ms).toISOString().slice(0,10);
  return new Date().toISOString().slice(0,10);
}
function customerRows(artifact){
  if(!artifact||artifact.status!=='READY') throw new Error('READY subscriber artifact required');
  return Array.isArray(artifact.csvRows)?artifact.csvRows:[];
}
function chronologyLines(row){
  const bases={DOHMH_INSPECTION_DATE:'Health inspection',SLA_APPLICATION_RECEIVED_DATE:'Liquor application received',DOB_INITIAL_FILING_DATE:'Building job initially filed'};
  const date=eventTime.calendarDate(row['Business Event Date']);
  const basis=bases[row['Business Event Basis']];
  const lines=[row['Event Time Status']==='KNOWN'&&date&&basis?
    `${basis}: ${date}. This does not date a later status or scope change.`:
    'Business event date: not proven by the available record.'];
  const detected=eventTime.instant(row['Detected At']);
  if(detected) lines.push(`PermitPlate detected: ${detected} (not a filing date).`);
  return lines;
}
function renderTextRow(row,index){
  const lines=[
    `${index+1}. ${text(row.Business)||'Unnamed business'} — ${text(row.Address)||'Address unavailable'}`,
    `   Stage: ${eventTime.customerStage(row.Stage)||'—'}`,
    `   Fit: ${text(row['Commercial Fit'])||'—'}`,
    `   ${text(row['Selected Category'])||'Category'} score: ${row['Selected Score']??'—'}`
  ];
  lines.push(...chronologyLines(row).map(line=>'   '+line));
  const tags=text(row['Evidence Tags']);
  if(tags) lines.push(`   Evidence: ${tags}`);
  const urls=sourceUrls(row);
  if(urls.length) lines.push(`   Sources: ${urls.join(' | ')}`);
  return lines.join('\n');
}
function renderHtmlRow(row,index){
  const urls=sourceUrls(row);
  const sourceHtml=urls.length?
    '<div style="margin-top:6px;font-size:13px">Sources: '+
      urls.map((url,i)=>`<a href="${htmlEscape(url)}">source ${i+1}</a>`).join(' · ')+
    '</div>':'';
  const tags=text(row['Evidence Tags']);
  return [
    '<div style="padding:14px 0;border-bottom:1px solid #e6e6e6">',
    `<div style="font-weight:700">${index+1}. ${htmlEscape(text(row.Business)||'Unnamed business')}</div>`,
    `<div>${htmlEscape(text(row.Address)||'Address unavailable')}</div>`,
    '<div style="margin-top:6px;font-size:14px">',
    `Stage: ${htmlEscape(eventTime.customerStage(row.Stage)||'—')} · `,
    `Fit: ${htmlEscape(text(row['Commercial Fit'])||'—')} · `,
    `${htmlEscape(text(row['Selected Category'])||'Category')} score: ${htmlEscape(row['Selected Score']??'—')}`,
    '</div>',
    `<div style="margin-top:6px;font-size:13px">${chronologyLines(row).map(htmlEscape).join('<br>')}</div>`,
    tags?`<div style="margin-top:6px;font-size:13px">Evidence: ${htmlEscape(tags)}</div>`:'',
    sourceHtml,
    '</div>'
  ].join('');
}
function renderCustomerMessage(input){
  const data=input||{};
  const artifact=data.artifact;
  const rows=customerRows(artifact);
  const date=reportDate(data.reportDate);
  if(rows.length===0){
    return {
      messageVersion:CUSTOMER_MESSAGE_VERSION,
      status:'NO_SEND',
      reason:'NO_QUALIFYING_SIGNALS',
      subject:null,
      text:null,
      html:null,
      attachment:null,
      signalKeys:[],
      messageFingerprint:sha256(stableStringify({
        version:CUSTOMER_MESSAGE_VERSION,
        status:'NO_SEND',
        artifactFingerprint:artifact.artifactFingerprint||null
      }))
    };
  }

  const normal=rows.filter((row)=>text(row['Delivery Class']).toUpperCase()==='NORMAL');
  const starter=rows.filter((row)=>text(row['Delivery Class']).toUpperCase()==='STARTER');
  const subject=`PermitPlate NYC — ${rows.length} ${plural(rows.length,'opportunity','opportunities')} — ${date}`;

  const textParts=[
    'PermitPlate NYC',
    `${rows.length} qualifying ${plural(rows.length,'opportunity','opportunities')} for your profile.`
  ];
  if(normal.length){
    textParts.push('',`NEW / CHANGED SINCE YOUR BASELINE (${normal.length})`);
    normal.forEach((row,index)=>textParts.push(renderTextRow(row,index)));
  }
  if(starter.length){
    textParts.push('',
      `STARTER SNAPSHOT — detected before signup, within your selected window (${starter.length})`,
      'Starter items are labeled separately and are not presented as post-signup changes.'
    );
    starter.forEach((row,index)=>textParts.push(renderTextRow(row,index)));
  }
  textParts.push('','The attached CSV contains the same opportunities in the same order.');

  const htmlParts=[
    '<div style="font-family:Arial,sans-serif;max-width:720px;line-height:1.45;color:#1a1a1a">',
    '<h2 style="margin-bottom:4px">PermitPlate NYC</h2>',
    `<div style="margin-bottom:18px">${rows.length} qualifying ${plural(rows.length,'opportunity','opportunities')} for your profile.</div>`
  ];
  if(normal.length){
    htmlParts.push(`<h3>New / changed since your baseline (${normal.length})</h3>`);
    normal.forEach((row,index)=>htmlParts.push(renderHtmlRow(row,index)));
  }
  if(starter.length){
    htmlParts.push(
      `<h3 style="margin-top:24px">Starter Snapshot (${starter.length})</h3>`,
      '<div style="font-size:13px;margin-bottom:8px">Detected before signup, within your selected Starter window. These are not presented as post-signup changes.</div>'
    );
    starter.forEach((row,index)=>htmlParts.push(renderHtmlRow(row,index)));
  }
  htmlParts.push(
    '<div style="margin-top:20px;font-size:13px">The attached CSV contains the same opportunities in the same order.</div>',
    '</div>'
  );

  const signalKeys=rows.map((row)=>text(row['Signal Key']));
  const messageCore={
    version:CUSTOMER_MESSAGE_VERSION,
    artifactFingerprint:artifact.artifactFingerprint,
    subject,
    signalKeys,
    text:textParts.join('\n'),
    html:htmlParts.join('')
  };
  const messageFingerprint=sha256(stableStringify(messageCore));
  return {
    messageVersion:CUSTOMER_MESSAGE_VERSION,
    status:'READY',
    reason:null,
    subject,
    text:messageCore.text,
    html:messageCore.html,
    signalKeys,
    normalCount:normal.length,
    starterCount:starter.length,
    attachment:{
      filename:artifact.filename,
      mimeType:'text/csv; charset=utf-8',
      content:artifact.csv,
      sha256:sha256(artifact.csv)
    },
    artifactFingerprint:artifact.artifactFingerprint,
    messageFingerprint
  };
}

module.exports={
  CUSTOMER_MESSAGE_VERSION,
  stableStringify,
  sha256,
  text,
  htmlEscape,
  sourceUrls,
  plural,
  reportDate,
  customerRows,
  chronologyLines,
  renderTextRow,
  renderHtmlRow,
  renderCustomerMessage
};
