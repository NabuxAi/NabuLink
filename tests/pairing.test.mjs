import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const tmp=mkdtempSync(path.join(os.tmpdir(),'nabulink-test-'));
const token='test-admin-token-'+('x'.repeat(48));
const port=18000+Math.floor(Math.random()*15000);
const base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['apps/server/server.mjs'],{cwd:process.cwd(),env:{...process.env,NBL_HOST:'127.0.0.1',NBL_PORT:String(port),NBL_DATA_DIR:tmp,NBL_ADMIN_TOKEN:token,NBL_PUBLIC_ORIGIN:base},stdio:'ignore'});
after(()=>{child.kill();rmSync(tmp,{recursive:true,force:true});});
async function json(endpoint,method='GET',body,auth=false){
 const res=await fetch(base+endpoint,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(auth?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 return {status:res.status,body:await res.json()};
}
async function ready(){
 for(let i=0;i<70;i++){try{const r=await json('/healthz');if(r.status===200)return;}catch(e){}await new Promise(r=>setTimeout(r,100));}
 throw Error('server did not start');
}
test('Pairing requires admin approval and only allows known capabilities',async()=>{
 await ready();
 assert.equal((await json('/api/devices')).status,401);
 const created=await json('/api/pair/start','POST',{name:'Local Test Device'});
 assert.equal(created.status,201);
 assert.equal((await json('/api/pair/approve','POST',{code:'INVALID'},true)).status,404);
 const pre=await json('/api/pair/status','POST',{requestId:created.body.requestId,secret:created.body.secret});
 assert.equal(pre.body.status,'pending');
 const approved=await json('/api/pair/approve','POST',{code:created.body.code},true);
 assert.equal(approved.status,200);
 const creds=await json('/api/pair/status','POST',{requestId:created.body.requestId,secret:created.body.secret});
 assert.equal(creds.body.status,'approved');
 assert.equal((await json('/api/pair/status','POST',{requestId:created.body.requestId,secret:created.body.secret})).status,404);
 const id=creds.body.id;
 let ws;
 await new Promise((resolve,reject)=>{
  ws=new WebSocket(base.replace('http','ws')+'/ws/agent?id='+id,{headers:{Authorization:'Bearer '+creds.body.token}});
  ws.once('open',resolve);ws.once('error',reject);
 });
 ws.send(JSON.stringify({type:'hello',platform:'test',capabilities:['device.info','camera.capabilities','danger.shell']}));
 ws.on('message',data=>{
  const msg=JSON.parse(data.toString());
  if(msg.type==='request')ws.send(JSON.stringify({type:'response',id:msg.id,ok:true,result:{hostname:'test-device'}}));
 });
 await new Promise(resolve=>setTimeout(resolve,90));
 let list=await json('/api/devices','GET',null,true);
 assert.equal(list.body.devices.length,1);
 assert.equal(list.body.devices[0].capabilities.includes('danger.shell'),false);
 assert.equal((await json('/api/devices/'+id+'/action','POST',{method:'danger.shell'},true)).status,400);
 assert.equal((await json('/api/devices/'+id+'/action','POST',{method:'speech.speak',args:{text:'hello'}},true)).status,403);
 let result=await json('/api/devices/'+id+'/action','POST',{method:'device.info',args:{}},true);
 assert.equal(result.body.result.hostname,'test-device');
 assert.equal((await json('/api/devices/'+id,'DELETE',null,true)).status,200);
 assert.equal((await json('/api/devices/'+id+'/action','POST',{method:'device.info',args:{}},true)).status,404);
 ws.terminate();
});
