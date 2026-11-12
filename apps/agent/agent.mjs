#!/usr/bin/env node
// NabuLink opt-in agent: outgoing connection only; no arbitrary command execution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const arg=(key,fallback)=>{const i=process.argv.indexOf('--'+key);return i>=0?process.argv[i+1]:fallback;};
const server=String(arg('server',process.env.NBL_SERVER_URL||'http://127.0.0.1:8787')).replace(/\/$/,'');
const name=String(arg('name',os.hostname())).slice(0,64);
const allowSpeech=process.env.NBL_ALLOW_SPEECH==='1'||process.argv.includes('--allow-speech');
const configFile=path.resolve(arg('config',path.join(os.homedir(),'.nabulink','agent.json')));
if(!/^https?:\/\//.test(server)){console.error('Invalid NBL_SERVER_URL');process.exit(1);}
if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(new URL(server).host)&&!server.startsWith('https://')){
 console.error('Refusing insecure HTTP to a remote server. Use HTTPS.');process.exit(1);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const capabilities=['device.info','camera.capabilities',...(allowSpeech?['speech.speak']:[])];
async function post(p,body,headers={}){
 const r=await fetch(server+p,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const j=await r.json();if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j;
}
function saveConfig(data){
 fs.mkdirSync(path.dirname(configFile),{recursive:true,mode:0o700});
 fs.writeFileSync(configFile,JSON.stringify(data,null,2),{mode:0o600});
 try{fs.chmodSync(configFile,0o600);}catch(e){}
}
async function enroll(){
 let cfg;
 if(fs.existsSync(configFile)){cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));if(cfg.id&&cfg.token&&cfg.server===server)return cfg;}
 const p=await post('/api/pair/start',{name});
 console.log('\nNabuLink pairing code: '+p.code);
 console.log('Open '+server+' on your trusted admin browser and approve this code within 5 minutes.\n');
 const until=Date.now()+300000;
 while(Date.now()<until){
  await sleep(2500);
  try{
   const reply=await post('/api/pair/status',{requestId:p.requestId,secret:p.secret});
   if(reply.status==='approved'){
    cfg={server,id:reply.id,token:reply.token,name};
    saveConfig(cfg);
    console.log('Paired successfully: '+cfg.id);
    return cfg;
   }
  }catch(e){if(Date.now()>until-15000)throw e;}
 }
 throw Error('Pairing expired. Run the agent again for a new code.');
}
function speak(text){
 return new Promise((resolve,reject)=>{
  if(!allowSpeech)return reject(Error('Speech not approved on this agent'));
  if(typeof text!=='string'||!text.trim()||text.length>240)return reject(Error('Invalid text length'));
  let command,args;
  if(process.platform==='darwin'){command='say';args=[text];}
  else if(process.platform==='win32'){
   command='powershell.exe';
   const message=Buffer.from(text,'utf16le').toString('base64');
   const script=`Add-Type -AssemblyName System.Speech; $t=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${message}')); $v=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v.Speak($t)`;
   args=['-NoProfile','-NonInteractive','-Command',script];
  }else return reject(Error('Speech adapter not available on this platform'));
  const child=spawn(command,args,{shell:false,windowsHide:true,stdio:'ignore'});
  const timer=setTimeout(()=>{child.kill();reject(Error('Speech timeout'));},15000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve('Spoken locally'):reject(Error('Speech failed'));});
 });
}
async function action(method,args){
 if(!capabilities.includes(method))throw Error('Capability disabled');
 if(method==='device.info')return {hostname:os.hostname(),platform:process.platform,arch:process.arch,release:os.release(),uptimeSeconds:Math.round(os.uptime()),capabilities};
 if(method==='camera.capabilities')return {available:false,ptz:false,note:'Camera PTZ requires a supported local driver and explicit approval. No video is captured by this agent.'};
 if(method==='speech.speak')return await speak(args?.text);
 throw Error('Action unsupported');
}
async function connect(cfg){
 const u=new URL(server.replace(/^http/,'ws')+'/ws/agent');
 u.searchParams.set('id',cfg.id);
 return new Promise((resolve,reject)=>{
  let opened=false;
  const ws=new WebSocket(u.toString(),{headers:{Authorization:'Bearer '+cfg.token},handshakeTimeout:10000});
  ws.on('open',()=>{
   opened=true;console.log('Connected to '+server);
   ws.send(JSON.stringify({type:'hello',platform:process.platform,capabilities}));
  });
  ws.on('message',async buf=>{
   let msg;try{msg=JSON.parse(buf.toString());}catch(e){return;}
   if(msg.type!=='request'||typeof msg.id!=='string')return;
   let result;
   try{const value=await action(msg.method,msg.args||{});result={type:'response',id:msg.id,ok:true,result:value};}
   catch(e){result={type:'response',id:msg.id,ok:false,error:String(e.message).slice(0,150)};}
   if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(result));
  });
  ws.once('error',e=>{if(!opened)reject(e);else console.error('Connection error:',e.message);});
  ws.once('close',(code)=>{
   console.warn('Disconnected',code);
   if(!opened)reject(Error('WebSocket closed before connection (code '+code+')'));else resolve();
  });
 });
}
async function main(){
 const cfg=await enroll();
 let backoff=1000;
 for(;;){
  try{await connect(cfg);backoff=1000;}
  catch(e){console.error('Connection:',e.message);}
  const delay=backoff+Math.floor(Math.random()*700);
  await sleep(delay);backoff=Math.min(backoff*2,30000);
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
