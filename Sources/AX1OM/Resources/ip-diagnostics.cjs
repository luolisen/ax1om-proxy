'use strict';
// Manual, bounded diagnostics only. No proxy writes, account cookies, SSH,
// subscription updates, fingerprint spoofing or production core actions.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const SOURCES = {
  ping0: 'https://ping0.cc/', ipip: 'https://ipip.la/',
  cloudflare: 'https://www.cloudflare.com/cdn-cgi/trace',
  claude: 'https://claude.ai/cdn-cgi/trace', anthropic: 'https://www.anthropic.com/',
  netcoffee: 'https://ip.net.coffee/claude/',
  risk: 'https://ip.net.coffee/api/iprisk/', geo: 'https://ip.net.coffee/api/geoip/',
  dns: 'https://ip.net.coffee/dns/', webrtc: 'https://ip.net.coffee/webrtc/'
};

function parseSystemProxy(text) {
  const number = key => Number(String(text).match(new RegExp('^\\s*' + key + '\\s*:\\s*(\\d+)\\s*$', 'm'))?.[1] || 0);
  const string = key => String(text).match(new RegExp('^\\s*' + key + '\\s*:\\s*([^\\n]+)', 'm'))?.[1]?.trim() || '';
  if (number('ProxyAutoConfigEnable') || number('ProxyAutoDiscoveryEnable')) return { supported: false, state: '路径未确认', detail: '系统启用了 PAC/自动发现；未解析其逐目标代理决策，因此本轮不猜测出口、不发起公网检测。', proxyURL: null };
  for (const [prefix, scheme, kind] of [['HTTPS', 'http', '系统 HTTPS 代理'], ['HTTP', 'http', '系统 HTTP 代理（诊断显式复用）'], ['SOCKS', 'socks5h', '系统 SOCKS 代理']]) {
    const host = string(prefix + 'Proxy'), port = number(prefix + 'Port');
    if (!number(prefix + 'Enable')) continue;
    if (!/^[A-Za-z0-9.:[\]-]+$/.test(host) || !host || port < 1 || port > 65535) return { supported: false, state: '路径未确认', detail: '系统代理地址格式不可安全读取；未猜测端口。', proxyURL: null };
    const authority = net.isIP(host) === 6 && !host.startsWith('[') ? '[' + host + ']' : host;
    return { supported: true, state: '显式使用现有代理', detail: `${kind} ${host}:${port}；本轮 curl 显式使用此入口，不改变系统设置。底层 TUN/物理路由未验证，各目标可能匹配不同分流。`, proxyKind: kind, proxyHost: host, proxyPort: port, proxyURL: `${scheme}://${authority}:${port}` };
  }
  return { supported: true, state: '无系统显式代理', detail: '系统未启用 HTTP/HTTPS/SOCKS/PAC。诊断禁用环境变量代理，但已有 TUN/透明代理仍可能接管；不据此宣称物理直连。', proxyURL: null };
}

async function readSystemProxy() {
  try { const result = await exec('/usr/sbin/scutil', ['--proxy'], { timeout: 2500, maxBuffer: 65536 }); return parseSystemProxy(result.stdout); }
  catch { return { supported: false, state: '路径读取失败', detail: '无法读取系统代理；本轮不会猜测诊断入口。', proxyURL: null }; }
}

function ownedDiagnosticProxy(runtime, configs) {
  const port=configs?.['mixed-port'] ?? runtime?.['mixed-port'];
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('OWN_PROXY_UNAVAILABLE');
  return {supported:true,state:'AX1OM 独立核心',detail:`本次请求经 AX1OM 本机入口 127.0.0.1:${port}，按当前业务编排分流。`,proxyKind:'AX1OM mixed',proxyHost:'127.0.0.1',proxyPort:port,proxyURL:`http://127.0.0.1:${port}`};
}
async function readDiagnosticPath(dependencies={}) {
  const {YAML,runtimeConfigFile,ownRuntimeExists,controllerMetadata}=require('./adapter-paths.cjs');
  const own=dependencies.own ?? ownRuntimeExists();
  if(own)try {
    const runtime=dependencies.runtime || YAML.parse(fs.readFileSync(runtimeConfigFile(),'utf8'));
    const controller=dependencies.controller || controllerMetadata();
    const read=dependencies.readController || require('./native-bridge.cjs').request;
    const configs=await read(controller,'/configs',controller.secret);
    const proxy=ownedDiagnosticProxy(runtime,configs);
    const listener=parseDNSListener(configs.dns?.listen || runtime.dns?.listen);
    return {proxy,dnsConfig:{listener,detail:listener?`AX1OM DNS ${listener.host}:${listener.port}`:'AX1OM 未启用独立 DNS 监听'}};
  }catch{}
  const proxy=await (dependencies.readSystem || readSystemProxy)();
  if(own){proxy.state='当前网络 · AX1OM 未运行';proxy.detail='本次检测使用当前系统网络，AX1OM 独立核心未运行。 '+proxy.detail;}
  return {proxy,dnsConfig:own?{listener:null,detail:'当前系统网络检测'}:await readDNSListener()};
}

async function fetchURL(url, proxy, { ipv6 = false } = {}) {
  const marker = 'AX1OM_META_' + crypto.randomBytes(6).toString('hex') + ':';
  const args = ['--disable', '--silent', '--show-error', '--location', '--max-redirs', '3', '--proto', '=https', '--connect-timeout', '4', '--max-time', '8', '--max-filesize', '524288', '--compressed', '--user-agent', 'AX1OM-Network/0.2 diagnostics'];
  if (proxy.proxyURL) args.push('--proxy', proxy.proxyURL, '--noproxy', '');
  else args.push('--proxy', '', '--noproxy', '*');
  if (ipv6) args.push('--ipv6');
  args.push('--write-out', '\n' + marker + '%{http_code}|%{time_total}|%{size_download}\n', url);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(http_proxy|https_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  try {
    const { stdout } = await exec('/usr/bin/curl', args, { env, timeout: 10000, maxBuffer: 600000 });
    const index = stdout.lastIndexOf('\n' + marker);
    if (index < 0) throw Error('METADATA_MISSING');
    const [status, elapsed, bytes] = stdout.slice(index + marker.length + 1).trim().split('|').map(Number);
    if (!Number.isInteger(status) || !Number.isFinite(elapsed)) throw Error('INVALID_METADATA');
    return { status, latencyMs: elapsed * 1000, receivedBytes: bytes || 0, body: stdout.slice(0, index) };
  } catch (error) {
    const code = typeof error.code === 'number' ? error.code : error.killed ? 'TIMEOUT' : 'NETWORK';
    throw Error('CURL_' + code);
  }
}

function parseTrace(body, expectedHost) {
  const entries = Object.fromEntries(String(body).trim().split(/\r?\n/).filter(line => /^[a-z_]+=/.test(line)).map(line => { const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)]; }));
  if (!net.isIP(entries.ip || '') || !entries.h || (expectedHost && entries.h.toLowerCase() !== expectedHost.toLowerCase())) throw Error('TRACE_INVALID');
  return { ip: entries.ip, countryCode: entries.loc || null, edge: entries.colo || null, tls: entries.tls || null };
}
function parsePing0(body) {
  const value = String(body).trim();
  if (net.isIP(value)) return value;
  const title = value.match(/<title>\s*([^<]+)<\/title>/i)?.[1]?.split('-')[0]?.trim();
  if (net.isIP(title || '') && (value.includes('/trace/' + title) || value.includes('/ping/' + title))) return title;
  throw Error('PING0_IP_NOT_VERIFIED');
}
function extractAssignedJSON(text, assignment) {
  const start = text.indexOf(assignment);
  if (start < 0) throw Error('JSON_ASSIGNMENT_MISSING');
  const brace = text.indexOf('{', start + assignment.length);
  if (brace < 0) throw Error('JSON_ASSIGNMENT_INVALID');
  let depth = 0, quoted = false, escaped = false;
  for (let i = brace; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(brace, i + 1)); } catch { throw Error('JSON_ASSIGNMENT_INVALID'); } }
  }
  throw Error('JSON_ASSIGNMENT_UNFINISHED');
}
function parseIPIP(body) {
  const text = String(body);
  const data = extractAssignedJSON(text, 'window.__IPINFO__');
  if (!data || Array.isArray(data) || !net.isIP(data.ip || '')) throw Error('IPIP_IP_INVALID');
  // Select only useful public attributes. Abuse contacts/account contents are not exposed.
  return { ip: data.ip, country: data.country, region: data.region, city: data.city,
    asn: data.asn?.asn, organization: data.asn?.name || data.org, networkType: data.asn?.type || data.company?.type,
    timezone: data.timezone, privacy: data.privacy && typeof data.privacy === 'object' ? data.privacy : {} };
}
function ipv4InCIDR(ip, cidr) {
  if (net.isIP(ip) !== 4 || typeof cidr !== 'string') return false;
  const [base, prefixText] = cidr.split('/'); const prefix = Number(prefixText);
  if (net.isIP(base || '') !== 4 || !/^\d+$/.test(prefixText || '') || prefix < 0 || prefix > 32) return false;
  const value = address => address.split('.').reduce((n, part) => (n << 8n) + BigInt(part), 0n);
  const shift = BigInt(32 - prefix);
  return (value(ip) >> shift) === (value(base) >> shift);
}
function parseRisk(body, requestedIP) {
  let data; try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { throw Error('RISK_JSON_INVALID'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || !net.isIP(requestedIP)) throw Error('RISK_INVALID');
  const sampleIP = net.isIP(data.ip || '') ? data.ip : null;
  const exact = sampleIP === requestedIP;
  const subnet = !exact && sampleIP && ipv4InCIDR(requestedIP, data.cidr) && ipv4InCIDR(sampleIP, data.cidr);
  if (!exact && !subnet) throw Error('RISK_SUBJECT_MISMATCH');
  const score = typeof data.trust_score === 'number' && Number.isFinite(data.trust_score) && data.trust_score >= 0 && data.trust_score <= 100 ? data.trust_score : null;
  return { data, score, sampleIP, scope: exact ? 'IP 查询参考' : '同网段样本参考',
    detail: exact ? 'Net.Coffee 第三方信誉参考，非 Anthropic 官方风险判定，不代表账号或会话可用。' : `Net.Coffee 返回同网段 ${data.cidr} 的样本 ${sampleIP}；此分值仅作网段参考，不能当成目标 IP 的精确评分或 Anthropic 官方判定。` };
}
function boolDisplay(value, positive = '检测到', negative = '第三方未报告') { return value === true ? positive : value === false ? negative : '未知'; }
function safeText(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 300) : '未知'; }

function parseDNSListener(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/);
  if (!match) return null;
  let host = match[1] || match[2]; const port = Number(match[3]);
  if (host === '0.0.0.0') host = '127.0.0.1';
  if (host === '::') host = '::1';
  if (!(host === 'localhost' || host === '::1' || (net.isIP(host) === 4 && host.startsWith('127.'))) || port < 1 || port > 65535) return null;
  return { host: host === 'localhost' ? '127.0.0.1' : host, port };
}
async function readDNSListener() {
  try {
    const {YAML,runtimeConfigFile,ownRuntimeExists} = require('./adapter-paths.cjs');
    if (!ownRuntimeExists() && process.env.AX1OM_LEGACY_READ !== '1') return {listener:null,detail:'本机核心尚未启动。'};
    const config = YAML.parse(fs.readFileSync(runtimeConfigFile(), 'utf8'));
    const listener = parseDNSListener(config.dns?.listen);
    return { listener, configuredIPv6: config.ipv6, dnsIPv6: config.dns?.ipv6,
      detail: listener ? `读取现有运行配置 DNS listen → ${listener.host}:${listener.port}；仅发送回环 UDP 查询。` : '现有运行配置未提供可安全查询的本机 DNS 监听；没有猜测端口或查询远端解析器。' };
  } catch { return { listener: null, detail: '无法读取当前 DNS 监听配置；未猜测 1053 或其他端口。' }; }
}
function dnsQueryPacket(host, type, id) {
  if (!/^[a-z0-9.-]+$/i.test(host) || ![1, 64, 65].includes(type)) throw Error('DNS_SCOPE_INVALID');
  const header = Buffer.alloc(12); header.writeUInt16BE(id, 0); header.writeUInt16BE(0x100, 2); header.writeUInt16BE(1, 4);
  const labels = host.split('.').map(label => Buffer.concat([Buffer.from([Buffer.byteLength(label)]), Buffer.from(label)]));
  const question = Buffer.alloc(5); question.writeUInt16BE(type, 1); question.writeUInt16BE(1, 3);
  return Buffer.concat([header, ...labels, question]);
}
function parseDNSResponse(packet, expectedID) {
  if (!Buffer.isBuffer(packet) || packet.length < 12 || packet.readUInt16BE(0) !== expectedID || !(packet.readUInt16BE(2) & 0x8000)) throw Error('DNS_RESPONSE_INVALID');
  const rcode = packet.readUInt16BE(2) & 0xf;
  return { rcode, answerCount: packet.readUInt16BE(6), state: ({ 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 5: 'REFUSED' })[rcode] || 'RCODE_' + rcode };
}
async function queryLocalDNS(listener, host, type) {
  if (!listener || !parseDNSListener((listener.host.includes(':') ? '[' + listener.host + ']' : listener.host) + ':' + listener.port)) throw Error('DNS_LISTENER_UNSAFE');
  return new Promise(resolve => {
    const socket = dgram.createSocket(net.isIP(listener.host) === 6 ? 'udp6' : 'udp4');
    const id = crypto.randomInt(1, 65535);
    let ended = false;
    const finish = result => { if (ended) return; ended = true; clearTimeout(timer); socket.close(); resolve({ host, type, ...result }); };
    const timer = setTimeout(() => finish({ state: '超时', rcode: null, answerCount: null }), 2500);
    socket.once('error', () => finish({ state: '查询失败', rcode: null, answerCount: null }));
    socket.on('message', packet => { try { finish(parseDNSResponse(packet, id)); } catch {} });
    socket.send(dnsQueryPacket(host, type, id), listener.port, listener.host, error => { if (error) finish({ state: '查询失败', rcode: null, answerCount: null }); });
  });
}

async function runDiagnostics(options = {}) {
  const detected=options.proxy?null:await readDiagnosticPath(options.pathDependencies);
  const proxy = options.proxy || detected.proxy;
  const dnsConfig = options.dnsConfig || detected?.dnsConfig || await readDNSListener();
  const get = options.fetch || ((url, flags) => fetchURL(url, proxy, flags));
  const dnsGet = options.dnsQuery || queryLocalDNS;
  const errors = [], availability = [], exits = [], checks = [];
  const networkPath = { ...proxy }; delete networkPath.proxyURL; delete networkPath.supported;
  let pingIP = null, ipip = null, cf = null, claude = null;
  let receivedBytes = 0;
  if (proxy.supported) {
    const entries = await Promise.allSettled([
      get(SOURCES.ping0), get(SOURCES.ipip), get(SOURCES.cloudflare), get(SOURCES.claude), get(SOURCES.anthropic)
    ]);
    const labels = ['PING0', 'IPIP.la', 'Cloudflare trace', 'claude.ai', 'anthropic.com'];
    for (let i = 0; i < entries.length; i++) {
      const result = entries[i];
      if (result.status !== 'fulfilled') { errors.push(labels[i] + '：连接失败或超时'); if (i >= 3) availability.push({ label: labels[i], state: '未连通', latencyMs: null, detail: '普通 HTTPS 探测失败；不据此认定账号不可用。' }); continue; }
      const response = result.value; receivedBytes += response.receivedBytes || 0;
      if (i >= 3) availability.push({ label: labels[i], state: response.status >= 200 && response.status < 400 ? 'HTTPS 可达' : 'HTTP ' + response.status,
        latencyMs: response.latencyMs || null, detail: `HTTP ${response.status}，无登录/对话请求；不能作为 Claude 实际会话可用证明。` });
      if (response.status !== 200) { errors.push(labels[i] + '：HTTP ' + response.status); continue; }
      try {
        if (i === 0) pingIP = parsePing0(response.body);
        if (i === 1) ipip = parseIPIP(response.body);
        if (i === 2) cf = parseTrace(response.body, 'www.cloudflare.com');
        if (i === 3) claude = parseTrace(response.body, 'claude.ai');
      } catch { if (i < 4) errors.push(labels[i] + '：返回格式无法验证'); }
    }
  } else errors.push(proxy.detail);
  exits.push({ id: 'public', title: '第三方查询所见出口', ip: pingIP || ipip?.ip || null, source: pingIP ? 'PING0 公开响应' : 'IPIP.la 主页响应', sourceURL: pingIP ? SOURCES.ping0 : SOURCES.ipip,
    state: pingIP || ipip?.ip ? '已读取' : '未获取', detail: '查询网站所见的诊断请求出口；不能据此认定中国物理网络地址。' });
  exits.push({ id: 'cloudflare', title: 'Cloudflare 所见出口', ip: cf?.ip || null, source: 'Cloudflare trace', sourceURL: SOURCES.cloudflare,
    state: cf ? '已验证 trace' : '未获取', detail: cf ? `边缘 ${cf.edge || '未知'} · ${cf.countryCode || '未知'} · ${cf.tls || 'TLS 未报告'}；仅对应此目标和当前诊断路径。` : '没有有效的目标 trace 响应。' });
  exits.push({ id: 'claude', title: 'Claude trace 所见出口', ip: claude?.ip || null, source: 'claude.ai /cdn-cgi/trace', sourceURL: SOURCES.claude,
    state: claude ? '已验证 trace' : '未验证', detail: claude ? `由 claude.ai 自有 trace 响应报告 · ${claude.countryCode || '未知'}；不等于登录、对话、API 或 Claude Code 的实际请求出口。` : '普通 HTTPS 可达不提供可靠出口证据；没有推断 Claude IP。' });

  const target = claude?.ip || cf?.ip || pingIP || ipip?.ip || null;
  const attributes = [{ label: '属性查询对象', value: target || '未知' }];
  const security = [];
  let score = null, scoreDetail = '未获取可验证的第三方分数；不使用历史分值或自行打分。';
  let risk = null, geo = null;
  if (target && proxy.supported) {
    const replies = await Promise.allSettled([get(SOURCES.risk + encodeURIComponent(target)), get(SOURCES.geo + encodeURIComponent(target))]);
    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];
      if (reply.status !== 'fulfilled') { errors.push((i === 0 ? '信誉参考' : '归属地') + '：请求失败或超时'); continue; }
      receivedBytes += reply.value.receivedBytes || 0;
      if (reply.value.status !== 200) { errors.push((i === 0 ? '信誉参考' : '归属地') + '：HTTP ' + reply.value.status); continue; }
      try { if (i === 0) risk = parseRisk(reply.value.body, target); else { const data = JSON.parse(reply.value.body); if (!data || Array.isArray(data) || data.error) throw Error('GEO_INVALID'); geo = data; } }
      catch { errors.push((i === 0 ? '信誉参考' : '归属地') + '：返回格式或查询对象不匹配'); }
    }
  }
  if (risk) { score = risk.score; scoreDetail = risk.detail + (score === null ? ' 本次未返回有效分数。' : ''); }
  const data = risk?.data || {};
  const country = geo?.country || data.country || (ipip?.ip === target ? ipip.country : null) || cf?.countryCode;
  const attributePairs = [ ['地区', country], ['区域', geo?.region || data.region], ['城市', geo?.city || data.city], ['ASN', data.asn != null ? 'AS' + String(data.asn).replace(/^AS/i, '') : ipip?.ip === target ? ipip.asn : null], ['运营商', data.asOrganization || geo?.isp],
    ['IP 属性', data.isResidential === true ? '第三方标记：住宅' : data.is_datacenter === true ? '第三方标记：机房' : '未知'], ['属性来源', risk ? 'Net.Coffee · ' + risk.scope : geo ? 'Net.Coffee 归属地查询' : '未获取完整属性'] ];
  for (const [label, value] of attributePairs) attributes.push({ label, value: safeText(value) });
  for (const [label, key] of [['VPN', 'is_vpn'], ['代理', 'is_proxy'], ['Tor', 'is_tor'], ['机器人', 'is_crawler'], ['滥用记录', 'is_abuser']]) security.push({ label, value: boolDisplay(data[key]) });
  security.push({ label: '说明', value: '第三方数据库信号，不能证明实际未使用代理或保证账号安全。' });

  let dnsProbe = [];
  if (dnsConfig.listener) {
    dnsProbe = await Promise.all(['example.com', 'claude.ai'].flatMap(host => [1, 64, 65].map(type => Promise.resolve().then(() => dnsGet(dnsConfig.listener, host, type)).catch(() => ({ host, type, state: '查询失败', rcode: null, answerCount: null })))));
    const details = dnsProbe.map(value => `${value.host} Type ${value.type}: ${value.state}${value.answerCount != null ? ' / answer=' + value.answerCount : ''}`).join('；');
    checks.push({ id: 'dns-records', title: 'DNS A / Type 64 / 65', state: dnsProbe.some(v => v.rcode !== null) ? '本机解析器有限实测' : '未确认', detail: dnsConfig.detail + ' ' + details + '。无 answer 可能是未发布、缓存或解析策略，不自动等于全网过滤；仅覆盖此解析器与两个域名。' });
  } else checks.push({ id: 'dns-records', title: 'DNS A / Type 64 / 65', state: '未实测', detail: dnsConfig.detail });
  if (proxy.supported) {
    try {
      const result = await get(SOURCES.cloudflare, { ipv6: true }); receivedBytes += result.receivedBytes || 0;
      const trace = result.status === 200 ? parseTrace(result.body, 'www.cloudflare.com') : null;
      checks.push({ id: 'ipv6', title: 'IPv6 出口', state: trace && net.isIP(trace.ip) === 6 ? '检测到 IPv6 出口' : trace ? '本次 trace 为 IPv4' : '未确认', detail: (trace ? `curl -6 当前诊断路径返回 ${trace.ip}；仅对应该请求。` : `curl -6 返回 HTTP ${result.status}，没有可验证的 IPv6 出口。`) + (proxy.proxyURL ? ' 显式代理转发的地址族不受本机 -6 完整约束，不能证明其他应用不会 IPv6 绕行。' : ' 不能代表所有浏览器或客户端的 IPv6 路径。') });
    } catch { checks.push({ id: 'ipv6', title: 'IPv6 出口', state: '未确认', detail: 'curl -6 当前路径连接失败；IPv4 本机代理或目标支持可能影响结果，不据此认定 IPv6 已阻止。' }); }
  } else checks.push({ id: 'ipv6', title: 'IPv6 出口', state: '未实测', detail: '诊断路径尚未确认。' });
  return { capturedAt: new Date().toISOString(), path: networkPath, exits, attributes, security, score, scoreDetail,
    sourceURL: SOURCES.netcoffee, availability,
    dns: { state: '未实测', detail: 'A/64/65 本机解析测试不等于 DNS 泄漏测试；未启动浏览器权威回传检测。', sourceURL: SOURCES.dns },
    webrtc: { state: '未实测', detail: 'CLI 不提供浏览器 ICE/WebRTC 环境；没有将未检测当成无泄漏。可打开深度检测页面。', sourceURL: SOURCES.webrtc },
    checks, dnsProbe, receivedBytes, errors };
}

module.exports = { ownedDiagnosticProxy, readDiagnosticPath, parseSystemProxy, parseTrace, parsePing0, parseIPIP, extractAssignedJSON, parseRisk, ipv4InCIDR, parseDNSListener, dnsQueryPacket, parseDNSResponse, runDiagnostics };
if (require.main === module) runDiagnostics().then(value => process.stdout.write(JSON.stringify(value))).catch(() => { process.stderr.write('IP 检测失败；原始响应已隐藏。\n'); process.exitCode = 1; });
