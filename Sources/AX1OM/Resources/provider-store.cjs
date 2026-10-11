'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {spawnSync}=require('node:child_process');
const {root,runtimeRoot,vergeRoot,relayRoot,home,YAML} = require('./adapter-paths.cjs');
const {DEFAULTS,SUPPLEMENTAL_DEFAULTS,SERVICE_DOMAINS,NAMES,validateRoutes,validateSupplemental} = require('./fleet-compiler.cjs');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const storeFile = () => path.join(root,'sources','index.json');
const DEFAULT_DOMAINS = {
 openai:['openai.com','chatgpt.com','oaistatic.com','oaiusercontent.com','openaiapi.com','chat.com'],
 claude:['claude.ai','anthropic.com','claude.com'],
 google:['google.com','googleapis.com','gstatic.com','googleusercontent.com','google.co.uk','google.com.hk','google.com.tw','gmail.com','googlemail.com','ggpht.com','googlesyndication.com','googleadservices.com','gvt1.com','gvt2.com'],
 xai:['x.com','twitter.com','twimg.com','t.co','x.ai','grok.com'],
 slack:['slack.com','slack-edge.com','slack-files.com','slack-imgs.com','slack-msgs.com']
};
const BASE_DIRECT = [
 'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve','IP-CIDR,10.0.0.0/8,DIRECT,no-resolve','IP-CIDR,172.16.0.0/12,DIRECT,no-resolve','IP-CIDR,192.168.0.0/16,DIRECT,no-resolve','IP-CIDR,100.64.0.0/10,DIRECT,no-resolve','IP-CIDR6,::1/128,DIRECT,no-resolve','IP-CIDR6,fc00::/7,DIRECT,no-resolve','IP-CIDR6,fe80::/10,DIRECT,no-resolve','IP-CIDR6,fd7a:115c:a1e0::/48,DIRECT,no-resolve',
 ...['tailscale.com','tailscale.io','tailscale.net','ts.net','tuxun.fun','petalmaps.com','mapapi.cloud.huawei.com','siteapi.cloud.huawei.com','map.huawei.com','maps.huawei.com','localhost','local','lan'].map(d=>`DOMAIN-SUFFIX,${d},DIRECT`),
 ...['Tailscale','io.tailscale.ipn.macsys.network-extension','AweSun','AweSun_Helper','AweSun_Desktop'].map(p=>`PROCESS-NAME,${p},DIRECT`)
];
function writeSecure(file,value) {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.chmodSync(path.dirname(file),0o700);
 const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
 fs.writeFileSync(temporary,value,{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
}
function loadStore() {
 if (!fs.existsSync(storeFile())) return {version:1,sources:[],privateNodes:{},domains:clone(DEFAULT_DOMAINS),directRules:[]};
 const s=JSON.parse(fs.readFileSync(storeFile(),'utf8'));
 if(s.version!==1||!Array.isArray(s.sources)||!s.privateNodes) throw Error('STORE_INVALID');return s;
}
function saveStore(s) {writeSecure(storeFile(),JSON.stringify(s,null,2));}
function redact(s) {return {success:true,sources:s.sources.map(({id,name,type,count,quota,sourceFingerprint,updatedAt})=>({id,name,type,count,quota,sourceFingerprint,updatedAt})),privateNodeIds:Object.keys(s.privateNodes),runtimeRoot};}
function validURL(value) {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('HTTPS_SOURCE_REQUIRED');return u.href;}
function safeNodes(nodes) {
 if(!Array.isArray(nodes)||!nodes.length)throw Error('EMPTY_PROVIDER');
 const clean=nodes.filter(n=>n&&typeof n.name==='string'&&n.name.length<256&&typeof n.type==='string'&&typeof n.server==='string'&&Number.isInteger(n.port)&&n.port>0&&n.port<=65535&&n.name!=='GPT Google 本机专线'&&!['127.0.0.1','localhost','::1','0.0.0.0'].includes(n.server));
 const seen=new Set();for(const n of clean){if(seen.has(n.name))throw Error('DUPLICATE_NODE_NAME');seen.add(n.name);}
 if(!clean.length)throw Error('NO_INDEPENDENT_NODES');return clone(clean);
}
function parseSource(text) {const value=YAML.parse(text);return safeNodes(value?.proxies);}
function validateCachedNodes(nodes) {
 const binary=process.env.AX1OM_MIHOMO_BINARY;if(!binary)return;
 if(!path.isAbsolute(binary)||!fs.existsSync(binary))throw Error('VALIDATOR_UNAVAILABLE');
 const stage=path.join(runtimeRoot,`provider-stage-${crypto.randomBytes(6).toString('hex')}.yaml`);
 try{
  writeSecure(stage,YAML.stringify({mode:'rule',proxies:nodes,'proxy-groups':[{name:'CHECK',type:'select',proxies:nodes.map(n=>n.name)}],rules:['MATCH,CHECK']}));
  const result=spawnSync(binary,['-t','-d',runtimeRoot,'-f',stage],{encoding:'utf8',timeout:30000,maxBuffer:512*1024,windowsHide:true});
  if(result.error||result.status!==0)throw Error('PROVIDER_VALIDATION_FAILED');
 }finally{try{fs.unlinkSync(stage);}catch{}}
}
function addCached(s,{name,type,url,identity,nodes,quota}) {
 if(typeof name!=='string'||!name.trim()||name.length>160)throw Error('INVALID_SOURCE_NAME');
 const finalURL=type==='http'?validURL(url):undefined;
 const sourceFingerprint=hash(finalURL||identity).slice(0,16);
 const id=`source-${hash(finalURL||identity).slice(0,12)}`;
 const safe=safeNodes(nodes);validateCachedNodes(safe);const cachePath=`providers/${id}.yaml`;
 writeSecure(path.join(runtimeRoot,cachePath),YAML.stringify({proxies:safe}));
 const previous=s.sources.find(p=>p.id===id);const source={id,name:name.trim(),type,cachePath,count:safe.length,sourceFingerprint,updatedAt:new Date().toISOString(),...(finalURL?{url:finalURL}:{}),...(quota?{quota}:{}),createdAt:previous?.createdAt||new Date().toISOString()};
 const position=s.sources.findIndex(p=>p.id===id);if(position<0)s.sources.push(source);else s.sources[position]=source;return id;
}
function importDirect(rules) {
 return (rules||[]).filter(r=>typeof r==='string'&&/,DIRECT(,no-resolve)?$/.test(r)).map(r=> {
  const wrapped=/^AND,\(\(NOT,\(\(IN-NAME,dsh-public-web\)\)\),\((.+)\)\),DIRECT$/.exec(r);
  if(!wrapped)return r;const inner=wrapped[1];return inner.endsWith(',no-resolve')?`${inner.slice(0,-11)},DIRECT,no-resolve`:`${inner},DIRECT`;
 }).filter(r=>!r.includes('IN-NAME')&&!r.startsWith('GEOIP,')&&!r.startsWith('RULE-SET,')&&!r.startsWith('MATCH,'));
}
function convertPrivate(id,value) {
 if(!Object.hasOwn(NAMES,id))throw Error('PRIVATE_ID_INVALID');
 let node;
 if(Array.isArray(value.proxies))node=value.proxies.find(p=>p.type==='vless');
 else if(Array.isArray(value.outbounds)){
  const a=value.outbounds.find(p=>p.type==='vless');if(!a?.tls?.reality?.public_key)throw Error('REALITY_INCOMPLETE');
  node={type:'vless',server:a.server,port:a.server_port,uuid:a.uuid,network:'tcp',tls:true,flow:a.flow,'client-fingerprint':a.tls.utls?.fingerprint||'chrome',servername:a.tls.server_name,'reality-opts':{'public-key':a.tls.reality.public_key,'short-id':a.tls.reality.short_id},udp:true};
 }else node={...value,...(id==='panda'?{type:'vless',network:'tcp',tls:true,'client-fingerprint':'chrome',udp:true}:{})};
 if(node?.type!=='vless'||!node.uuid||!node['reality-opts']?.['public-key']||!node['reality-opts']?.['short-id'])throw Error('REALITY_INCOMPLETE');
 const safe=safeNodes([{...node,name:NAMES[id]}])[0];for(const field of ['interface-name','routing-mark','dialer-proxy','ip-version'])delete safe[field];return safe;
}
function importLegacy(input={}) {
 const s=loadStore();const legacy=input.legacyRoot||vergeRoot;const skipped=[];
 if(fs.existsSync(path.join(legacy,'profiles.yaml'))){
  const entries=YAML.parse(fs.readFileSync(path.join(legacy,'profiles.yaml'),'utf8')).items||[];
  for(const profile of entries.filter(p=>['local','remote'].includes(p.type)))try{
   if(!profile.file||path.basename(profile.file)!==profile.file)throw Error('PATH_INVALID');
   const nodes=parseSource(fs.readFileSync(path.join(legacy,'profiles',profile.file),'utf8'));
   addCached(s,{name:profile.name,type:profile.type==='remote'&&profile.url?'http':'file',url:profile.url,identity:`legacy:${profile.uid}`,nodes,quota:profile.extra});
  }catch{skipped.push({name:typeof profile.name==='string'?profile.name:'来源',reason:'本地清单无效或没有独立节点'});}
 }
 if(fs.existsSync(path.join(legacy,'clash-verge.yaml'))){
  const c=YAML.parse(fs.readFileSync(path.join(legacy,'clash-verge.yaml'),'utf8'));s.directRules=[...new Set([...s.directRules,...importDirect(c.rules)])];
  for(const name of ['Country.mmdb','geoip.dat','geosite.dat','ASN.mmdb'])if(fs.existsSync(path.join(legacy,name))){fs.mkdirSync(runtimeRoot,{recursive:true,mode:0o700});fs.copyFileSync(path.join(legacy,name),path.join(runtimeRoot,name));fs.chmodSync(path.join(runtimeRoot,name),0o600);}
 }
 const domainFile=input.domainsPath||path.join(relayRoot,'service-v2/domains.json');
 if(fs.existsSync(domainFile)){const d=JSON.parse(fs.readFileSync(domainFile,'utf8'));for(const kind of Object.keys(DEFAULT_DOMAINS))if(Array.isArray(d[kind]))s.domains[kind]=[...new Set([...DEFAULT_DOMAINS[kind],...d[kind].filter(x=>typeof x==='string'&&/^[a-z0-9.-]+$/i.test(x))])];}
 let savedPaths={};const legacyPathsFile=path.join(root,'sources','legacy-paths.json');if(fs.existsSync(legacyPathsFile))savedPaths=JSON.parse(fs.readFileSync(legacyPathsFile,'utf8')).privatePaths||{};
 const paths=input.privatePaths||{azure:process.env.AX1OM_AZURE_CONFIG||savedPaths.azure||path.join(home,'Downloads/Azure-WestUS-Direct.ready.mihomo.yaml'),'la-a':process.env.AX1OM_LA_CONFIG||savedPaths['la-a'],panda:process.env.AX1OM_PANDA_CONFIG||savedPaths.panda||path.join(relayRoot,'node.json')};
 for(const [id,file] of Object.entries(paths))try{if(typeof file!=='string'||!fs.existsSync(file))continue;s.privateNodes[id]=convertPrivate(id,YAML.parse(fs.readFileSync(file,'utf8')));}catch{skipped.push({name:NAMES[id]||'专线',reason:'认证字段不完整，未导入'});}
 saveStore(s);return {...redact(s),skipped};
}
async function addSource(input) {
 const s=loadStore();let nodes,quota;
 if(input.type==='file'){if(typeof input.path!=='string'||!path.isAbsolute(input.path))throw Error('FILE_PATH_REQUIRED');nodes=parseSource(fs.readFileSync(input.path,'utf8'));}
 else if(input.type==='http'){
  const url=validURL(input.url);const response=await fetch(url,{headers:{'user-agent':'AX1OM-Network/1.0 Mihomo'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('SOURCE_HTTP_FAILED');const length=Number(response.headers.get('content-length'));if(length>4*1024*1024)throw Error('SOURCE_TOO_LARGE');
  let total=0;const chunks=[];for await(const chunk of response.body){total+=chunk.length;if(total>4*1024*1024)throw Error('SOURCE_TOO_LARGE');chunks.push(chunk);}nodes=parseSource(Buffer.concat(chunks).toString('utf8'));
  const header=response.headers.get('subscription-userinfo');if(header){quota={};for(const part of header.split(';')){const [key,value]=part.trim().split('=');if(['upload','download','total','expire'].includes(key)&&/^\d+$/.test(value))quota[key]=Number(value);}}
 }else throw Error('SOURCE_TYPE_INVALID');
 const id=addCached(s,{name:input.name,type:input.type,url:input.url,identity:`file:${input.path}`,nodes,quota});saveStore(s);return {...redact(s),sourceId:id};
}
function ownedConfig(s,input) {
 const {socketPath,secret}=input.controller||controllerForBuild();
 if(typeof socketPath!=='string'||!path.isAbsolute(socketPath)||socketPath.length>100||typeof secret!=='string'||secret.length<24||secret.length>256)throw Error('CONTROL_METADATA_INVALID');
 const mixedPort=input.mixedPort??18081,dnsPort=input.dnsPort??18082;for(const port of[mixedPort,dnsPort])if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT_INVALID');if(mixedPort===dnsPort)throw Error('PORT_COLLISION');
 const providers={};for(const p of s.sources){const nodeFile=path.join(runtimeRoot,p.cachePath);if(!fs.existsSync(nodeFile))throw Error('CACHE_MISSING');safeNodes(YAML.parse(fs.readFileSync(nodeFile,'utf8')).proxies);
  providers[p.id]={type:p.type,path:`./${p.cachePath}`,'health-check':{enable:true,url:'https://cp.cloudflare.com/generate_204',interval:300,lazy:true},override:{'additional-prefix':`${p.name} · ${p.id.slice(-6)} · `},...(p.type==='http'?{url:validURL(p.url),interval:3600,proxy:'AX1OM GENERAL'}:{})};
 }
 const use=s.sources.map(p=>p.id),groups=[];const available=Object.values(s.privateNodes).map(p=>p.name);
 groups.push({name:'AX1OM GENERAL',type:'select',proxies:use.length?[]:['REJECT'],...(use.length?{use}:{})});
 groups.push({name:'AX1OM DOWNLOAD',type:'select',proxies:['AX1OM GENERAL',...(s.privateNodes.azure?[NAMES.azure]:[])],...(use.length?{use}:{})});
 groups.push({name:'AX1OM ALL',type:'select',proxies:['AX1OM GENERAL',...available],...(use.length?{use}:{})});
 const routes=validateRoutes(input.routes),supplemental=validateSupplemental(input.supplemental);
 for(const r of routes){const members=[s.privateNodes[r.primary]?.name,s.privateNodes[r.backup]?.name].filter(Boolean);groups.push(members.length?{name:`AX1OM ${r.id}`,type:'fallback',proxies:members,url:'https://cp.cloudflare.com/generate_204',interval:300,timeout:8000,lazy:true,'max-failed-times':3}:{name:`AX1OM ${r.id}`,type:'select',proxies:['AX1OM GENERAL']});}
 groups.push({name:'AX1OM Infrastructure',type:'select',proxies:[...(s.privateNodes.azure?[NAMES.azure]:[]),'AX1OM GENERAL']});
 const target={DIRECT:'DIRECT',GENERAL:'AX1OM GENERAL',DOWNLOAD:'AX1OM DOWNLOAD',azure:s.privateNodes.azure?NAMES.azure:'AX1OM GENERAL','la-a':s.privateNodes['la-a']?NAMES['la-a']:'AX1OM GENERAL'};
 for(const r of supplemental)groups.push({name:`AX-${r.id.toUpperCase()}`,type:'select',proxies:[target[r.primary],'AX1OM ALL'].filter((v,i,a)=>a.indexOf(v)===i)});
 const managedRoots=new Set([...Object.values(SERVICE_DOMAINS).flat(),...Object.values(s.domains).flat()]);
 const legacyDirect=s.directRules.filter(r=>{const match=/^DOMAIN(?:-SUFFIX)?,([^,]+),DIRECT$/.exec(r);return !match||!managedRoots.has(match[1]);});
 const rules=[...BASE_DIRECT,...legacyDirect];
 for(const [id,roots] of Object.entries(SERVICE_DOMAINS))for(const d of roots)rules.push(`DOMAIN-SUFFIX,${d},AX-${id.toUpperCase()}`);
 for(const [key,id] of [['openai','openai'],['claude','anthropic'],['google','google'],['xai','xai'],['slack','slack']])for(const d of s.domains[key]||[])rules.push(`DOMAIN-SUFFIX,${d},AX1OM ${id}`);
 for(const d of ['apple.com','icloud.com','apple-cloudkit.com','mzstatic.com'])rules.push(`DOMAIN-SUFFIX,${d},AX-APPLE`);
 for(const d of ['microsoft.com','live.com','office.com','office.net','windowsupdate.com','azure.com'])rules.push(`DOMAIN-SUFFIX,${d},AX-MICROSOFT`);
 if(fs.existsSync(path.join(runtimeRoot,'Country.mmdb')))rules.push('GEOIP,CN,DIRECT');rules.push('MATCH,AX-CATCHALL');
 const doh='https://1.1.1.1/dns-query#AX1OM Infrastructure&disable-qtype-64=true&disable-qtype-65=true';
 return {'mixed-port':mixedPort,'bind-address':'127.0.0.1','allow-lan':false,mode:'rule','log-level':'info',ipv6:false,'external-controller-unix':socketPath,secret,'find-process-mode':'strict',profile:{'store-selected':true,'store-fake-ip':true},
  tun:{enable:true,stack:'mixed','auto-route':true,'auto-detect-interface':true,'dns-hijack':['any:53','tcp://any:53'],'strict-route':true,'route-exclude-address':['100.64.0.0/10','fd7a:115c:a1e0::/48']},
  dns:{enable:true,listen:`127.0.0.1:${dnsPort}`,ipv6:false,'enhanced-mode':'fake-ip','fake-ip-range':'198.18.0.1/16','fake-ip-filter':['*.lan','*.local','+.ts.net','+.tailscale.com','+.tailscale.io','+.tailscale.net'],'default-nameserver':['https://1.1.1.1/dns-query#disable-qtype-64=true&disable-qtype-65=true'],'nameserver':[doh,'https://8.8.8.8/dns-query#AX1OM Infrastructure&disable-qtype-64=true&disable-qtype-65=true'],'proxy-server-nameserver':['https://1.1.1.1/dns-query#disable-qtype-64=true&disable-qtype-65=true'],'nameserver-policy':{'+.ts.net':['100.100.100.100']},'respect-rules':true,'prefer-h3':false},
  proxies:Object.values(s.privateNodes),'proxy-providers':providers,'proxy-groups':groups,rules:[...new Set(rules)]};
}
function controllerForBuild() {
 const file=path.join(runtimeRoot,'controller.json');
 if(fs.existsSync(file)){const c=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof c.socketPath==='string'&&typeof c.secret==='string'&&c.secret.length>=24)return c;}
 const socketPath=path.join('/tmp',`ax1om-${process.getuid?.()||0}-${hash(root).slice(0,10)}.sock`);return {socketPath,secret:crypto.randomBytes(32).toString('hex')};
}
function build(input={}) {
 const s=loadStore();const c=ownedConfig(s,input);const configPath=path.join(runtimeRoot,'config.yaml');
 const stagePath=path.join(runtimeRoot,`config-stage-${crypto.randomBytes(6).toString('hex')}.yaml`);
 let validated=false;
 writeSecure(stagePath,YAML.stringify(c));
 try {
  const binary=process.env.AX1OM_MIHOMO_BINARY;
  if(binary){
   if(!path.isAbsolute(binary)||!fs.existsSync(binary))return {success:false,validated:false,configPath:null,message:'独立核心不可用于配置校验，保留原配置。'};
   const validationConfig=clone(c);
   for(const source of s.sources){const provider=c['proxy-providers'][source.id];const nodes=YAML.parse(fs.readFileSync(path.join(runtimeRoot,source.cachePath),'utf8')).proxies;for(const node of nodes)validationConfig.proxies.push({...node,name:provider.override['additional-prefix']+node.name});}
   writeSecure(stagePath,YAML.stringify(validationConfig));
   const checked=spawnSync(binary,['-t','-d',runtimeRoot,'-f',stagePath],{encoding:'utf8',timeout:30000,maxBuffer:512*1024,windowsHide:true});
   if(checked.error||checked.status!==0)return {success:false,validated:false,configPath:null,message:'独立配置校验未通过，保留原配置。'};
   validated=true;
   writeSecure(stagePath,YAML.stringify(c));
  }
  if(fs.existsSync(configPath))writeSecure(path.join(runtimeRoot,'config.previous.yaml'),fs.readFileSync(configPath));
  fs.renameSync(stagePath,configPath);fs.chmodSync(configPath,0o600);
  writeSecure(path.join(runtimeRoot,'controller.json'),JSON.stringify({'socketPath':c['external-controller-unix'],secret:c.secret}));
  return {...redact(s),validated,configPath,tunEnabled:true,providerCount:s.sources.length,groupCount:c['proxy-groups'].length,ruleCount:c.rules.length};
 }finally{try{fs.unlinkSync(stagePath);}catch{}}
}
async function run(input={}) {switch(input.action||'list'){case'list':return redact(loadStore());case'import':return importLegacy(input);case'add':return addSource(input);case'build':return build(input);default:throw Error('ACTION_INVALID');}}
module.exports={run,loadStore,saveStore,importLegacy,addSource,ownedConfig,safeNodes,parseSource,importDirect,convertPrivate,DEFAULT_DOMAINS};
if(require.main===module){let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{data+=d;if(data.length>8*1024*1024)process.exit(2);});process.stdin.on('end',async()=>{try{const result=await run(data.trim()?JSON.parse(data):{});process.stdout.write(JSON.stringify(result)+'\n');}catch{process.stdout.write(JSON.stringify({success:false,message:'订阅操作失败：输入、清单或来源不可用；原运行服务未更改。'})+'\n');}});}
