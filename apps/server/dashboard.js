'use strict';
const $=id=>document.getElementById(id);
let token='';
function say(t){$('msg').textContent=t;}
async function api(path,method='GET',body){
 const r=await fetch(path,{method,cache:'no-store',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const contentType=r.headers.get('content-type')||'';
 if(!contentType.includes('application/json'))throw Error('Unexpected server response');
 const j=await r.json();if(!r.ok)throw Error(j.error||('HTTP '+r.status));return j;
}
async function load(){
 try{const data=await api('/api/devices');const container=$('devices');container.replaceChildren();
  if(!data.devices.length){container.textContent='No devices paired yet.';return;}
  for(const d of data.devices){
   const section=document.createElement('div');section.className='device';
   const h=document.createElement('strong');h.textContent=d.name+' · '+(d.online?'Online':'Offline');section.appendChild(h);
   const info=document.createElement('small');info.textContent='ID: '+d.id+' | '+(d.platform||'unknown')+' | capabilities: '+d.capabilities.join(', ');section.appendChild(info);
   const row=document.createElement('div');row.className='row';
   const inspect=document.createElement('button');inspect.textContent='Device info';inspect.onclick=()=>action(d.id,'device.info',{});
   const camera=document.createElement('button');camera.textContent='Camera support';camera.onclick=()=>action(d.id,'camera.capabilities',{});
   row.append(inspect,camera);
   if(d.capabilities.includes('speech.speak')){
    const input=document.createElement('input');input.placeholder='Text to speak on device';input.maxLength=240;
    const speak=document.createElement('button');speak.textContent='Speak';speak.onclick=()=>action(d.id,'speech.speak',{text:input.value});
    row.append(input,speak);
   }
   const revoke=document.createElement('button');revoke.className='warn';revoke.textContent='Revoke';revoke.onclick=async()=>{if(!confirm('Permanently revoke '+d.name+'?'))return;try{await api('/api/devices/'+d.id,'DELETE');say('Access revoked');await load();}catch(e){say(e.message);}};
   row.append(revoke);section.appendChild(row);container.appendChild(section);
  }
 }catch(e){say(e.message);}
}
async function action(id,method,args){try{const r=await api('/api/devices/'+id+'/action','POST',{method,args});say(JSON.stringify(r,null,2));}catch(e){say(e.message);}}
$('load').onclick=()=>{token=$('token').value.trim();$('token').value='';load();};
$('approve').onclick=async()=>{try{const r=await api('/api/pair/approve','POST',{code:$('code').value});say('Approved '+r.name);$('code').value='';load();}catch(e){say(e.message);}};
