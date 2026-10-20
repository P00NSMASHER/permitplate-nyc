'use strict';
// Optional read-only independent delivery confirmation for Resend.
// Requires a separate provider API key at execution time. No sending.
const core=require('./pa-permit-orders');
const state=require('./pa-permit-fulfillment');
async function readProvider(messageId,key,fetchImpl=fetch){
  if(!/^[0-9a-fA-F-]{30,40}$/.test(messageId||'')){
    throw Error('PA_PROVIDER_MESSAGE_ID_INVALID');
  }
  if(typeof key!=='string'||key.length<18||!key.startsWith('re_')){
    throw Error('PA_DELIVERY_PROVIDER_READ_KEY_REQUIRED');
  }
  let resp;
  try{
    resp=await fetchImpl('https://api.resend.com/emails/'+encodeURIComponent(messageId),{
      method:'GET',headers:{Authorization:'Bearer '+key},
      redirect:'error',signal:AbortSignal.timeout(15000)
    });
  }catch{throw Error('PA_DELIVERY_PROVIDER_TRANSPORT_FAILURE')}
  if(!resp?.ok)throw Error('PA_DELIVERY_PROVIDER_HTTP_FAILURE');
  try{
    const body=await resp.json();
    if(!body||Array.isArray(body)||typeof body!=='object'){
      throw Error('PA_DELIVERY_PROVIDER_INVALID_RESPONSE');
    }
    return body;
  }catch{throw Error('PA_DELIVERY_PROVIDER_INVALID_RESPONSE')}
}
async function verify(input){
  const data=input||{},order=data.ledger?.orders?.[data.sessionId];
  if(!order||order.phase!=='PROVIDER_DELIVERY_PENDING'){
    throw Error('PA_DELIVERY_NOT_WAITING_FOR_PROVIDER');
  }
  const response=await readProvider(order.delivery.messageId,data.key,data.fetchImpl);
  return state.verifiedDelivery({...data,providerResponse:response});
}
module.exports={readProvider,verify};
