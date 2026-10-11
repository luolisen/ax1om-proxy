'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../../Sources/AX1OM/Resources/native-bridge.cjs');

test('service matching respects hostname boundaries', () => {
  for (const host of ['api.anthropic.com', 'claude.ai', 'files.claudeusercontent.com']) assert.equal(bridge.classify(host), 'claude');
  for (const host of ['chatgpt.com', 'api.openai.com', 'cdn.oaistatic.com']) assert.equal(bridge.classify(host), 'gpt');
  for (const host of ['drive.google.com', 'generativelanguage.googleapis.com', 'lh3.googleusercontent.com']) assert.equal(bridge.classify(host), 'google');
  assert.equal(bridge.classify('grok.com'), 'xai');
  assert.equal(bridge.classify('files.slack.com'), 'slack');
  for (const host of ['evilclaude.ai', 'anthropic.com.evil.net', 'notgoogle.com', 'slack.com.bad.test', 'x.com.evil.net']) assert.equal(bridge.classify(host), 'other');
});
test('explicit domains win over process hints', () => {
  assert.equal(bridge.classify('api.openai.com', 'Claude'), 'gpt');
  assert.equal(bridge.classify('1.2.3.4', 'Claude Helper (Renderer)'), 'claude');
  assert.equal(bridge.classify('', '/Applications/Claude.app/Contents/MacOS/Claude'), 'claude');
  assert.equal(bridge.classify('example.net', 'Claude'), 'other');
  assert.equal(bridge.classify('1.2.3.4', 'not-Claude'), 'other');
});
test('credential fields, bearer headers, node links, full URLs are redacted', () => {
  bridge.collectSecrets({ uuid: 'fixture-auth-id', password: 'fixture-password', 'public-key': 'fixture-pubkey' });
  const input = { uuid: 'fixture-auth-id', detail: 'fixture-password fixture-pubkey Bearer abc123 https://example.test/sub?token=private vless://id@example.test:123', password: 'another', public_key: 'key' };
  const rendered = JSON.stringify(bridge.sanitize(input));
  for (const secret of ['fixture-auth-id', 'fixture-password', 'fixture-pubkey', 'abc123', 'example.test', 'another']) assert.ok(!rendered.includes(secret), secret);
  assert.ok(rendered.includes('已隐藏'));
});
test('connection display preserves real chain and safe unique stable identity', () => {
  const input = { id: '11111111-1111-1111-1111-111111111111', metadata: { host: 'api.anthropic.com', process: 'Claude', network: 'tcp' }, chains: ['Panda', 'AI-Anthropic'], upload: 42, download: 73 };
  const record = bridge.sanitize(bridge.connection(input));
  assert.equal(record.service, 'claude');
  assert.deepEqual(record.chains, input.chains);
  assert.equal(record.id, bridge.connection(input).id);
  assert.notEqual(record.id, bridge.connection({ ...input, id: '22222222-2222-2222-2222-222222222222' }).id);
  assert.ok(!record.id.includes('11111111'));
});
test('default snapshot adapter still refuses every mutating endpoint before network access', () => {
  assert.throws(() => bridge.request('/nonexistent', '/configs?force=true', null, {payload:'x'}), /READ_ONLY_ENDPOINT/);
  assert.throws(() => bridge.request('/nonexistent', '/', null, {method:'action',arg:'restart'}), /READ_ONLY_METHOD/);
  assert.throws(() => bridge.request('/nonexistent', '/providers/proxies/example/healthcheck', null), /READ_ONLY_ENDPOINT/);
});
test('remote error bodies never surface in user-facing errors', () => {
  assert.equal(bridge.safeError('测试', Error('Bearer private credential bad response')), '测试：读取失败');
  assert.equal(bridge.safeError('测试', Error('HTTP_403')), '测试：HTTP_403');
});
test('private package caps preserve decimal GB and unknown Azure quota', () => {
  assert.equal(bridge.privateTrafficCap('panda'), 200 * 1_000_000_000);
  assert.equal(bridge.privateTrafficCap('la-a'), 1000 * 1_000_000_000);
  assert.equal(bridge.privateTrafficCap('azure'), null);
  assert.equal(bridge.privateTrafficCap('unknown'), null);
});
test('own imported nodes never inherit a quota from their routing slot', () => {
  const runtime={proxies:[{name:'AX1OM Los Angeles A',type:'vless',server:'192.0.2.1'}]};
  assert.equal(bridge.ownedRuntimeNodes(runtime,{},false)[0].trafficCapBytes,null);
  assert.equal(bridge.ownedRuntimeNodes(runtime,{},false,{'la-a':50_000_000_000})[0].trafficCapBytes,50_000_000_000);
  assert.equal(bridge.privateTrafficCap('panda',{panda:-1}),null);
});
test('runtime groups preserve exact membership, selected node and cached health', () => {
  const proxies = {
    'AI-Anthropic': { type: 'Selector', now: 'LA A', all: ['LA A', 'Panda', 'missing'] },
    'Default Proxy': { type: 'Selector', now: 'DIRECT', all: ['DIRECT', 'LA A'] },
    'AUTO': { type: 'URLTest', now: 'Panda', all: ['LA A', 'Panda'] },
    'LA A': { type: 'VLESS', alive: false, udp: true, history: [{ time: 'past', delay: 57 }] },
    'Panda': { type: 'VLESS', history: [] },
    'DIRECT': { type: 'Direct', udp: true },
    'REJECT': { type: 'Reject' }
  };
  const groups = bridge.groupSummaries({ proxies }, ['AI-Anthropic', 'AUTO', 'Default Proxy']);
  assert.deepEqual(groups.map(g => g.name), ['Default Proxy', 'AI-Anthropic', 'AUTO']);
  const claude = groups[1];
  assert.equal(claude.selected, 'LA A');
  assert.deepEqual(claude.members.map(m => m.name), ['LA A', 'Panda', 'missing']);
  assert.equal(claude.members[0].state, '缓存记录不可达');
  assert.equal(claude.members[0].delayMs, 57);
  assert.equal(claude.members[0].udp, true);
  assert.equal(claude.members[1].delayMs, null);
  assert.equal(claude.members[2].state, '成员信息不可读取');
  assert.equal(claude.members[2].udp, null);
  assert.equal(new Set(groups.flatMap(g => g.members.map(m => m.id))).size, groups.flatMap(g => g.members).length);
});
test('absent group data remains an empty observed list', () => {
  assert.deepEqual(bridge.groupSummaries(), []);
});
test('cached subscription quota requires valid counters and hides known EdgeTunnel placeholders', () => {
  const valid = bridge.profileQuota({ name: 'fixture', extra: { upload: 20, download: 30, total: 100 } });
  assert.equal(valid.usedBytes, 50);
  assert.equal(valid.totalBytes, 100);
  assert.ok(valid.detail.includes('非实时'));
  assert.equal(bridge.profileQuota({ extra: { upload: 20, total: 100 } }).usedBytes, null);
  assert.equal(bridge.profileQuota({ extra: { upload: '20', download: 30, total: 100 } }).usedBytes, null);
  assert.equal(bridge.profileQuota({ extra: { upload: 20, download: 30, total: 0 } }).totalBytes, null);
  assert.equal(bridge.profileQuota({ extra: { upload: -1, download: 30, total: 100 } }).usedBytes, null);
  const placeholder = bridge.profileQuota({ name: 'edgetunnel', extra: { upload: 1102, download: 0, total: 102400, expire: 4102329600 } });
  assert.equal(placeholder.usedBytes, null);
  assert.equal(placeholder.totalBytes, null);
});
test('connection identities include controller source without exposing native UUID',()=>{
  const input={id:'fixture-connection-one',metadata:{host:'api.openai.com'}};
  assert.match(bridge.connection(input,'mihomo').id,/^connection-mihomo-[a-f0-9]{20}$/);
  assert.match(bridge.connection(input,'core').id,/^connection-core-[a-f0-9]{20}$/);
  assert.notEqual(bridge.connection(input,'mihomo').id,bridge.connection(input,'core').id);
});
test('explicit close rechecks a single connection and deletes only the matched native ID',async()=>{
  const target={id:'fixture-one',metadata:{host:'api.openai.com'}},other={id:'fixture-two',metadata:{host:'claude.ai'}};
  const calls=[]; const backend={fixture:true};
  const result=await bridge.closeConnection({id:bridge.connection(target,'core').id},{
    getBackend:source=>{assert.equal(source,'core');return backend;},
    controller:async (received,method,id)=>{assert.equal(received,backend);calls.push({method,id});return method==='GET'?{connections:[target,other]}:{closed:true};}
  });
  assert.equal(result.success,true);assert.deepEqual(calls,[{method:'GET',id:undefined},{method:'DELETE',id:'fixture-one'}]);
});
test('expired and ambiguous displayed IDs never cause a DELETE',async()=>{
  const target={id:'fixture-expired'}, calls=[];
  const dependencies={getBackend:()=>({}),controller:async(_backend,method)=>{calls.push(method);return {connections:[]};}};
  const result=await bridge.closeConnection({id:bridge.connection(target).id},dependencies);
  assert.equal(result.success,false);assert.ok(result.message.includes('已结束'));assert.deepEqual(calls,['GET']);
  calls.length=0; dependencies.controller=async(_backend,method)=>{calls.push(method);return {connections:[target,target]};};
  assert.equal((await bridge.closeConnection({id:bridge.connection(target).id},dependencies)).success,false);assert.deepEqual(calls,['GET']);
});
test('display ID injection and malformed native IDs are rejected before mutation',async()=>{
  const invalid=['../connections','connection-mihomo-'+ '0'.repeat(20)+'/..','connection-core-'+ '0'.repeat(20)+'?all=true','connection-'+ '0'.repeat(20),'x'.repeat(97),null,123];
  for(const id of invalid){let called=false;const result=await bridge.closeConnection({id},{getBackend:()=>{called=true;throw Error('should not execute');}});assert.equal(result.success,false);assert.equal(called,false);}
  const target={id:'../configs?force=true'},calls=[];
  const result=await bridge.closeConnection({id:bridge.connection(target).id},{getBackend:()=>({}),controller:async(_b,method)=>{calls.push(method);return {connections:[target]};}});
  assert.equal(result.success,false);assert.deepEqual(calls,['GET']);
  assert.throws(()=>bridge.connectionControllerRequest({socketPath:'/nonexistent'},'DELETE'),/INVALID_CONNECTION_ID/);
  assert.throws(()=>bridge.connectionControllerRequest({socketPath:'/nonexistent'},'PUT','one'),/SINGLE_CONNECTION_ONLY/);
  assert.throws(()=>bridge.connectionControllerRequest({socketPath:'/nonexistent'},'GET','one'),/SINGLE_CONNECTION_ONLY/);
});
test('HTTP mock accepts 200 or 204 only, preserves one endpoint, and hides error bodies',async t=>{
  const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ax1om-close-test-'));
  const socket=path.join(directory,'controller.sock');const target={id:'fixture-http-one',metadata:{host:'example.test'}};
  let responseCode=204;const requests=[];
  const server=http.createServer((req,res)=>{
    requests.push({method:req.method,path:req.url,auth:req.headers.authorization});
    if(req.method==='GET' && req.url==='/connections'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({connections:[target]}));}
    if(req.method==='DELETE' && req.url==='/connections/fixture-http-one'){res.writeHead(responseCode);return res.end(responseCode===204?'':'Bearer secret-error credential body');}
    res.writeHead(500);res.end('unexpected endpoint');
  });
  await new Promise(resolve=>server.listen(socket,resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  const dependencies={getBackend:()=>({socketPath:socket,secret:'fixture-controller-token'})};
  for(const status of [204,200,401,403,404,429,500]){
    responseCode=status;const result=await bridge.closeConnection({id:bridge.connection(target).id},dependencies);
    assert.equal(result.success,[200,204].includes(status));assert.ok(!JSON.stringify(result).includes('secret-error'));
    if(status===404)assert.ok(result.message.includes('已结束'));
  }
  assert.equal(requests.length,14);
  for(let i=0;i<requests.length;i+=2){assert.equal(requests[i].method,'GET');assert.equal(requests[i].path,'/connections');assert.equal(requests[i+1].method,'DELETE');assert.equal(requests[i+1].path,'/connections/fixture-http-one');}
  assert.ok(requests.every(r=>r.auth==='Bearer fixture-controller-token'));
  assert.ok(!requests.some(r=>r.method==='DELETE' && r.path==='/connections'));
});
test('CLI invalid close input is a safe JSON result with no snapshot or network lookup',()=>{
  const {spawnSync}=require('node:child_process'),path=require('node:path');
  const bridgeFile=path.resolve(__dirname,'../../Sources/AX1OM/Resources/native-bridge.cjs');
  for(const input of ['not json',JSON.stringify({id:'../../connections'}),'x'.repeat(3000)]){
    const result=spawnSync(process.execPath,[bridgeFile,'--close-connection'],{input,encoding:'utf8',timeout:3000});
    assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(JSON.parse(result.stdout).success,false);
    assert.ok(!result.stdout.includes('connections'));
  }
});
test('standalone private node IDs and traffic caps survive migration without live controller',()=>{
 const runtime={proxies:[{name:'AX1OM Azure West US',type:'vless',server:'192.0.2.1'},{name:'AX1OM Los Angeles A',type:'vless',server:'192.0.2.2'},{name:'AX1OM Panda Backup',type:'vless',server:'192.0.2.3'},{name:'Custom',type:'ss',server:'192.0.2.4'}]};
 const nodes=bridge.ownedRuntimeNodes(runtime,{},false,{'la-a':1000000000000,panda:200000000000});assert.deepEqual(nodes.slice(0,3).map(n=>n.id),['azure','la-a','panda']);assert.ok(nodes.slice(0,3).every(n=>n.source==='自建专线'));assert.equal(nodes[0].trafficCapBytes,null);assert.equal(nodes[1].trafficCapBytes,1000000000000);assert.equal(nodes[2].trafficCapBytes,200000000000);assert.equal(nodes[3].source,'AX1OM');assert.ok(nodes.every(n=>n.state==='配置已读取'));
});
test('standalone TUN status is actual controller evidence, never configured intent',()=>{
 const runtime={tun:{enable:true}};
 assert.equal(bridge.observedTUN({},runtime,false,true),false);
 assert.equal(bridge.observedTUN({tun:{enable:false}},runtime,true,true),false);
 assert.equal(bridge.observedTUN({tun:{enable:true}},runtime,true,true),true);
 assert.equal(bridge.observedTUN({},runtime,true,true),null);
});

test('node accounting resolves actual leaf rather than selected policy or service', () => {
  const proxies = {proxies:{'AX1OM openai':{all:['AX1OM Los Angeles A','AX1OM Panda Backup']},'AX1OM Los Angeles A':{type:'VLESS'},'AX1OM Panda Backup':{type:'VLESS'},DIRECT:{type:'Direct'}}};
  const nodes=[{id:'la-a',name:'AX1OM Los Angeles A'},{id:'panda',name:'AX1OM Panda Backup'}];
  let record=bridge.connection({chains:['AX1OM Panda Backup','AX1OM openai']},'ax1om',proxies,nodes);
  assert.equal(record.nodeID,'panda'); assert.equal(record.nodeName,'潘达');
  assert.equal(bridge.connection({chains:['AX1OM openai']},'ax1om',proxies,nodes).nodeID,null);
  assert.equal(bridge.connection({chains:['AX1OM Los Angeles A','AX1OM Panda Backup']},'ax1om',proxies,nodes).nodeID,null);
  assert.equal(bridge.connection({chains:['DIRECT']},'ax1om',proxies,nodes).nodeName,'直连');
});
