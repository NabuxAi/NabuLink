#!/usr/bin/env node
// NabuLink server — no inbound ports or VPN needed on agents.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.NBL_PORT||8787);
const HOST=process.env.NBL_HOST||'0.0.0.0';
const DATA=process.env.NBL_DATA_DIR||path.join(HERE,'../../data');
const ADMIN=process.env.NBL_ADMIN_TOKEN||'';
const ORIGIN=process.env.NBL_PUBLIC_ORIGIN||'';
const LOG=(...args)=>console.log(new Date().toISOString(),...args);
if(ADMIN.length<32){console.error('Set a random NBL_ADMIN_TOKEN of at least 32 characters before starting.');process.exit(1);}
fs.mkdirSync(DATA,{recursive:true,mode:0o700});
const DB=path.join(DATA,'devices.json');
let state={devices:{}};
if(fs.existsSync(DB)){
  try{state=JSON.parse(fs.readFileSync(DB,'utf8'));if(!state.devices||typeof state.devices!=='object')throw Error('bad state');}
  catch(e){console.error('Refusing to overwrite invalid state database:',e.message);process.exit(1);}
}
function persist(){
  const tmp=DB+'.tmp-'+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});
  fs.renameSync(tmp,DB);
}
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
const random=()=>crypto.randomBytes(32).toString('base64url');
const pending=new Map(),sessions=new Map(),rates=new Map(),agents=new Map(),inflight=new Map();
const allowed=new Set(['device.info','camera.capabilities','speech.speak']);
const now=()=>Date.now();
function auth(req){const a=req.headers.authorization||'';return a.startsWith('Bearer ')&&equal(hash(a.slice(7)),hash(ADMIN));}
function standard(res,code,obj){
 const text=JSON.stringify(obj);
 res.writeHead(code,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(text),'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});
 res.end(text);
}
function html(res){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(fs.readFileSync(path.join(HERE,'dashboard.html')));}
function json(req){
 return new Promise((resolve,reject)=>{
  let parts=[],n=0;
  req.on('data',b=>{n+=b.length;if(n>32768){reject(Object.assign(Error('too large'),{status:413}));req.destroy();}else parts.push(b);});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch(e){reject(Object.assign(Error('invalid JSON'),{status:400}));}});
  req.on('error',reject);
 });
}
function originOK(req){return !req.headers.origin || (!!ORIGIN&&req.headers.origin===ORIGIN);}
function ipAllowed(req){
 const ip=req.socket.remoteAddress||'unknown',t=now();
 const a=(rates.get(ip)||[]).filter(v=>t-v<600000);
 if(a.length>=8)return false;
 a.push(t);rates.set(ip,a);return true;
}
function cleanup(){for(const [id,p] of pending)if(p.expires<now())pending.delete(id);for(const [ip,times] of rates)if(times.every(t=>now()-t>600000))rates.delete(ip);}
setInterval(cleanup,60000).unref();

function agentInfo(id,device){
 const s=agents.get(id);
 return {id,name:device.name,createdAt:device.createdAt,online:!!s&&s.readyState===WebSocket.OPEN,platform:device.platform||null,capabilities:device.capabilities||[]};
}
async function callAgent(id,method,args={}){
 const agent=state.devices[id],ws=agents.get(id);
 if(!agent)throw Object.assign(Error('Device not found'),{status:404});
 if(!allowed.has(method))throw Object.assign(Error('Unsupported action'),{status:400});
 if(!ws||ws.readyState!==WebSocket.OPEN)throw Object.assign(Error('Device is offline'),{status:503});
 if(!agent.capabilities?.includes(method))throw Object.assign(Error('Device has not enabled this capability'),{status:403});
 if(method==='speech.speak'&&(typeof args.text!=='string'||args.text.trim().length<1||args.text.length>240))throw Object.assign(Error('text must be 1-240 characters'),{status:400});
 const idReq=crypto.randomUUID();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{inflight.delete(idReq);reject(Object.assign(Error('Device did not respond'),{status:504}));},12000);
  inflight.set(idReq,{resolve,reject,timer,agentId:id});
  try{ws.send(JSON.stringify({type:'request',id:idReq,method,args}));}
  catch(e){clearTimeout(timer);inflight.delete(idReq);reject(e);}
 });
}
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 try{
  if(req.method==='GET'&&pathname==='/healthz')return standard(res,200,{ok:true,name:'NabuLink',version:'0.1.0'});
  if(req.method==='GET'&&pathname==='/')return html(res);
  if(req.method==='GET'&&pathname==='/dashboard.js'){
    const script=fs.readFileSync(path.join(HERE,'dashboard.js'));
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY'});
    return res.end(script);
  }
  if(!originOK(req))return standard(res,403,{error:'Origin not allowed'});
  if(req.method==='POST'&&pathname==='/api/pair/start'){
   if(!ipAllowed(req)||pending.size>=100)return standard(res,429,{error:'Too many pairing requests'});
   const body=await json(req);const name=String(body.name||'').trim().slice(0,64);
   if(name.length<2||!/^[\p{L}\p{N}_.\- ]+$/u.test(name))return standard(res,400,{error:'Invalid device name'});
   const requestId=crypto.randomUUID(),secret=random(),code=crypto.randomBytes(5).toString('hex').toUpperCase();
   pending.set(requestId,{code,secretHash:hash(secret),name,created:now(),expires:now()+300000,approved:null});
   LOG('pair.request',requestId,'device',name);
   return standard(res,201,{requestId,secret,code,expiresInSeconds:300});
  }
  if(req.method==='POST'&&pathname==='/api/pair/status'){
   const body=await json(req),p=pending.get(body.requestId);
   if(!p||p.expires<now()||!equal(p.secretHash,hash(String(body.secret||''))))return standard(res,404,{error:'Pair request not found'});
   if(!p.approved)return standard(res,200,{status:'pending'});
   pending.delete(body.requestId);
   return standard(res,200,{status:'approved',id:p.approved.id,token:p.approved.token});
  }
  if(!auth(req))return standard(res,401,{error:'Administrator authentication required'});
  if(req.method==='GET'&&pathname==='/api/devices'){
   return standard(res,200,{devices:Object.entries(state.devices).map(([id,device])=>agentInfo(id,device))});
  }
  if(req.method==='POST'&&pathname==='/api/pair/approve'){
   const body=await json(req),code=String(body.code||'').trim().toUpperCase().replace(/[- ]/g,'');
   const entry=[...pending.entries()].find(([,p])=>p.code===code&&p.expires>=now()&&!p.approved);
   if(!entry)return standard(res,404,{error:'Pairing code expired or invalid'});
   const [requestId,p]=entry,deviceId=crypto.randomUUID(),token=random();
   state.devices[deviceId]={name:p.name,tokenHash:hash(token),createdAt:new Date().toISOString(),capabilities:[]};
   persist();p.approved={id:deviceId,token};LOG('pair.approve',requestId,deviceId);
   return standard(res,200,{id:deviceId,name:p.name});
  }
  const match=pathname.match(/^\/api\/devices\/([a-z0-9-]+)(?:\/(action))?$/i);
  if(match){
   const id=match[1];
   if(req.method==='DELETE'&&!match[2]){
    if(!state.devices[id])return standard(res,404,{error:'Device not found'});
    delete state.devices[id];persist();agents.get(id)?.close(4001,'revoked');agents.delete(id);LOG('device.revoked',id);
    return standard(res,200,{revoked:true});
   }
   if(req.method==='POST'&&match[2]==='action'){
    const body=await json(req);
    const result=await callAgent(id,body.method,body.args||{});
    LOG('action',id,body.method,'result',result.ok?'ok':'error');
    return standard(res,200,result);
   }
  }
  return standard(res,404,{error:'Not found'});
 }catch(e){LOG('api.error',pathname,e.message);if(!res.headersSent)standard(res,e.status||500,{error:e.status?e.message:'Internal server error'});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:16384});
server.on('upgrade',(req,socket,head)=>{
 try{
  const u=new URL(req.url,'http://localhost');if(u.pathname!=='/ws/agent')return socket.destroy();
  const id=u.searchParams.get('id'),d=state.devices[id],v=req.headers.authorization||'';
  if(!d||!v.startsWith('Bearer ')||!equal(hash(v.slice(7)),d.tokenHash))return socket.destroy();
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,id));
 }catch(e){socket.destroy();}
});
wss.on('connection',(ws,id)=>{
 agents.get(id)?.close(4002,'new session');agents.set(id,ws);ws.alive=true;
 LOG('device.connected',id);
 ws.on('pong',()=>{ws.alive=true;});
 ws.on('message',buf=>{
  let msg;try{msg=JSON.parse(buf.toString());}catch(e){return;}
  if(msg.type==='hello'){
   const available=Array.isArray(msg.capabilities)?msg.capabilities.filter(c=>allowed.has(c)):[];
   state.devices[id].capabilities=available;state.devices[id].platform=String(msg.platform||'unknown').slice(0,36);persist();
  }else if(msg.type==='response'&&typeof msg.id==='string'){
   const p=inflight.get(msg.id);
   if(p&&p.agentId===id){clearTimeout(p.timer);inflight.delete(msg.id);p.resolve({ok:!!msg.ok,result:msg.result??null,error:msg.error??null});}
  }
 });
 ws.on('close',()=>{if(agents.get(id)===ws)agents.delete(id);LOG('device.disconnected',id);});
 ws.on('error',()=>{});
});
setInterval(()=>{for(const [id,ws] of agents){if(!ws.alive){ws.terminate();agents.delete(id);continue;}ws.alive=false;ws.ping();}},25000).unref();
server.listen(PORT,HOST,()=>LOG('listening',HOST,PORT));
