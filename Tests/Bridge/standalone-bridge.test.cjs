'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const bridgePath = path.resolve(__dirname,'../../Sources/AX1OM/Resources/native-bridge.cjs');
function run(env, args=[],input='') {return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[bridgePath,...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let output='';let error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,error);resolve(JSON.parse(output));}catch(e){reject(e);}});child.stdin.end(input);});}
test('empty home and absent optional legacy software yield a valid empty snapshot',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ax1om-empty-'));
 try{const value=await run({AX1OM_HOME:home,AX1OM_STATE_ROOT:path.join(home,'state')});assert.equal(value.mihomoRunning,false);assert.deepEqual(value.connections,[]);assert.deepEqual(value.nodes,[]);assert.deepEqual(value.providers,[]);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('own controller supplies connections, Providers and nodes without installed Verge or Relay',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ax1om-own-'));const root=path.join(home,'state');const runtime=path.join(root,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const native='fixture-own-id';const secret='fixture-control-secret';const received=[];
 const server=http.createServer((req,res)=>{received.push(req.method+' '+req.url);if(req.headers.authorization!=='Bearer '+secret){res.writeHead(401).end();return;}
 const values={'/configs':{mode:'rule',tun:{enable:false}},'/connections':{uploadTotal:10,downloadTotal:20,connections:[{id:native,metadata:{host:'claude.ai',network:'tcp'},chains:['AI-Claude','Own Node']}]},'/proxies':{proxies:{'AI-Claude':{type:'Selector',all:['Own Node'],now:'Own Node'},'Own Node':{type:'VLESS',history:[{delay:42}]}}},'/providers/proxies':{providers:{Example:{type:'Proxy',vehicleType:'File',proxies:[{name:'Provider Node',type:'Shadowsocks',history:[{delay:80}]}]}}}};
 if(req.method==='DELETE'&&req.url==='/connections/'+native){res.writeHead(204).end();return;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(values[req.url]||{}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 fs.writeFileSync(path.join(runtime,'config.yaml'),'mode: rule\nproxies:\n  - name: Own Node\n    type: vless\n    server: 192.0.2.1\nproxy-groups:\n  - name: AI-Claude\n    type: select\n    proxies: [Own Node]\n');
 fs.writeFileSync(path.join(runtime,'controller.json'),JSON.stringify({host:'127.0.0.1',port:server.address().port,secret}));
 try{const env={AX1OM_HOME:home,AX1OM_STATE_ROOT:root};const value=await run(env);assert.equal(value.mihomoRunning,true);assert.equal(value.activeProfile,'AX1OM Providers');assert.equal(value.mode,'rule · AX1OM');assert.equal(value.connections.length,1);assert.match(value.connections[0].id,/^connection-ax1om-/);assert.equal(value.providers[0].name,'Example');assert.ok(value.nodes.some(n=>n.name==='Provider Node'));assert.ok(value.nodes.some(n=>n.name==='Own Node'));assert.ok(!JSON.stringify(value).includes(secret));const closed=await run(env,['--close-connection'],JSON.stringify({id:value.connections[0].id}));assert.equal(closed.success,true);assert.deepEqual(received.filter(x=>x.startsWith('DELETE')),['DELETE /connections/'+native]);}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(home,{recursive:true,force:true});}
});
test('own config never falls back to legacy controller when own metadata is absent',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ax1om-broken-'));const root=path.join(home,'state');fs.mkdirSync(path.join(root,'runtime'),{recursive:true});fs.writeFileSync(path.join(root,'runtime/config.yaml'),'mode: rule\n');
 try{const value=await run({AX1OM_HOME:home,AX1OM_STATE_ROOT:root});assert.equal(value.mihomoRunning,false);assert.equal(value.activeProfile,'AX1OM Providers');assert.equal(value.mode,'rule · AX1OM');assert.deepEqual(value.connections,[]);}finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('prepared but stopped owned socket is a normal idle state',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ax1om-idle-'));const root=path.join(home,'state');const runtime=path.join(root,'runtime');fs.mkdirSync(runtime,{recursive:true});
 fs.writeFileSync(path.join(runtime,'config.yaml'),'mode: rule\n');
 fs.writeFileSync(path.join(runtime,'controller.json'),JSON.stringify({socketPath:path.join(home,'idle.sock'),secret:'fixture-secret'}));
 try {const value=await run({AX1OM_HOME:home,AX1OM_STATE_ROOT:root});assert.equal(value.mihomoRunning,false);assert.deepEqual(value.errors,[]);}
 finally {fs.rmSync(home,{recursive:true,force:true});}
});
