const timeout=(promise,ms,message)=>new Promise((resolve,reject)=>{
  const id=setTimeout(()=>reject(Error(message)),ms);
  promise.then(value=>{clearTimeout(id);resolve(value);},error=>{clearTimeout(id);reject(error);});
});
function ask(worker,type){
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();reject(Error('Offline check timed out. Please reconnect and retry.'));},12000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
    worker.postMessage({type},[channel.port2]);
  });
}
export function setupOffline({button,status}){
  if(!('serviceWorker' in navigator)||!window.isSecureContext){
    status.textContent='Offline saving needs HTTPS and a browser with service-worker support.';
    button.disabled=true;return;
  }
  let registration;
  const prepare=async()=>{
    if(!registration||(!registration.active&&!registration.installing))registration=await navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:new URL('./',document.baseURI).pathname,updateViaCache:'none'});
    return await timeout(navigator.serviceWorker.ready,15000,'App saving is not ready. Connect to the internet and try again.');
  };
  // Automatic install is allowed, but readiness is only asserted after a verified reply.
  const wasControlled=Boolean(navigator.serviceWorker.controller);
  prepare().then(async ready=>{
    if(wasControlled){
      const report=await ask(ready.active,'CHECK_OFFLINE');
      if(report.ready&&Array.isArray(report.missing)&&!report.missing.length&&report.total>=12){
        status.textContent='Ready offline · all app files verified on this device.';button.textContent='Check offline';
      }
    }
  }).catch(()=>{status.textContent='Not saved yet. Connect to the internet, then choose Save offline.';});
  button.addEventListener('click',async()=>{
    button.disabled=true;status.textContent='Saving and checking every app asset…';status.classList.remove('error');
    try{
      const ready=await prepare();
      const report=await ask(ready.active,'SAVE_OFFLINE');
      if(!report.ready||!Array.isArray(report.missing)||report.missing.length||report.total<12)throw Error('Some app files are missing. Connect to the internet and try again.');
      status.textContent='Ready offline · all app files verified on this device.';
      button.textContent='Check offline';
      // Best effort only: persistence can be denied or later cleared by the user.
      if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
    }catch(error){status.textContent=`Not ready offline. ${error.message}`;status.classList.add('error');button.textContent='Save offline';}
    finally{button.disabled=false;}
  });
}
