'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const compilerPath = path.resolve(__dirname, '../Sources/AX1OM/Resources/fleet-compiler.cjs');
const { providerFromProfile, compose, translateRules, applySupplemental, validateRoutes, validateSupplemental, DEFAULTS, SUPPLEMENTAL_DEFAULTS, NAMES } = require(compilerPath);
test('provider transforms only nodes and keeps profile policy isolated', () => {
  const source = { proxies:[{name:'fixture',type:'socks5',server:'127.0.0.1',port:9999}],rules:['MATCH,DIRECT'],dns:{enable:false},'proxy-groups':[] };
  const original = JSON.stringify(source);
  const p = providerFromProfile({uid:'test',name:'fixture',type:'remote',url:'https://example.invalid/private'}, source,'./providers/test.yaml');
  assert.deepEqual(Object.keys(p.cache),['proxies']); assert.equal(p.provider.type,'http');
  assert.equal(p.audit.sourceRulesImported,false); assert.equal(p.audit.sourceDNSImported,false);
  assert.equal(JSON.stringify(source),original); assert.ok(!JSON.stringify(p.audit).includes('https://'));
});
test('stable source identity survives node update and same source duplicates can be audited', () => {
  const profile={uid:'one',name:'Airport',type:'remote',url:'https://example.invalid/same'};
  const source={proxies:[{name:'first'}]};const a=providerFromProfile(profile,source,'./one');
  const b=providerFromProfile(profile,{proxies:[{name:'renamed'}]},'./one');
  const duplicate=providerFromProfile({...profile,uid:'two'},source,'./two');
  assert.equal(a.id,b.id); assert.notEqual(a.audit.nodeFingerprint,b.audit.nodeFingerprint);
  assert.equal(a.audit.sourceFingerprint,duplicate.audit.sourceFingerprint);assert.notEqual(a.id,duplicate.id);
});
test('target remap preserves direct exception order and DSH guards, unknown bridge goes infrastructure', () => {
  const rules=['AND,((IN-NAME,dsh-public-web),(IP-CIDR,127.0.0.0/8)),REJECT','DOMAIN-SUFFIX,tuxun.fun,DIRECT','DOMAIN-SUFFIX,tailscale.com,DIRECT','DOMAIN-SUFFIX,openai.com,GPT Google 本机专线','DOMAIN-SUFFIX,google.com,GPT Google 本机专线','DOMAIN-SUFFIX,slack.com,GPT Google 本机专线','DOMAIN-SUFFIX,unknown.example,GPT Google 本机专线','MATCH,Default Proxy'];
  const r=translateRules(rules,{openai:['openai.com'],google:['google.com'],slack:['slack.com']},DEFAULTS);
  assert.deepEqual(r.rules.slice(0,3),rules.slice(0,3)); assert.equal(r.rules[3],'DOMAIN-SUFFIX,openai.com,AX1OM openai');
  assert.equal(r.rules[4],'DOMAIN-SUFFIX,google.com,AX1OM google'); assert.equal(r.rules.at(-1),rules.at(-1));
  assert.equal(r.changes.length,4); assert.ok(r.rules.some(r=>r==='DOMAIN-SUFFIX,unknown.example,AX1OM Infrastructure'));
});
test('candidate disables production ingress while retaining DNS flags and MagicDNS policy', () => {
  const current={'mixed-port':7897,'external-controller':'127.0.0.1:9090',secret:'fixture',listeners:[{name:'dsh-public-web'}],tun:{enable:true},dns:{listen:'0.0.0.0:23453',nameserver:['https://1.1.1.1/dns-query#GPT Google 本机专线&disable-qtype-64=true&disable-qtype-65=true'],'nameserver-policy':{'+.test.ts.net':['127.0.0.1:15354#disable-qtype-65=true']}},proxies:[{name:'GPT Google 本机专线',type:'socks5',port:17899}],'proxy-groups':[{name:'Default Proxy',type:'select',proxies:['DIRECT']}],rules:['DOMAIN-SUFFIX,openai.com,GPT Google 本机专线','MATCH,Default Proxy']};
  const before=JSON.stringify(current);const nodes=Object.fromEntries(Object.keys(NAMES).map(id=>[id,{name:NAMES[id],type:'socks5',server:'127.0.0.1',port:9999}]));
  const {candidate}=compose(current,{openai:['openai.com']},DEFAULTS,nodes,[]);
  assert.equal(JSON.stringify(current),before);assert.equal(candidate.tun.enable,false);assert.equal(candidate['mixed-port'],18081);
  assert.equal(candidate['allow-lan'],false);assert.equal(candidate['bind-address'],'127.0.0.1');
  assert.ok(!('listeners' in candidate));assert.ok(!('secret' in candidate));assert.ok(!('external-controller' in candidate));
  assert.ok(candidate.dns.nameserver[0].includes('disable-qtype-64=true&disable-qtype-65=true'));
  assert.deepEqual(candidate.dns['nameserver-policy'],current.dns['nameserver-policy']);
  for(const r of DEFAULTS){const group=candidate['proxy-groups'].find(g=>g.name===`AX1OM ${r.id}`);assert.deepEqual(group.proxies,[NAMES[r.primary],NAMES.panda]);assert.ok(!group.proxies.includes('DIRECT'));}
});
test('route input rejects absent managed groups, unknown nodes and duplicate identities',()=>{
  assert.throws(()=>validateRoutes([])); assert.throws(()=>validateRoutes([...DEFAULTS.slice(0,4),DEFAULTS[0]]));
  assert.throws(()=>validateRoutes(DEFAULTS.map((r,i)=>i===0?{...r,primary:'airport-unverified'}:r)));
});
test('GENERAL and DOWNLOAD actually reference Providers and LAB stays isolated',()=>{
  const providers=['Glados_a','Glados_b','八戒','edgetunnel'].map((name,i)=>({id:`fixture-${i}`,provider:{type:'file',path:`./${i}.yaml`},audit:{name}}));
  const nodes=Object.fromEntries(Object.keys(NAMES).map(id=>[id,{name:NAMES[id],type:'socks5',server:'127.0.0.1',port:9999}]));
  const current={proxies:[],'proxy-groups':[{name:'Default Proxy',type:'select',proxies:['DIRECT']},{name:'Download',type:'select',proxies:['DIRECT']}],rules:['MATCH,Default Proxy']};
  const {candidate}=compose(current,{},DEFAULTS,nodes,providers);const g=n=>candidate['proxy-groups'].find(g=>g.name===n);
  assert.deepEqual(g('AX1OM GENERAL').use,['fixture-0','fixture-1']);
  assert.deepEqual(g('AX1OM DOWNLOAD').use,['fixture-0','fixture-1','fixture-2']);
  assert.deepEqual(g('Default Proxy').proxies,['AX1OM GENERAL']);assert.deepEqual(g('Download').proxies,['AX1OM DOWNLOAD']);
  assert.ok(!g('AX1OM GENERAL').use.includes('fixture-3'));assert.equal(g('AX1OM LAB Providers').proxies[0],'REJECT');
});
test('compiler has no production apply operation or child shell execution',()=>{
  const source=fs.readFileSync(compilerPath,'utf8'); assert.ok(!source.includes('/configs'));assert.ok(!source.includes('execSync'));
  assert.ok(!source.includes('systemsetup'));assert.ok(!source.includes('networksetup'));assert.ok(!source.includes('17899, '));
});
test('supplemental schema has nineteen unique specific services and a restricted exit list',()=>{
  assert.equal(SUPPLEMENTAL_DEFAULTS.length,19);assert.equal(new Set(SUPPLEMENTAL_DEFAULTS.map(r=>r.id)).size,19);
  assert.deepEqual(validateSupplemental(),SUPPLEMENTAL_DEFAULTS);
  assert.throws(()=>validateSupplemental(SUPPLEMENTAL_DEFAULTS.map(r=>r.id==='youtube'?{...r,primary:'panda'}:r)));
  assert.throws(()=>validateSupplemental([...SUPPLEMENTAL_DEFAULTS.slice(0,18),SUPPLEMENTAL_DEFAULTS[0]]));
  assert.equal(SUPPLEMENTAL_DEFAULTS.find(r=>r.id==='youtube').primary,'azure');
  assert.equal(SUPPLEMENTAL_DEFAULTS.find(r=>r.id==='fcm').primary,'azure');
});
test('Youtube and FCM precede broad Google while DSH/direct guards and original Google policy stay',()=>{
  const rules=['AND,((IN-NAME,dsh-public-web),(IP-CIDR,127.0.0.0/8)),REJECT','DOMAIN-SUFFIX,tuxun.fun,DIRECT','DOMAIN-SUFFIX,petalmaps.com,DIRECT','DOMAIN-SUFFIX,tailscale.com,DIRECT','DOMAIN-SUFFIX,google.com,AX1OM google','DOMAIN-SUFFIX,googleapis.com,AX1OM google','DOMAIN-SUFFIX,openai.com,AX1OM openai','MATCH,Default Proxy'];
  const result=applySupplemental(rules,SUPPLEMENTAL_DEFAULTS,{google:['google.com','googleapis.com'],openai:['openai.com']});
  assert.deepEqual(result.rules.slice(0,4),rules.slice(0,4));
  assert.ok(result.rules.findIndex(r=>r.includes('youtube.com'))<result.rules.indexOf(rules[4]));
  assert.ok(result.rules.findIndex(r=>r.includes('fcm.googleapis.com'))<result.rules.indexOf(rules[5]));
  assert.ok(result.rules.includes(rules[6]));assert.equal(result.rules.at(-1),'MATCH,AX-CATCHALL');
  assert.equal(result.rules.filter(r=>r.startsWith('MATCH,')).length,1);
  assert.ok(!result.added.some(r=>/(?:DOMAIN-SUFFIX,)(openai\.com|slack\.com|x\.com)\)/.test(r)));
});
test('specific service remap deduplicates rules and only remaps observed system/download policies',()=>{
  const rules=['DOMAIN-SUFFIX,netflix.com,Streaming','DOMAIN-SUFFIX,netflix.com,Streaming','DOMAIN-SUFFIX,apple.com,Apple','DOMAIN-SUFFIX,live.com,Microsoft','DOMAIN-SUFFIX,example-download.invalid,Download','DOMAIN-SUFFIX,unknown-business.invalid,Research + AI','MATCH,Default Proxy','MATCH,Default Proxy'];
  const r=applySupplemental(rules,SUPPLEMENTAL_DEFAULTS,{});
  assert.equal(new Set(r.rules).size,r.rules.length);assert.equal(r.rules.filter(r=>r.includes('DOMAIN-SUFFIX,netflix.com)')).length,1);
  assert.ok(r.rules.includes('DOMAIN-SUFFIX,apple.com,AX-APPLE'));assert.ok(r.rules.includes('DOMAIN-SUFFIX,live.com,AX-MICROSOFT'));
  assert.ok(r.rules.includes('DOMAIN-SUFFIX,example-download.invalid,AX-DOWNLOAD'));
  assert.ok(r.rules.includes('DOMAIN-SUFFIX,unknown-business.invalid,Research + AI'));
  assert.ok(!r.added.some(r=>r.includes('apple.com')||r.includes('live.com')));
});
test('nineteen service choices compile to a single safe target with no default Panda and no cycles',()=>{
  const current={proxies:[],'proxy-groups':[{name:'Default Proxy',type:'select',proxies:['DIRECT']}],rules:['MATCH,Default Proxy']};
  const nodes=Object.fromEntries(Object.keys(NAMES).map(id=>[id,{name:NAMES[id],type:'socks5',server:'127.0.0.1',port:9999}]));
  const custom=SUPPLEMENTAL_DEFAULTS.map(r=>r.id==='youtube'?{...r,primary:'GENERAL'}:r);
  const {candidate}=compose(current,{},DEFAULTS,nodes,[],custom);
  const groups=candidate['proxy-groups'].filter(g=>g.name.startsWith('AX-'));
  assert.equal(groups.length,19);for(const g of groups){assert.equal(g.proxies.length,1);assert.ok(!g.proxies.includes(NAMES.panda));assert.ok(!g.proxies.includes(g.name));}
  assert.deepEqual(groups.find(g=>g.name==='AX-YOUTUBE').proxies,['AX1OM GENERAL']);
  assert.deepEqual(groups.find(g=>g.name==='AX-BILIBILI').proxies,['DIRECT']);
});
