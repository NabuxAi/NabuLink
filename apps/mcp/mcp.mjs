#!/usr/bin/env node
// A genuine MCP stdio server. Deliberately local: only the user's own MCP client gets admin access.
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const BASE=String(process.env.NBL_SERVER_URL||'').replace(/\/$/,'');
const TOKEN=process.env.NBL_ADMIN_TOKEN||'';
if(!BASE.startsWith('https://')&&!BASE.startsWith('http://127.0.0.1:')){
 console.error('NBL_SERVER_URL must be HTTPS (or localhost for tests)');process.exit(1);
}
if(!TOKEN){console.error('NBL_ADMIN_TOKEN is required');process.exit(1);}
async function api(path,method='GET',body){
 const r=await fetch(BASE+path,{method,headers:{authorization:'Bearer '+TOKEN,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const j=await r.json();if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j;
}
const mcp=new McpServer({name:'nabulink',version:'0.1.0'});
const out=j=>({content:[{type:'text',text:JSON.stringify(j,null,2)}]});
function safe(fn){return async args=>{try{return out(await fn(args));}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}};}
mcp.registerTool('nabulink_list_devices',{description:'List explicitly paired devices and enabled capabilities.',inputSchema:z.object({})},safe(()=>api('/api/devices')));
mcp.registerTool('nabulink_device_info',{description:'Request basic system info from an online, paired device.',inputSchema:z.object({deviceId:z.string().uuid()})},safe(({deviceId})=>api('/api/devices/'+deviceId+'/action','POST',{method:'device.info',args:{}})));
mcp.registerTool('nabulink_camera_capabilities',{description:'Check whether a paired device has any locally approved camera/PTZ adapter. This does not capture media.',inputSchema:z.object({deviceId:z.string().uuid()})},safe(({deviceId})=>api('/api/devices/'+deviceId+'/action','POST',{method:'camera.capabilities',args:{}})));
mcp.registerTool('nabulink_speak',{description:'Speak short user-provided text on an explicitly speech-enabled paired device. It will make audible sound.',inputSchema:z.object({deviceId:z.string().uuid(),text:z.string().min(1).max(240)})},safe(({deviceId,text})=>api('/api/devices/'+deviceId+'/action','POST',{method:'speech.speak',args:{text}})));
const transport=new StdioServerTransport();
await mcp.connect(transport);
