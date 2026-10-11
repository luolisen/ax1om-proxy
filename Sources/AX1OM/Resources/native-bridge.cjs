'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {home,root,relayRoot,vergeRoot,runtimeRoot,YAML,ownRuntimeExists,runtimeConfigFile,controllerMetadata,privateNodePath} = require('./adapter-paths.cjs');
const credentialKey = /(?:uuid|password|passwd|private.?key|public.?key|short.?id|secret|token|authorization|auth.?key|subscription.?url|url)$/i;
const secrets = new Set();

function collectSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (credentialKey.test(key) && typeof item === 'string' && item.length > 3) secrets.add(item);
    else if (typeof item === 'object') collectSecrets(item);
  }
}
function sanitize(value) {
  if (typeof value === 'string') {
    let text = value.replace(/\x1b\[[0-9;]*m/g, '').replace(/Bearer\s+[^\s]+/gi, 'Bearer [已隐藏]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[已隐藏]')
      .replace(/(?:vless|vmess|trojan|ss|hysteria2?):\/\/[^\s]+/gi, '[节点链接已隐藏]')
      .replace(/https?:\/\/[^\s]+/gi, '[网址已隐藏]')
      .replace(/((?:password|token|secret|uuid|private[_-]?key|public[_-]?key|short[_-]?id)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]');
    for (const secret of secrets) text = text.split(secret).join('[已隐藏]');
    return text.slice(0, 800);
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, credentialKey.test(key) ? '[已隐藏]' : sanitize(item)]));
  return value;
}
function hostMatches(host, domain) { return host === domain || host.endsWith('.' + domain); }
function classify(host = '', processName = '') {
  host = String(host).toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const match = list => list.some(domain => hostMatches(host, domain));
  if (match(['anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com', 'claudeusercontent.net'])) return 'claude';
  if (match(['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'openai.org', 'chat.com'])) return 'gpt';
  if (match(['slack.com', 'slack-edge.com', 'slack-imgs.com', 'slack-files.com', 'slack-msgs.com', 'slackb.com'])) return 'slack';
  if (match(['x.com', 'twitter.com', 'twimg.com', 't.co', 'x.ai', 'xai.com', 'grok.com'])) return 'xai';
  if (match(['google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'googlevideo.com', 'youtube.com', 'youtu.be', 'ytimg.com', 'google.co.uk', 'google.com.tw', 'google.com.hk', 'google.cn', 'ggpht.com', 'googletagmanager.com', 'googlesyndication.com', 'googleadservices.com'])) return 'google';
  // Process evidence is used only when the host is absent or an IP address.
  const noDomain = !host || /^[\d.]+$/.test(host) || host.includes(':');
  const leaf = path.basename(String(processName)).toLowerCase();
  if (noDomain && /^(claude|claude helper(?: \(.+\))?|claude code)$/.test(leaf)) return 'claude';
  if (noDomain && /^(chatgpt|codex|chatgpt helper(?: \(.+\))?)$/.test(leaf)) return 'gpt';
  if (noDomain && /^(google drive|googledrivefs)$/.test(leaf)) return 'google';
  if (noDomain && /^(slack|slack helper(?: \(.+\))?)$/.test(leaf)) return 'slack';
  return 'other';
}
function connection(c, source = 'mihomo', proxyData = {}, nodes = []) {
  const m = c.metadata || {};
  const host = m.host || c.host || m.destinationIP || '未知';
  const processName = m.process || path.basename(m.processPath || '') || c.process || '未提供';
  const chains = Array.isArray(c.chains) ? c.chains : typeof c.chains === 'string' ? c.chains.split(' → ') : [];
  const leaves = chains.filter(name => proxyData.proxies?.[name] && !Array.isArray(proxyData.proxies[name].all));
  const leaf = leaves.length === 1 ? leaves[0] : null;
  const known = nodes.find(node => node.name === leaf);
  const nodeID = leaf ? known?.id || stableIdentifier('node', leaf) : null;
  const nodeName = known && ['azure','la-a','panda'].includes(known.id) ? ({azure:'Azure · West US','la-a':'洛杉矶 A',panda:'潘达'})[known.id] : leaf === 'DIRECT' ? '直连' : leaf;
  return { id: 'connection-' + (source === 'ax1om' ? 'ax1om' : source === 'core' ? 'core' : 'mihomo') + '-' + crypto.createHash('sha256').update(String(c.id || [host, processName, c.start].join('|'))).digest('hex').slice(0, 20), service: classify(host, processName), host,
    process: processName, network: m.network || c.network || '未知',
    rule: c.rulePayload ? [c.rule, c.rulePayload].filter(Boolean).join(' · ') : c.rule || '未提供', chains,
    upload: Number(c.upload) || 0, download: Number(c.download) || 0, start: c.start || null, nodeID, nodeName };
}
function readJSON(file) { const value = JSON.parse(fs.readFileSync(file, 'utf8')); collectSecrets(value); return value; }
function readYAML(file, YAML) { const value = YAML.parse(fs.readFileSync(file, 'utf8')) || {}; collectSecrets(value); return value; }
function request(socketPath, endpoint, secret, body) {
  if (endpoint !== '/' && !['/configs', '/connections', '/proxies', '/providers/proxies'].includes(endpoint)) throw Error('READ_ONLY_ENDPOINT');
  if (body && body.method !== 'status' && body.method !== 'monitoring') throw Error('READ_ONLY_METHOD');
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const target = typeof socketPath === 'object' ? socketPath : {socketPath};
    if (!target.socketPath && (target.host !== '127.0.0.1' || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) return reject(Error('CONTROL_UNAVAILABLE'));
    const req = http.request({ ...target, path: endpoint, method: data ? 'POST' : 'GET', headers: {
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    } }, res => {
      let text = ''; res.on('data', b => { text += b; if (text.length > 8_000_000) req.destroy(Error('RESPONSE_LIMIT')); });
      res.on('end', () => { if (res.statusCode !== 200) return reject(Error('HTTP_' + res.statusCode)); try { const value = JSON.parse(text); if (value.error) return reject(Error('CONTROL_ERROR')); resolve(body ? value.result : value); } catch { reject(Error('INVALID_JSON')); } });
    });
    req.setTimeout(4500, () => req.destroy(Error('TIMEOUT'))); req.on('error', e => reject(Error(e.code || e.message || 'READ_ERROR'))); req.end(data);
  });
}
function safeError(title, error) { return title + '：' + (['ENOENT', 'ECONNREFUSED', 'EACCES', 'TIMEOUT', 'INVALID_JSON', 'CONTROL_ERROR', 'RESPONSE_LIMIT'].includes(error.message) || /^HTTP_\d+$/.test(error.message) ? error.message : '读取失败'); }
function closeBackend(source) {
  if (source === 'ax1om') return controllerMetadata();
  if (source === 'mihomo') {
    if (ownRuntimeExists() || process.env.AX1OM_LEGACY_READ !== '1') throw Error('CONTROL_UNAVAILABLE');
    const runtime = readYAML(path.join(vergeRoot, 'clash-verge.yaml'), YAML);
    const serviceSocket = `/var/run/clash-verge-service/users/${process.getuid()}/verge-mihomo.sock`;
    const socketPath = fs.existsSync(serviceSocket) ? serviceSocket : runtime['external-controller-unix'];
    if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) throw Error('CONTROL_UNAVAILABLE');
    return { socketPath, secret: runtime.secret };
  }
  if (source === 'core') {
    if (ownRuntimeExists() || process.env.AX1OM_LEGACY_READ !== '1') throw Error('CONTROL_UNAVAILABLE');
    const config = readJSON(path.join(relayRoot, 'config.json'));
    const control = config.experimental?.clash_api;
    const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(control?.external_controller || '');
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535 || typeof control.secret !== 'string' || !control.secret) throw Error('CONTROL_UNAVAILABLE');
    // Port and authentication are read from the running relay's existing file;
    // no daemon action, restart, discovered URL, or default port is used.
    return { host: '127.0.0.1', port: Number(match[1]), secret: control.secret };
  }
  throw Error('CONTROL_UNAVAILABLE');
}
function connectionControllerRequest(backend, method, nativeId) {
  if (!['GET','DELETE'].includes(method)) throw Error('SINGLE_CONNECTION_ONLY');
  if (method === 'GET' && nativeId !== undefined) throw Error('SINGLE_CONNECTION_ONLY');
  if (method === 'DELETE' && (typeof nativeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(nativeId))) throw Error('INVALID_CONNECTION_ID');
  const endpoint = method === 'DELETE' ? '/connections/' + encodeURIComponent(nativeId) : '/connections';
  return new Promise((resolve, reject) => {
    const target = backend.socketPath ? { socketPath: backend.socketPath } : { host: backend.host, port: backend.port };
    if (!backend.socketPath && (backend.host !== '127.0.0.1' || !Number.isInteger(backend.port) || backend.port < 1 || backend.port > 65535)) return reject(Error('CONTROL_UNAVAILABLE'));
    const req = http.request({ ...target, path: endpoint, method, headers: backend.secret ? {Authorization:`Bearer ${backend.secret}`} : {} }, res => {
      let text=''; res.on('data',chunk=>{text+=chunk; if(text.length>8_000_000)req.destroy(Error('RESPONSE_LIMIT'));});
      res.on('end',()=>{
        if (method === 'DELETE') {
          if (![200,204].includes(res.statusCode)) return reject(Error('HTTP_'+res.statusCode));
          return resolve({closed:true});
        }
        if(res.statusCode!==200) return reject(Error('HTTP_'+res.statusCode));
        try { const value=JSON.parse(text); if(!Array.isArray(value.connections))throw Error('INVALID_JSON'); resolve(value); }
        catch { reject(Error('INVALID_JSON')); }
      });
    });
    req.setTimeout(4500,()=>req.destroy(Error('TIMEOUT')));req.on('error',()=>reject(Error('CONTROL_UNAVAILABLE')));req.end();
  });
}
async function closeConnection(input, dependencies = {}) {
  const id = input?.id;
  if (typeof id !== 'string' || id.length > 96 || !/^connection-(ax1om|mihomo|core)-[a-f0-9]{20}$/.test(id))
    return {success:false,message:'连接标识无效或来自旧快照，请刷新后重试。'};
  const source = /^connection-(ax1om|mihomo|core)-/.exec(id)[1];
  const getBackend=dependencies.getBackend || closeBackend;
  const controller=dependencies.controller || connectionControllerRequest;
  try {
    const backend=await getBackend(source);
    const current=await controller(backend,'GET');
    const matches=(current.connections || []).filter(c=>typeof c.id==='string' && connection(c,source).id===id);
    if(matches.length===0)return {success:false,message:'此连接已结束，请刷新连接列表。'};
    if(matches.length!==1 || !/^[A-Za-z0-9_-]{1,128}$/.test(matches[0].id))return {success:false,message:'连接标识无法唯一确认，未终结任何连接。'};
    await controller(backend,'DELETE',matches[0].id);
    return {success:true,message:'已终结所选连接；客户端可能自动重新连接。'};
  } catch (error) {
    if(error.message==='HTTP_404')return {success:false,message:'此连接已结束，请刷新连接列表。'};
    return {success:false,message:'所选连接终结失败；未操作其他连接，请刷新后重试。'};
  }
}
function cachedDelay(proxy) {
  const history = proxy?.history || []; const last = history[history.length - 1];
  return last && Number(last.delay) > 0 ? Number(last.delay) : null;
}
function runtimeState(proxy) { const delay = cachedDelay(proxy); return proxy?.alive === false ? '缓存记录不可达' : delay != null ? '已有延迟记录' : '未实测'; }
// Provider caps and VPS package caps are metadata, not live consumption.
// VPS GB values use decimal units as listed in the user's package description.
function privateTrafficCap(id, caps) {
  if(caps !== undefined) { const value=caps?.[id]; return typeof value==='number'&&Number.isFinite(value)&&value>0?value:null; }
  return ({ panda: 200_000_000_000, 'la-a': 1_000_000_000_000 })[id] ?? null;
}
function profileQuota(item = {}) {
  const extra = item.extra || {};
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const placeholder = String(item.name || '').toLowerCase() === 'edgetunnel' && extra.total === 102400 && extra.expire >= 4102329600;
  if (placeholder) return { usedBytes: null, totalBytes: null, detail: '本地缓存为 100 KiB、2100 年到期的疑似占位额度，未确认套餐含义，因此隐藏用量与上限；未更新公网订阅。' };
  const totalBytes = numeric(extra.total) && extra.total > 0 ? extra.total : null;
  const sum = numeric(extra.upload) && numeric(extra.download) ? extra.upload + extra.download : null;
  const usedBytes = totalBytes != null && sum != null && Number.isFinite(sum) ? sum : null;
  return { usedBytes, totalBytes, detail: usedBytes != null ? '套餐用量与上限来自本地订阅缓存，非实时账单；没有向公网更新订阅。' : '仅显示本地缓存的有效套餐上限；缺失用量保持未知，没有向公网更新订阅。' };
}
function stableIdentifier(prefix, value) { return prefix + '-' + crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20); }
function groupSummaries(proxyData = {}, configuredNames = []) {
  const proxies = proxyData.proxies || {};
  const order = new Map(configuredNames.map((name, index) => [name, index]));
  const groups = Object.entries(proxies).filter(([name, proxy]) => {
    return !['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'].includes(name.toUpperCase()) && Array.isArray(proxy.all);
  }).map(([name, proxy], index) => ({
    id: stableIdentifier('group', name), name, kind: proxy.type || '未知策略组', selected: proxy.now || null,
    members: proxy.all.map(memberName => {
      const member = proxies[memberName];
      return { id: stableIdentifier('member', name + '\u0000' + memberName), name: memberName, kind: member?.type || '运行时未提供',
        state: member ? runtimeState(member) : '成员信息不可读取', delayMs: cachedDelay(member),
        udp: typeof member?.udp === 'boolean' ? member.udp : null };
    }), order: order.has(name) ? order.get(name) : configuredNames.length + index
  }));
  groups.sort((a, b) => {
    const priority = value => /^(?:default proxy|proxy|节点选择)$/i.test(value.name) ? 0 : 1;
    return priority(a) - priority(b) || a.order - b.order;
  });
  return groups.map(({ order, ...group }) => group);
}

function ownedRuntimeNodes(runtime, proxyData, running, privateCaps = {}) {
  const ids = {'AX1OM Azure West US':'azure','AX1OM Los Angeles A':'la-a','AX1OM Panda Backup':'panda'};
  return (runtime.proxies || []).map(p => {
    const id=ids[p.name], live=running?proxyData.proxies?.[p.name]:null;
    return {id:id || stableIdentifier('standalone',p.name),name:p.name || '未命名节点',source:id?'自建专线':'AX1OM',kind:p.type==='vless'?'VLESS / REALITY':p.type || '未知协议',state:live?runtimeState(live):'配置已读取',address:p.server || null,delayMs:cachedDelay(live),trafficCapBytes:id?privateTrafficCap(id,privateCaps):null,detail:running?'来自独立核心配置与实时控制接口。':'本机独立配置；核心尚未运行。'};
  });
}
function observedTUN(configs,runtime,running,own) {
  if(own)return running?(typeof configs.tun?.enable==='boolean'?configs.tun.enable:null):false;
  return configs.tun?.enable ?? runtime.tun?.enable ?? null;
}
async function fetchSnapshot() {
  const errors = [];
  const own = ownRuntimeExists();
  const legacy = !own && process.env.AX1OM_LEGACY_READ === '1';
  let runtime = {}, profileMeta = {}, sourceMeta = {};
  if (own) try { sourceMeta = readJSON(path.join(root,'sources/index.json')); } catch {}
  try { if (own || legacy) runtime = readYAML(runtimeConfigFile(), YAML); } catch (e) { errors.push(safeError('运行配置', e)); }
  try { if (legacy) profileMeta = readYAML(path.join(vergeRoot, 'profiles.yaml'), YAML); } catch (e) { errors.push(safeError('订阅清单', e)); }
  const serviceSocket = `/var/run/clash-verge-service/users/${process.getuid()}/verge-mihomo.sock`;
  let socket;
  try { socket = own ? controllerMetadata() : legacy && fs.existsSync(runtimeConfigFile()) && fs.existsSync(serviceSocket) ? serviceSocket : runtime['external-controller-unix']; } catch(e) { errors.push(safeError('AX1OM 控制接口',e)); }
  const calls = socket ? ['/configs', '/connections', '/proxies', '/providers/proxies'].map(p => request(socket, p, own ? socket.secret : runtime.secret)) : Array.from({ length: 4 }, () => Promise.reject(Error('ENOENT')));
  calls.push(legacy && fs.existsSync(path.join(relayRoot, 'daemon.sock')) ? request(path.join(relayRoot, 'daemon.sock'), '/', null, { method: 'status' }) : Promise.resolve({}));
  const ownIdle = own && socket?.socketPath && !fs.existsSync(socket.socketPath);
  const values = await Promise.allSettled(calls);
  const [configs, connections, proxyData, providerData, relay] = values.map((r, i) => { if (r.status === 'fulfilled') { collectSecrets(r.value); return r.value; } if (!(ownIdle && r.reason.message === 'ENOENT')) errors.push(safeError(['Mihomo 状态', '连接', '节点', 'Provider', '专线守护'][i], r.reason)); return {}; });
  let rawConnections = connections.connections || [];
  if (relay.operationMode === 2) {
    try { const observed = await request(path.join(relayRoot, 'daemon.sock'), '/', null, { method: 'monitoring', arg: 'core' }); rawConnections = observed.connections || []; if (observed.error) errors.push('模式二连接：读取失败'); }
    catch (e) { errors.push(safeError('模式二连接', e)); }
  }
  const nodes = [], providers = [];
  const active = (profileMeta.items || []).find(p => p.uid === profileMeta.current);
  for (const item of (profileMeta.items || []).filter(p => ['remote', 'local'].includes(p.type))) {
    let profile = {};
    try { const file = path.resolve(vergeRoot, 'profiles', item.file || ''); if (!file.startsWith(path.join(vergeRoot, 'profiles') + path.sep)) throw Error('INVALID_PATH'); profile = readYAML(file, YAML); }
    catch (e) { errors.push(safeError('订阅缓存 ' + sanitize(item.name || '未命名'), e)); }
    const list = profile.proxies || [];
    const quota = profileQuota(item);
    providers.push({ id: 'profile-' + item.uid, name: item.name || '未命名订阅', kind: item.type === 'remote' ? 'HTTP Profile 缓存' : '本地 Profile', nodeCount: list.length,
      state: item.uid === profileMeta.current ? '当前配置来源' : '已缓存 · 未加载', usedBytes: quota.usedBytes, totalBytes: quota.totalBytes,
      updatedAt: item.updated ? new Date(Number(item.updated) * (Number(item.updated) < 1e12 ? 1000 : 1)).toISOString() : null,
      detail: quota.detail });
    for (const p of list) { const live = proxyData.proxies?.[p.name]; nodes.push({ id: `profile-${item.uid}-${crypto.createHash('sha256').update(String(p.name)).digest('hex').slice(0, 12)}`, name: p.name || '未命名节点', source: item.name || '未命名订阅', kind: p.type || '未知协议',
      state: item.uid === profileMeta.current && live ? runtimeState(live) : '仅订阅缓存', address: p.server || null, delayMs: item.uid === profileMeta.current ? cachedDelay(live) : null,
      detail: item.uid === profileMeta.current ? '运行时延迟为历史健康记录，不是本轮测速。' : '此来源未加入当前运行配置。' }); }
  }
  for (const [name, provider] of Object.entries(providerData.providers || {})) {
    const metadata = (sourceMeta.sources || []).find(s=>s.id===name);
    const info = provider.subscriptionInfo || metadata?.quota;
    const quota = profileQuota({name:metadata?.name || name,extra:info ? {upload:info.Upload ?? info.upload,download:info.Download ?? info.download,total:info.Total ?? info.total,expire:info.Expire ?? info.expire} : {}});
    providers.push({ id: own ? 'profile-' + name : 'runtime-' + name, name:metadata?.name || name, kind: provider.vehicleType || provider.type || '运行时 Provider', nodeCount: provider.proxies?.length || 0, state: '运行时已加载', usedBytes:quota.usedBytes,totalBytes:quota.totalBytes, updatedAt: provider.updatedAt || null, detail: '来自 Mihomo 控制接口与订阅缓存。' });
  }
  if (own) for (const source of sourceMeta.sources || []) if (!Object.hasOwn(providerData.providers || {},source.id)) {
    const quota = profileQuota({name:source.name,extra:source.quota || {}});
    providers.push({id:'profile-'+source.id,name:source.name || '未命名订阅',kind:source.type || '本地来源',nodeCount:source.count || 0,state:'已缓存',usedBytes:quota.usedBytes,totalBytes:quota.totalBytes,updatedAt:source.createdAt || null,detail:'来自本机来源缓存。'});
  }
  // Only public routing descriptors are selected; authentication stays in the source files.
  const privateSources = [
    ['panda', '潘达 · 现有生产专线', privateNodePath('panda'), 'json'],
    ['azure', 'Azure · West US', privateNodePath('azure'), 'yaml'],
    ['la-a', '洛杉矶 A', privateNodePath('la-a'), 'json']
  ];
  for (const [id, name, file, type] of legacy ? privateSources.filter(source => fs.existsSync(source[2])) : []) {
    try {
      const value = type === 'yaml' ? readYAML(file, YAML) : readJSON(file);
      const p = value.proxies?.[0] || value.outbounds?.find(x => x.type === 'vless') || value;
      const address = p.server || p.address || p.ip || null;
      const cap = privateTrafficCap(id);
      nodes.unshift({ id, name, source: '自建专线', kind: p.type || 'VLESS / REALITY', state: id === 'panda' && relay.running ? '专线核心运行中' : '配置已读取 · 未测试', address,
        delayMs: null, trafficCapBytes: cap, detail: (id === 'panda' ? '运行中不代表所有业务已经采用新编排；没有新测速。' : '候选节点；没有启动测试实例或接管生产流量。') + (cap ? ' 套餐上限来自用户提供的套餐信息，非实时用量。' : ' 套餐最大流量未知。') });
    } catch (e) { nodes.unshift({ id, name, source: '自建专线', kind: 'VLESS / REALITY', state: '配置不可读取', address: null, delayMs: null, trafficCapBytes: privateTrafficCap(id), detail: safeError('独立客户端', e) }); }
  }
  const dns = configs.dns || runtime.dns || {};
  const resolvers = [...(dns.nameserver || []), ...(dns.fallback || [])];
  const encrypted = resolvers.filter(v => /^(https|tls|quic):\/\//.test(String(v))).length;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const privacy = [
    { id: 'dns', title: 'DNS 配置', state: dns.enable ? '配置已读取' : '未确认', detail: `当前 DNS ${dns.enable ? '启用' : '未确认启用'}；${encrypted}/${resolvers.length} 个主/备用解析项使用加密协议。直连与节点解析需按业务分别验收；不是泄漏实测。` },
    { id: 'ipv6', title: 'IPv6 防绕过', state: configs.ipv6 === false || runtime.ipv6 === false ? '配置限制' : '待验收', detail: `核心 IPv6 ${(configs.ipv6 ?? runtime.ipv6) === false ? '关闭' : '未确认关闭'}，DNS IPv6 ${dns.ipv6 === false ? '关闭' : '未确认关闭'}。没有执行外网绕过测试。` },
    { id: 'timezone', title: '本机时区', state: timezone === 'America/Los_Angeles' ? 'Los Angeles' : '与目标不同', detail: `${timezone}；来自本机运行时。未改变系统时间或浏览器。` },
    { id: 'dns-types', title: 'DNS Type 64 / 65', state: '待实测', detail: '此只读适配器未执行 DNS 查询，无法证明过滤是否生效。' },
    { id: 'webrtc', title: 'WebRTC / UDP', state: '待实测', detail: '浏览器策略与公网泄漏不是同一证据；本轮没有启动浏览器探测。' },
    { id: 'client', title: '终端与客户端', state: '待逐项验收', detail: own ? '独立核心负责本机编排；此项只显示配置与连接状态。' : '现有固定潘达入口保持不变；Claude Code 等客户端尚未迁移到新业务编排。' }
  ];
  try { const preferences = readJSON(path.join(home, 'Library/Application Support/Google/Chrome/Default/Preferences')); const languages = preferences.intl?.accept_languages || preferences.intl?.selected_languages; if (languages) privacy.push({ id: 'language', title: 'Chrome 语言配置', state: String(languages).split(',')[0].startsWith('en') ? '英文优先配置' : '待调整', detail: sanitize(String(languages)) + '；仅 Default 配置缓存，未验证当前窗口的实际语言。' }); } catch {}
  if (own) {
    nodes.push(...ownedRuntimeNodes(runtime,proxyData,values[0].status==='fulfilled',sourceMeta.privateCaps || {}));
    for (const [providerName,provider] of Object.entries(providerData.providers || {})) for (const p of provider.proxies || []) nodes.push({id:stableIdentifier('provider-node',providerName+'\u0000'+p.name),name:p.name || '未命名节点',source:providerName,kind:p.type || '未知协议',state:runtimeState(p),address:null,delayMs:cachedDelay(p),detail:'来自独立核心 Provider。'});
  }
  const connectionSource = own ? 'ax1om' : relay.operationMode === 2 ? 'core' : 'mihomo';
  const normalized = rawConnections.map(c=>connection(c,connectionSource,proxyData,nodes));
  return sanitize({ capturedAt: new Date().toISOString(), relayRunning: relay.running === true, mihomoRunning: values[0].status === 'fulfilled', tunEnabled: observedTUN(configs,runtime,values[0].status==='fulfilled',own),
    mode: own ? (configs.mode || runtime.mode || '未知') + ' · AX1OM' : relay.operationMode === 2 ? '模式二 · 独立系统代理' : (configs.mode || runtime.mode || '未知') + ' · Mihomo', activeProfile: own ? 'AX1OM Providers' : active?.name || null,
    connections: normalized, nodes, providers, proxyGroups: groupSummaries(proxyData, (runtime['proxy-groups'] || []).map(p => p.name)), privacy, errors,
    uploadTotal: relay.operationMode === 2 ? normalized.reduce((s, c) => s + c.upload, 0) : Number(connections.uploadTotal) || normalized.reduce((s, c) => s + c.upload, 0),
    downloadTotal: relay.operationMode === 2 ? normalized.reduce((s, c) => s + c.download, 0) : Number(connections.downloadTotal) || normalized.reduce((s, c) => s + c.download, 0) });
}
module.exports = { ownedRuntimeNodes, observedTUN, classify, connection, sanitize, collectSecrets, request, safeError, privateTrafficCap, profileQuota, groupSummaries, fetchSnapshot, closeConnection, connectionControllerRequest };
if (require.main === module) {
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==='--close-connection') {
    let input=''; let oversized=false; process.stdin.setEncoding('utf8');
    process.stdin.on('data',chunk=>{if(input.length+chunk.length>2048){oversized=true;input='';}else if(!oversized)input+=chunk;});
    process.stdin.on('end',async()=>{
      let result; try {result=oversized?{success:false,message:'请求过大，未操作任何连接。'}:await closeConnection(JSON.parse(input));}
      catch {result={success:false,message:'请求格式无效，未操作任何连接。'};}
      process.stdout.write(JSON.stringify(result));
    });
  } else if(args.length===0) fetchSnapshot().then(snapshot => process.stdout.write(JSON.stringify(snapshot))).catch(() => { process.stderr.write('本机状态读取失败；原始内容已隐藏。\n'); process.exitCode = 1; });
  else process.stdout.write(JSON.stringify({success:false,message:'不支持此操作，未操作任何连接。'}));
}
