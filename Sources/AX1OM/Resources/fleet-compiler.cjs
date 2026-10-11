'use strict';
// Candidate-only compiler. No production controller, shell, or apply operation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const {home:HOME,root:STATE,relayRoot:RELAY,vergeRoot:VERGE,YAML,privateNodePath} = require('./adapter-paths.cjs');
const NAMES = { azure: 'AX1OM Azure West US', 'la-a': 'AX1OM Los Angeles A', panda: 'AX1OM Panda Backup' };
const DEFAULTS = [
  { id: 'openai', service: 'gpt', primary: 'la-a', backup: 'panda' },
  { id: 'anthropic', service: 'claude', primary: 'la-a', backup: 'panda' },
  { id: 'google', service: 'google', primary: 'azure', backup: 'panda' },
  { id: 'xai', service: 'xai', primary: 'azure', backup: 'panda' },
  { id: 'slack', service: 'slack', primary: 'azure', backup: 'panda' }
];
const SUPPLEMENTAL_DEFAULTS = [
  ...['xiaohongshu','douyin','bilibili','kuaishou','bambu'].map(id => ({ id, primary: 'DIRECT' })),
  ...['telegram','discord','facebook','tiktok','spotify','netflix'].map(id => ({ id, primary: 'GENERAL' })),
  { id: 'youtube', primary: 'azure' }, { id: 'github', primary: 'GENERAL' },
  { id: 'steam', primary: 'DOWNLOAD' }, { id: 'apple', primary: 'DIRECT' },
  { id: 'microsoft', primary: 'DIRECT' }, { id: 'fcm', primary: 'azure' },
  { id: 'download', primary: 'DOWNLOAD' }, { id: 'catchall', primary: 'GENERAL' }
];
const SUPPLEMENTAL_TARGETS = { DIRECT: 'DIRECT', GENERAL: 'AX1OM GENERAL', DOWNLOAD: 'AX1OM DOWNLOAD', azure: NAMES.azure, 'la-a': NAMES['la-a'] };
const supplementalGroup = id => `AX-${id.toUpperCase()}`;
// Bounded, explicit roots. Shared Google/AI resources remain under the five
// existing managed groups; no broad keyword/category inference is introduced.
const SERVICE_DOMAINS = {
  xiaohongshu: ['xiaohongshu.com','xhscdn.com','xhslink.com'],
  douyin: ['douyin.com','douyincdn.com','douyinpic.com','douyinstatic.com','bytecdn.cn'],
  bilibili: ['bilibili.com','bilivideo.com','bilivideo.cn','biliapi.net','biliapi.com'],
  kuaishou: ['kuaishou.com','kuaishouzt.com','kscdnx.com'],
  bambu: ['bambulab.com','bambulab.cn','bambuapi.com'],
  telegram: ['telegram.org','t.me','telegram.me'],
  discord: ['discord.com','discord.gg','discordapp.com','discordapp.net','discord.media'],
  facebook: ['facebook.com','facebook.net','fbcdn.net','instagram.com','cdninstagram.com'],
  tiktok: ['tiktok.com','tiktokcdn.com','tiktokv.com','muscdn.com','tiktokcdn-us.com'],
  spotify: ['spotify.com','spotifycdn.com','scdn.co','spotify.link'],
  netflix: ['netflix.com','netflix.net','netflix.com.edgesuite.net','nflximg.net','nflximg.com','nflxvideo.net','nflxso.net','nflxext.com'],
  youtube: ['youtube.com','youtu.be','youtube-nocookie.com','ytimg.com','googlevideo.com','youtubei.googleapis.com'],
  github: ['github.com','github.io','githubusercontent.com','githubassets.com','github.dev','githubsupport.com'],
  steam: ['steampowered.com','steamgames.com','steamcommunity.com','steamusercontent.com','steamstatic.com','steamcontent.com','steamcdn-a.akamaihd.net','steampipe.akamaized.net'],
  fcm: ['mtalk.google.com','fcm.googleapis.com','fcmregistrations.googleapis.com']
};
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readYAML = file => YAML.parse(fs.readFileSync(file, 'utf8'));
const groupName = id => `AX1OM ${id}`;
function validateRoutes(input) {
  const routes = input ?? DEFAULTS;
  if (!Array.isArray(routes) || routes.length !== DEFAULTS.length) throw Error('需保留全部五个业务组');
  const seen = new Set();
  for (const r of routes) {
    if (!DEFAULTS.some(d => d.id === r.id) || seen.has(r.id)) throw Error('业务标识无效或重复');
    if (!NAMES[r.primary] || !NAMES[r.backup] || r.primary === r.backup) throw Error('主备节点必须有效且不同');
    seen.add(r.id);
  }
  return clone(routes);
}
function validateSupplemental(input) {
  const supplemental = input ?? SUPPLEMENTAL_DEFAULTS;
  if (!Array.isArray(supplemental) || supplemental.length !== SUPPLEMENTAL_DEFAULTS.length) throw Error('需保留全部十九个服务');
  const seen = new Set();
  for (const route of supplemental) {
    if (!SUPPLEMENTAL_DEFAULTS.some(d => d.id === route.id) || seen.has(route.id)) throw Error('补充服务标识无效或重复');
    if (!Object.hasOwn(SUPPLEMENTAL_TARGETS, route.primary)) throw Error('补充服务出口不在安全名单');
    seen.add(route.id);
  }
  return supplemental.map(({id,primary})=>({id,primary}));
}
function providerFromProfile(profile, source, relativePath) {
  const nodes = source.proxies;
  if (!Array.isArray(nodes) || !nodes.length) throw Error('节点清单为空');
  const id = `source-${hash(String(profile.uid)).slice(0, 12)}`;
  const p = { type: profile.type === 'remote' && profile.url ? 'http' : 'file', path: relativePath,
    'health-check': { enable: false }, override: { 'additional-prefix': `${id} · ` } };
  if (p.type === 'http') { p.url = profile.url; p.interval = 3600; p.proxy = 'DIRECT'; }
  // Provider caches contain nodes only, never subscription rules, groups, or DNS.
  return { id, provider: p, cache: { proxies: clone(nodes) }, audit: {
    id, name: profile.name, type: p.type, count: nodes.length,
    sourceFingerprint: hash(profile.url || String(profile.uid)).slice(0, 16),
    nodeFingerprint: hash(JSON.stringify(nodes)).slice(0, 16), sourceRulesImported: false, sourceDNSImported: false
  } };
}
function translateRules(original, domains, routes) {
  const routeMap = new Map(routes.map(r => [r.id, groupName(r.id)]));
  const category = new Map();
  for (const [key, id] of [['openai','openai'],['claude','anthropic'],['google','google'],['xai','xai'],['slack','slack']])
    for (const domain of domains[key] || []) category.set(domain, id);
  const changes = [], output = [];
  for (const rule of original) {
    if (typeof rule !== 'string') throw Error('原规则包含无效记录');
    if (!rule.includes(',GPT Google 本机专线')) { output.push(rule); continue; }
    const domain = /DOMAIN(?:-SUFFIX)?,([^,)]+)/.exec(rule)?.[1];
    const id = category.get(domain);
    const replacement = id ? routeMap.get(id) : 'AX1OM Infrastructure';
    const next = rule.replace(/,GPT Google 本机专线(?=,|$)/g, `,${replacement}`);
    changes.push({ before: rule, after: next }); output.push(next);
  }
  // Explicit business rules precede legacy rules, but follow all existing direct/DSH guards.
  const prefixIndex = output.findIndex(r => r.includes(',AX1OM '));
  const added = [];
  for (const [domain, id] of category) {
    if (output.some(r => r.includes(`DOMAIN-SUFFIX,${domain}`) && r.includes(`,${routeMap.get(id)}`))) continue;
    added.push(`AND,((NOT,((IN-NAME,dsh-public-web))),(DOMAIN-SUFFIX,${domain})),${routeMap.get(id)}`);
  }
  output.splice(prefixIndex < 0 ? 0 : prefixIndex, 0, ...added);
  return { rules: output, changes, added };
}
function applySupplemental(originalRules, supplemental, managedDomains) {
  const changes = [], added = [], removedDuplicates = []; const out = [];
  const domainMap = new Map();
  // Exact Youtube/FCM child roots override the broad Google group; do not
  // redefine X/Slack/OpenAI/Claude as generic social/developer categories.
  for (const [id, roots] of Object.entries(SERVICE_DOMAINS)) for (const root of roots) domainMap.set(root,id);
  for (const r of originalRules) {
    if (r.startsWith('MATCH,')) { changes.push({before:r,after:`MATCH,${supplementalGroup('catchall')}`}); continue; }
    const simple = /^(DOMAIN|DOMAIN-SUFFIX),([^,]+),([^,]+)$/.exec(r);
    if (simple && domainMap.has(simple[2])) {
      changes.push({ before:r, after:`AND,((NOT,((IN-NAME,dsh-public-web))),(DOMAIN-SUFFIX,${simple[2]})),${supplementalGroup(domainMap.get(simple[2]))}` });
      continue;
    }
    // Only an observed Apple/Microsoft/Download policy is remapped; never
    // invent broad system domains, process names, IP ranges, or UID rules.
    const old = /,(Apple|Microsoft|Download)$/.exec(r)?.[1];
    if (old) {
      const id = {Apple:'apple',Microsoft:'microsoft',Download:'download'}[old];
      const next = r.replace(new RegExp(`,${old}$`),`,${supplementalGroup(id)}`);
      changes.push({before:r,after:next}); out.push(next); continue;
    }
    out.push(r);
  }
  for (const [root,id] of domainMap) {
    // Keep shared managed resources out of lower-level duplication except
    // explicit Google sub-services requested by the user.
    const overlap = Object.entries(managedDomains).some(([kind,roots]) => kind !== 'google' && (roots||[]).some(d=>root===d||root.endsWith('.'+d)));
    if (overlap) continue;
    added.push(`AND,((NOT,((IN-NAME,dsh-public-web))),(DOMAIN-SUFFIX,${root})),${supplementalGroup(id)}`);
  }
  let index = out.findIndex(r=>r.includes(',AX1OM '));
  if (index < 0) index = out.findIndex(r=>!r.startsWith('AND,((IN-NAME,dsh-public-web),') && !/,(DIRECT|REJECT)(,no-resolve)?$/.test(r));
  out.splice(index < 0 ? out.length : index,0,...added);
  out.push(`MATCH,${supplementalGroup('catchall')}`);
  const seen=new Set(); const rules=[];
  for(const r of out){if(seen.has(r)){removedDuplicates.push(r);continue;}seen.add(r);rules.push(r);}
  return {rules,changes,added,removedDuplicates};
}
function compose(current, domains, routes, nodes, providers, supplemental = SUPPLEMENTAL_DEFAULTS) {
  const candidate = clone(current);
  const rewritten = translateRules(candidate.rules || [], domains, routes);
  candidate.rules = rewritten.rules;
  candidate.mode = 'rule'; candidate['mixed-port'] = 18081; candidate['bind-address'] = '127.0.0.1';
  candidate['allow-lan'] = false; candidate.tun = { enable: false };
  for (const k of ['listeners','external-controller','external-controller-unix','external-controller-cors','secret','redir-port','tproxy-port','port','socks-port','interface-name']) delete candidate[k];
  candidate.proxies = (candidate.proxies || []).filter(p => p.name !== 'GPT Google 本机专线');
  candidate.proxies.push(...Object.values(nodes));
  // Remove dangling legacy bridge references; these can appear in groups as well as rules.
  for (const group of candidate['proxy-groups'] || []) if (Array.isArray(group.proxies))
    group.proxies = group.proxies.map(n => n === 'GPT Google 本机专线' ? 'AX1OM Infrastructure' : n);
  candidate['proxy-groups'] ||= [];
  for (const r of routes) candidate['proxy-groups'].push({ name: groupName(r.id), type: 'fallback',
    proxies: [NAMES[r.primary], NAMES[r.backup]], url: 'https://cp.cloudflare.com/generate_204',
    interval: 300, timeout: 8000, lazy: true, 'max-failed-times': 3 });
  candidate['proxy-groups'].push({ name: 'AX1OM Infrastructure', type: 'fallback',
    proxies: [NAMES.azure, NAMES.panda], url: 'https://cp.cloudflare.com/generate_204', interval: 300, timeout: 8000, lazy: true });
  candidate['proxy-providers'] = Object.fromEntries(providers.map(p => [p.id, p.provider]));
  // Main ordinary/download selections use Providers. Unverified/LAB sources cannot
  // silently enter ordinary automatic traffic. Region-specific legacy groups retain
  // their observed membership until their filters and business semantics are audited.
  const ordinary = providers.filter(p => /^Glados_[ab]$/.test(p.audit.name)).map(p => p.id);
  const download = providers.filter(p => /^Glados_[ab]$/.test(p.audit.name) || p.audit.name === '八戒').map(p => p.id);
  candidate['proxy-groups'].push({ name: 'AX1OM GENERAL', type: 'select', proxies: ordinary.length ? [] : ['REJECT'], use: ordinary });
  candidate['proxy-groups'].push({ name: 'AX1OM DOWNLOAD', type: 'select', proxies: download.length ? [NAMES.azure] : ['REJECT',NAMES.azure], use: download });
  // Keep Azure opt-in rather than the first/default download member.
  if (download.length) candidate['proxy-groups'].find(g => g.name === 'AX1OM DOWNLOAD').proxies = ['AX1OM GENERAL',NAMES.azure];
  for (const group of candidate['proxy-groups']) {
    if (group.name === 'Default Proxy') { group.type = 'select'; group.proxies = ['AX1OM GENERAL']; delete group.use; }
    if (group.name === 'Download') { group.type = 'select'; group.proxies = ['AX1OM DOWNLOAD']; delete group.use; }
  }
  candidate['proxy-groups'].push({ name: 'AX1OM LAB Providers', type: 'select', proxies: ['REJECT'], use: providers.filter(p => !ordinary.includes(p.id)).map(p => p.id) });
  for (const route of supplemental) candidate['proxy-groups'].push({name:supplementalGroup(route.id),type:'select',proxies:[SUPPLEMENTAL_TARGETS[route.primary]]});
  const supplementalRules = applySupplemental(candidate.rules,supplemental,domains);
  candidate.rules = supplementalRules.rules;
  // Names are reserved. Reject collisions instead of silently replacing an
  // existing user group with a different meaning.
  if(new Set(candidate['proxy-groups'].map(g=>g.name)).size!==candidate['proxy-groups'].length) throw Error('策略名称与现有配置冲突');
  if (candidate.dns) {
    candidate.dns.listen = '127.0.0.1:18082';
    // Preserve all existing qtype flags, MagicDNS policies and fake-IP exceptions.
    candidate.dns = JSON.parse(JSON.stringify(candidate.dns).replaceAll('GPT Google 本机专线', 'AX1OM Infrastructure'));
  }
  return { candidate, rewritten, supplementalRules };
}
function localNodes() {
  const azureSource = privateNodePath('azure');
  const azure = clone(readYAML(azureSource).proxies?.[0]);
  if (!azure || azure.type !== 'vless') throw Error('Azure 正式节点文件未就绪');
  azure.name = NAMES.azure;
  const aSource = privateNodePath('la-a');
  const a = JSON.parse(fs.readFileSync(aSource, 'utf8')).outbounds?.find(o => o.type === 'vless');
  if (!a?.tls?.reality?.public_key || !a.uuid) throw Error('洛杉矶 A 客户端认证不完整');
  const la = { name: NAMES['la-a'], type: 'vless', server: a.server, port: a.server_port, uuid: a.uuid,
    network: 'tcp', tls: true, flow: a.flow, 'client-fingerprint': a.tls.utls?.fingerprint || 'chrome',
    servername: a.tls.server_name, 'reality-opts': { 'public-key': a.tls.reality.public_key, 'short-id': a.tls.reality.short_id }, udp: true };
  const pSource = privateNodePath('panda'); const p = JSON.parse(fs.readFileSync(pSource, 'utf8'));
  if (!p.uuid || !p['reality-opts']?.['public-key']) throw Error('潘达现有认证不完整');
  const panda = { ...p, name: NAMES.panda, type: 'vless', network: 'tcp', tls: true, 'client-fingerprint': 'chrome', udp: true };
  return { nodes: { azure, 'la-a': la, panda }, sources: [azureSource, aSource, pSource] };
}
function assertFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(Error(`隔离端口 ${port} 已占用`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function validate(file, directory) {
  return new Promise(resolve => {
    const bundled = path.resolve(__dirname,'../../bin/mihomo');
    const binary = process.env.AX1OM_MIHOMO_BINARY || (fs.existsSync(bundled) ? bundled : '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo');
    const child = spawn(binary, ['-t', '-d', directory, '-f', file], { stdio: ['ignore','pipe','pipe'] });
    let log = ''; let ended = false; const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.stdout.on('data', d => { if (log.length < 200000) log += d; });
    child.stderr.on('data', d => { if (log.length < 200000) log += d; });
    function finish(code) { if (ended) return; ended = true; clearTimeout(timer); resolve({ ok: code === 0, log }); }
    child.on('error', e => { log += '\nvalidator unavailable: ' + e.code; finish(-1); }); child.on('close', finish);
  });
}
function secureWrite(file, value) { fs.writeFileSync(file, value, { mode: 0o600, flag: 'wx' }); }
async function buildCandidate(input) {
  let directory;
  try {
    const routes = validateRoutes(Array.isArray(input) ? input : input?.routes);
    const supplemental = validateSupplemental(Array.isArray(input) ? undefined : input?.supplemental);
    await assertFree(18081); await assertFree(18082);
    const base = path.join(STATE, 'candidates');
    fs.mkdirSync(base, { recursive: true, mode: 0o700 }); fs.chmodSync(base, 0o700);
    directory = fs.mkdtempSync(path.join(base, 'fleet-')); fs.chmodSync(directory, 0o700);
    fs.mkdirSync(path.join(directory, 'providers'), { mode: 0o700 });
    const currentFile = path.join(VERGE, 'clash-verge.yaml');
    const profilesFile = path.join(VERGE, 'profiles.yaml');
    const current = readYAML(currentFile); const profiles = readYAML(profilesFile).items;
    const skipped = [], providers = [];
    for (const p of profiles.filter(p => ['remote','local'].includes(p.type))) {
      try {
        if (!p.file || path.basename(p.file) !== p.file) throw Error('来源路径无效');
        const provider = providerFromProfile(p, readYAML(path.join(VERGE, 'profiles', p.file)), `./providers/${hash(p.uid).slice(0,12)}.yaml`);
        secureWrite(path.join(directory, provider.provider.path), YAML.stringify(provider.cache)); providers.push(provider);
      } catch (_) { skipped.push({ name: p.name, reason: '本地节点缓存不可读取或为空；未猜测来源' }); }
    }
    const { nodes, sources } = localNodes();
    const domains = JSON.parse(fs.readFileSync(path.join(RELAY, 'service-v2/domains.json'), 'utf8'));
    domains.slack = ['slack.com','slack-edge.com','slack-files.com','slack-imgs.com','slack-msgs.com'];
    const { candidate, rewritten, supplementalRules } = compose(current, domains, routes, nodes, providers, supplemental);
    const file = path.join(directory, 'AX1OM-Fleet.candidate.yaml'); secureWrite(file, YAML.stringify(candidate));
    // Geo assets are read-only copies into the isolated validator directory.
    for (const name of ['geoip.dat','geosite.dat','Country.mmdb','ASN.mmdb']) {
      const src = path.join(VERGE, name); if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(directory, name)); fs.chmodSync(path.join(directory,name),0o600); }
    }
    const checked = await validate(file, directory); secureWrite(path.join(directory,'validation.private.log'), checked.log);
    const notes = [
      '仅生成与语法校验；未启动候选核心、切换系统代理或修改生产服务。',
      '候选隔离监听 127.0.0.1:18081，DNS 127.0.0.1:18082；端口可用性仅代表生成时检查。',
      '主备组使用 Mihomo 原生 ordered fallback，健康检查不是实际 AI 会话验证；恢复主线路会自动回切，手动恢复与防抖监督器尚未实现。',
      '主备都不可用时没有 DIRECT 或机场成员；Mihomo 仍可能尝试首个节点并返回连接错误，不是显式 REJECT 闸门。',
      'DNS 保留实际 qtype 64/65 参数、MagicDNS 和 fake-IP 例外，但未做本轮浏览器 DNS/WebRTC/IPv6 实测。',
      'GENERAL 引用 Glados 两个 Provider，DOWNLOAD 引用 Glados/八戒并可手选 Azure；均为人工选择，未把未验收节点自动晋升。旧区域/用途分组保留节点快照待迁移。',
      '十九个具体服务独立编排；YouTube/FCM优先于通用Google，Apple/Microsoft仅复用原有已观察匹配，通用下载复用原Download，漏网MATCH位于末尾。',
      'HTTP Provider 更新后仍需验证节点身份稳定性、保留上一份有效清单机制与故障处理；未触发订阅更新。',
      'HTTP Provider 缓存包含节点认证且 URL 含订阅秘密；所有产物仅本地 0600，不应公开分享。'
    ];
    const report = { status: checked.ok ? 'CANDIDATE_SYNTAX_VALIDATED_NOT_APPLIED' : 'CANDIDATE_VALIDATION_FAILED',
      createdAt: new Date().toISOString(), routes, supplemental, sources: providers.map(p => p.audit), skipped,
      privateNodeNames: Object.values(NAMES), credentialSources: sources,
      sourceConfigHash: hash(fs.readFileSync(currentFile)), sourceProfilesHash: hash(fs.readFileSync(profilesFile)),
      changedRules: rewritten.changes, addedRules: rewritten.added,
      retainedRuleCount: new Set(current.rules.filter(rule=>candidate.rules.includes(rule))).size,
      supplementalChanges:supplementalRules.changes,supplementalAdded:supplementalRules.added,removedExactDuplicates:supplementalRules.removedDuplicates,
      ruleProviderAudit:{observed:Object.keys(current['rule-providers']||{}),remoteRulesDownloaded:false},
      dnsSource: 'Actual generated Verge YAML, copied without source Profile DNS', notes };
    const reportPath = path.join(directory, 'candidate-audit.json'); secureWrite(reportPath, JSON.stringify(report,null,2));
    return { success: checked.ok, path: file, reportPath, notes: checked.ok ? notes : ['语法校验失败，私有日志保存在候选目录。',...notes] };
  } catch (_) { return { success: false, path: null, reportPath: null, notes: ['候选构建失败：来源缺失、输入无效或隔离端口占用；未修改生产服务。', ...(directory ? [`候选目录：${directory}`] : [])] }; }
}
module.exports = { buildCandidate, validateRoutes, validateSupplemental, providerFromProfile, translateRules, applySupplemental, compose, DEFAULTS, SUPPLEMENTAL_DEFAULTS, SUPPLEMENTAL_TARGETS, SERVICE_DOMAINS, NAMES };
if (require.main === module) {
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { input += d; });
  process.stdin.on('end', async () => { try { const payload = input.trim() ? JSON.parse(input) : undefined;
    process.stdout.write(JSON.stringify(await buildCandidate(payload)) + '\n');
  } catch (_) { process.stdout.write(JSON.stringify({success:false,path:null,reportPath:null,notes:['输入 JSON 无效，未修改任何配置。']}) + '\n'); } });
}
