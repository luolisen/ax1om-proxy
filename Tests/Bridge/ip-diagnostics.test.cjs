'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const diagnostics = require('../../Sources/AX1OM/Resources/ip-diagnostics.cjs');
const trace = host => `h=${host}\nip=198.51.100.8\nloc=US\ncolo=TEST\ntls=TLSv1.3\n`;

test('system proxy is discovered rather than inferred from a known port', () => {
  const proxy = diagnostics.parseSystemProxy('HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 12345\n');
  assert.equal(proxy.proxyURL, 'http://127.0.0.1:12345');
  assert.equal(proxy.proxyPort, 12345);
  assert.equal(diagnostics.parseSystemProxy('ProxyAutoConfigEnable : 1\n').supported, false);
  assert.equal(diagnostics.parseSystemProxy('HTTPSEnable : 1\nHTTPSProxy : user:secret@host\nHTTPSPort : 7897\n').supported, false);
  const transparent = diagnostics.parseSystemProxy('HTTPSEnable : 0\nHTTPEnable : 0\n');
  assert.equal(transparent.proxyURL, null);
  assert.ok(transparent.detail.includes('透明代理'));
});
test('trace must contain a valid IP and the actual requested hostname', () => {
  assert.equal(diagnostics.parseTrace(trace('claude.ai'), 'claude.ai').ip, '198.51.100.8');
  assert.throws(() => diagnostics.parseTrace('<html>198.51.100.8</html>', 'claude.ai'));
  assert.throws(() => diagnostics.parseTrace(trace('unrelated.test'), 'claude.ai'));
  assert.throws(() => diagnostics.parseTrace('h=claude.ai\nip=not-an-ip'));
  assert.equal(diagnostics.parsePing0('198.51.100.9\n'), '198.51.100.9');
  assert.equal(diagnostics.parsePing0('<title>198.51.100.9-查询结果</title><a href="https://ping0.cc/trace/198.51.100.9">trace</a>'), '198.51.100.9');
  assert.throws(() => diagnostics.parsePing0('<html>198.51.100.9</html>'));
});
test('IPIP SSR JSON is selected safely without executing site JavaScript', () => {
  const body = '<script>window.__IPINFO__={"ip":"198.51.100.9","city":"Test","asn":{"asn":"AS123","name":"Fixture"},"abuse":{"email":"do-not-display@example.test"}};</script>';
  const result = diagnostics.parseIPIP(body);
  assert.equal(result.ip, '198.51.100.9');
  assert.equal(result.asn, 'AS123');
  assert.equal(result.abuse, undefined);
  assert.throws(() => diagnostics.parseIPIP('<html>verification required</html>'));
  assert.equal(diagnostics.parseIPIP(body.replace(';</script>', ';window.__OTHER__={"unrelated":true};</script>')).ip, '198.51.100.9');
  assert.equal(diagnostics.extractAssignedJSON('window.__IPINFO__={"ip":"198.51.100.9","x":"} escaped\\\" quote"};sideEffect()', 'window.__IPINFO__').ip, '198.51.100.9');
});
test('missing or invalid risk scores remain null instead of defaulting to zero', () => {
  assert.equal(diagnostics.parseRisk({ ip: '198.51.100.8' }, '198.51.100.8').score, null);
  assert.equal(diagnostics.parseRisk({ ip: '198.51.100.8', trust_score: 0 }, '198.51.100.8').score, 0);
  assert.equal(diagnostics.parseRisk({ ip: '198.51.100.8', trust_score: '85' }, '198.51.100.8').score, null);
  assert.equal(diagnostics.parseRisk({ ip: '198.51.100.8', trust_score: 101 }, '198.51.100.8').score, null);
  assert.throws(() => diagnostics.parseRisk('not json', '198.51.100.8'));
});
test('subnet sample scores are explicitly scoped, unrelated IPs are rejected', () => {
  const result = diagnostics.parseRisk({ ip: '198.51.100.20', cidr: '198.51.100.0/24', trust_score: 71 }, '198.51.100.8');
  assert.equal(result.scope, '同网段样本参考');
  assert.ok(result.detail.includes('不能当成目标 IP 的精确评分'));
  assert.throws(() => diagnostics.parseRisk({ ip: '203.0.113.1', trust_score: 80 }, '198.51.100.8'));
  assert.equal(diagnostics.ipv4InCIDR('198.51.100.8', '198.51.100.0/24'), true);
  assert.equal(diagnostics.ipv4InCIDR('203.0.113.1', '198.51.100.0/24'), false);
});
test('DNS listener is restricted to the actual local address and port', () => {
  assert.deepEqual(diagnostics.parseDNSListener('0.0.0.0:32123'), { host: '127.0.0.1', port: 32123 });
  assert.deepEqual(diagnostics.parseDNSListener('[::]:53'), { host: '::1', port: 53 });
  assert.equal(diagnostics.parseDNSListener('8.8.8.8:53'), null);
  assert.equal(diagnostics.parseDNSListener('192.168.1.1:53'), null);
  assert.equal(diagnostics.parseDNSListener('127.0.0.1:0'), null);
  assert.equal(diagnostics.parseDNSListener(undefined), null);
});
test('DNS packet uses requested 64/65 type and parses real response header only', () => {
  const packet = diagnostics.dnsQueryPacket('claude.ai', 65, 1234);
  assert.equal(packet.readUInt16BE(packet.length - 4), 65);
  const response = Buffer.alloc(12); response.writeUInt16BE(1234); response.writeUInt16BE(0x8180, 2); response.writeUInt16BE(0, 6);
  assert.deepEqual(diagnostics.parseDNSResponse(response, 1234), { rcode: 0, answerCount: 0, state: 'NOERROR' });
  assert.throws(() => diagnostics.parseDNSResponse(response, 9999));
  assert.throws(() => diagnostics.dnsQueryPacket('claude.ai', 255, 1234));
});
test('HTML HTTPS success cannot become a fabricated Claude exit', async () => {
  const result = await diagnostics.runDiagnostics({ proxy: { supported: true, proxyURL: null, state: 'fixture', detail: 'fixture' }, dnsConfig: { listener: null, detail: 'fixture unavailable' }, fetch: async url => ({ status: 200, latencyMs: 25, body: url.includes('cloudflare') ? trace('www.cloudflare.com') : '<html>ok</html>', receivedBytes: 20 }) });
  assert.equal(result.exits.find(e => e.id === 'claude').ip, null);
  assert.equal(result.score, null);
  assert.equal(result.availability.find(a => a.label === 'claude.ai').state, 'HTTPS 可达');
  assert.equal(result.webrtc.state, '未实测');
  assert.equal(result.dns.state, '未实测');
});
test('PAC prevents guessing the network path and causes no HTTP requests', async () => {
  let calls = 0;
  const result = await diagnostics.runDiagnostics({ proxy: { supported: false, state: '路径未确认', detail: 'PAC', proxyURL: null }, dnsConfig: { listener: null, detail: 'no listener' }, fetch: async () => { calls++; throw Error('should not fetch'); } });
  assert.equal(calls, 0);
  assert.equal(result.exits.every(e => e.ip === null), true);
});
test('local DNS NODATA and IPv6 failure do not prove global prevention', async () => {
  const result = await diagnostics.runDiagnostics({ proxy: { supported: true, state: 'fixture', detail: 'fixture', proxyURL: null }, dnsConfig: { listener: { host: '127.0.0.1', port: 32123 }, detail: 'explicit fixture listener' },
    fetch: async () => { throw Error('fixture'); }, dnsQuery: async (_listener, host, type) => ({ host, type, state: 'NOERROR', rcode: 0, answerCount: type === 1 ? 1 : 0 }) });
  assert.equal(result.dnsProbe.length, 6);
  assert.ok(result.checks.find(c => c.id === 'dns-records').detail.includes('不自动等于全网过滤'));
  assert.equal(result.checks.find(c => c.id === 'ipv6').state, '未确认');
});
test('running standalone diagnostics use owned mixed port instead of an old system proxy',async()=>{
 let systemReads=0;const result=await diagnostics.readDiagnosticPath({own:true,runtime:{'mixed-port':18081,dns:{listen:'127.0.0.1:18082'}},controller:{socketPath:'/tmp/fixture.sock',secret:'fixture'},readController:async(_controller,endpoint)=>{assert.equal(endpoint,'/configs');return {'mixed-port':28181,tun:{enable:false}};},readSystem:async()=>{systemReads++;return {proxyURL:'http://127.0.0.1:7897'};}});
 assert.equal(systemReads,0);assert.equal(result.proxy.proxyURL,'http://127.0.0.1:28181');assert.equal(result.proxy.state,'AX1OM 独立核心');assert.deepEqual(result.dnsConfig.listener,{host:'127.0.0.1',port:18082});assert.ok(!result.proxy.detail.includes('7897'));
});
test('stopped standalone diagnostics label the current system path and do not probe inactive owned DNS',async()=>{
 const result=await diagnostics.readDiagnosticPath({own:true,runtime:{'mixed-port':18081,dns:{listen:'127.0.0.1:18082'}},controller:{socketPath:'/tmp/fixture.sock',secret:'fixture'},readController:async()=>{throw Error('ECONNREFUSED');},readSystem:async()=>({supported:true,proxyURL:'http://127.0.0.1:7897',state:'system',detail:'系统代理'})});
 assert.equal(result.proxy.proxyURL,'http://127.0.0.1:7897');assert.equal(result.proxy.state,'当前网络 · AX1OM 未运行');assert.equal(result.dnsConfig.listener,null);assert.ok(result.proxy.detail.includes('当前系统网络'));
});
