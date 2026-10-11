'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');
const YAML = require('./vendor/yaml');

class CoreError extends Error {}
function context(env = process.env, args = process.argv.slice(2)) {
  let home = env.AX1OM_HOME || os.homedir(), uid = process.getuid(), gid = process.getgid();
  if (args[0] === '--privileged') {
    if (process.getuid() !== 0 || args.length !== 5 || !['--start-tun','--stop'].includes(args[4])) throw new CoreError('管理员启动参数无效。');
    home = args[1]; uid = Number(args[2]); gid = Number(args[3]);
    if (!Number.isInteger(uid) || uid < 500 || !Number.isInteger(gid) || gid < 0 || !home.startsWith('/Users/') || path.resolve(home) !== home || fs.lstatSync(home).isSymbolicLink() || fs.statSync(home).uid !== uid) throw new CoreError('本机用户目录校验失败。');
  }
  const root = args[0] === '--privileged' ? path.join(home,'Library/Application Support/AX1OM') : env.AX1OM_STATE_ROOT || path.join(home,'Library/Application Support/AX1OM');
  const runtime = path.join(root,'runtime');
  const bundledBinary = path.resolve(__dirname,'../../bin/mihomo');
  const binary = args[0] === '--privileged' ? bundledBinary : env.AX1OM_MIHOMO_BINARY || bundledBinary;
  const suffix=crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0,12);
  return {home,uid,gid,root,runtime,binary,socketDir:path.join(process.platform==='darwin'?'/tmp':os.tmpdir(),`ax1om-core-${uid}-${suffix}`),privileged:args[0]==='--privileged'};
}
function safeDir(dir,c) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const s=fs.lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || ![c.uid,process.getuid()].includes(s.uid)) throw new CoreError('工作目录不属于当前用户。');
  fs.chmodSync(dir,0o700); if(c.privileged) fs.chownSync(dir,c.uid,c.gid);
}
function writePrivate(file,value,c) {
  if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new CoreError('拒绝写入符号链接。');
  const temporary=file+'.'+crypto.randomBytes(5).toString('hex');
  fs.writeFileSync(temporary,value,{mode:0o600,flag:'wx'}); if(c.privileged) fs.chownSync(temporary,c.uid,c.gid);
  fs.renameSync(temporary,file); fs.chmodSync(file,0o600);
}
function prepare(c) {
  safeDir(c.root,c); safeDir(c.runtime,c); safeDir(c.socketDir,c);
  const metadataFile=path.join(c.runtime,'controller.json');
  let metadata;
  if(fs.existsSync(metadataFile)) {
    if(fs.lstatSync(metadataFile).isSymbolicLink()) throw new CoreError('控制接口元数据无效。');
    metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
    if(metadata.socketPath!==path.join(c.socketDir,'control.sock') || typeof metadata.secret!=='string' || metadata.secret.length<16) throw new CoreError('控制接口元数据无效。');
  } else metadata={socketPath:path.join(c.socketDir,'control.sock'),secret:crypto.randomBytes(32).toString('hex')};
  writePrivate(metadataFile,JSON.stringify(metadata),c);
  return metadata;
}
function readState(c) { try { return JSON.parse(fs.readFileSync(path.join(c.runtime,'process.json'),'utf8')); } catch { return null; } }
function ownedProcess(c,state=readState(c)) {
  if(!state || !Number.isInteger(state.pid) || state.pid<2 || state.binary!==fs.realpathSync(c.binary) || ![path.join(c.runtime,'config.yaml'),path.join(c.runtime,'isolated.yaml')].includes(state.configPath)) return false;
  const r=spawnSync('/bin/ps',['-p',String(state.pid),'-o','command='],{encoding:'utf8',timeout:2500});
  return r.status===0 && r.stdout.trim().startsWith(state.binary+' ') && r.stdout.includes(`-d ${c.runtime}`) && r.stdout.includes(`-f ${state.configPath}`);
}
function status(c,message) {
  const state=readState(c); let running=false;
  try { running=ownedProcess(c,state); } catch {}
  return {running,mode:running?state.mode:'stopped',pid:running?state.pid:null,message:message||(running?'独立内核运行中。':'独立内核未启动。'),configPath:running?state.configPath:path.join(c.runtime,'config.yaml')};
}
function verifyConfig(c,file) {
  const s=fs.lstatSync(file); if(!s.isFile() || s.isSymbolicLink() || s.size>8_000_000 || !fs.realpathSync(file).startsWith(fs.realpathSync(c.runtime)+path.sep)) throw new CoreError('配置文件校验失败。');
  const result=spawnSync(c.binary,['-t','-d',c.runtime,'-f',file],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000});
  if(result.status!==0) throw new CoreError('独立内核配置未通过校验；原始输出已隐藏。');
}
function guardTUN(c,requirePrivilege=true) {
  const list=spawnSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8',timeout:2500}).stdout||'';
  if(list.split('\n').some(line=>/(?:^|\/|\s)(?:verge-mihomo(?:-alpha)?|mihomo)(?:\s|$)/.test(line))) throw new CoreError('其他 Mihomo 内核仍在运行。请先按迁移说明关闭旧 TUN，再启动 AX1OM。');
  if(requirePrivilege && !c.privileged && process.getuid()!==0) throw new CoreError('TUN 需要通过应用的管理员授权启动。');
}
function request(c,metadata,method,url,body) {
  return new Promise((resolve,reject)=>{
    const payload=body?JSON.stringify(body):undefined;
    const req=http.request({socketPath:metadata.socketPath,path:url,method,headers:{Authorization:'Bearer '+metadata.secret,'Content-Type':'application/json',...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},res=>{
      let data='',bytes=0; res.on('data',chunk=>{bytes+=chunk.length;if(bytes>4_000_000)req.destroy();else data+=chunk});res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300) return reject(new CoreError(`独立内核接口返回 ${res.statusCode}；操作未完成。`));
        try { resolve(data?JSON.parse(data):{}); } catch { reject(new CoreError('独立内核响应格式无效。')); }
      });
    });
    req.setTimeout(12000,()=>req.destroy());req.on('error',()=>reject(new CoreError('独立内核控制接口不可用。')));if(payload)req.write(payload);req.end();
  });
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(c,isolated) {
  const metadata=prepare(c); if(status(c).running) throw new CoreError('独立内核已启动；没有重复启动。');
  if(!isolated) guardTUN(c);
  const source=path.join(c.runtime,'config.yaml');
  if(!fs.existsSync(source)) throw new CoreError('请先导入订阅并生成配置。');
  const config=YAML.parse(fs.readFileSync(source,'utf8'));
  if(!config || typeof config!=='object') throw new CoreError('配置格式无效。');
  config['external-controller-unix']=metadata.socketPath;config.secret=metadata.secret;
  delete config['external-controller'];delete config['external-controller-tls'];delete config['external-controller-pipe'];
  config['allow-lan']=false;config['bind-address']='127.0.0.1';
  config.tun={...(config.tun||{}),enable:!isolated};
  if(isolated) { config['mixed-port']=17901;config.port=0;config['socks-port']=0;config['redir-port']=0;config['tproxy-port']=0;config.dns={...(config.dns||{}),listen:'127.0.0.1:17953'}; }
  const file=path.join(c.runtime,isolated?'isolated.yaml':'config.yaml');
  if(!isolated) writePrivate(source+'.before-start',fs.readFileSync(source),c);
  writePrivate(file,YAML.stringify(config),c);verifyConfig(c,file);
  if(fs.existsSync(metadata.socketPath))fs.unlinkSync(metadata.socketPath);
  const log=fs.openSync(path.join(c.runtime,'core.log'),'a',0o600);
  const child=spawn(c.binary,['-d',c.runtime,'-f',file],{detached:true,stdio:['ignore',log,log],env:{HOME:c.home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
  child.on('error',()=>{});
  fs.closeSync(log);child.unref();
  writePrivate(file+'.last-valid',fs.readFileSync(file),c);
  const state={pid:child.pid,binary:fs.realpathSync(c.binary),mode:isolated?'isolated':'tun',configPath:file};
  writePrivate(path.join(c.runtime,'process.json'),JSON.stringify(state),c);
  metadata.configPath=file;writePrivate(path.join(c.runtime,'controller.json'),JSON.stringify(metadata),c);
  for(let i=0;i<40;i++) {
    await wait(100);
    if(fs.existsSync(metadata.socketPath)) {
      fs.chmodSync(metadata.socketPath,0o600);if(c.privileged)fs.chownSync(metadata.socketPath,c.uid,c.gid);
      try { await request(c,metadata,'GET','/version'); return status(c,isolated?'独立测试内核已启动，TUN 未开启。':'TUN 内核已启动。'); } catch {}
    }
    if(!ownedProcess(c,state)) break;
  }
  if(ownedProcess(c,state))process.kill(state.pid,'SIGTERM');
  throw new CoreError('独立内核未能完成启动；没有变更其他代理。');
}
async function stop(c) {
  const state=readState(c);
  if(!ownedProcess(c,state)) return status(c,'独立内核已停止。');
  try { process.kill(state.pid,'SIGTERM'); } catch { throw new CoreError('该内核需要通过管理员授权停止。'); }
  for(let i=0;i<40;i++){await wait(100);if(!ownedProcess(c,state))return status(c,'独立内核已停止。');}
  throw new CoreError('内核停止尚未完成；没有强制结束其他进程。');
}
function validName(value) { return typeof value==='string' && value.length>0 && Buffer.byteLength(value)<=512 && !/[\x00-\x1f]/.test(value); }
async function handle(input,c=context()) {
  if(!input || !['prepare','status','preflight-tun','start-isolated','start-tun','stop','reload-config','select-node','update-provider'].includes(input.action)) throw new CoreError('不支持的内核操作。');
  if(input.action==='status') return status(c);
  if(input.action==='preflight-tun'){guardTUN(c,false);return status(c,'TUN 启动前检查已通过。');}
  if(input.action==='prepare'){prepare(c);return status(c,'独立内核工作目录已准备。');}
  if(input.action==='start-isolated')return start(c,true);
  if(input.action==='start-tun')return start(c,false);
  if(input.action==='stop')return stop(c);
  if(!status(c).running)throw new CoreError('独立内核未运行。');
  const metadata=prepare(c);
  if(input.action==='select-node') {
    if(!validName(input.group)||!validName(input.node))throw new CoreError('节点选择参数无效。');
    const groups=await request(c,metadata,'GET','/proxies');const group=groups.proxies?.[input.group];
    if(group?.type!=='Selector'||!group.all?.includes(input.node))throw new CoreError('选择必须来自该策略组的现有节点。');
    await request(c,metadata,'PUT','/proxies/'+encodeURIComponent(input.group),{name:input.node});
    return status(c,'已切换该策略组；内核未重启。');
  }
  if(input.action==='update-provider') {
    if(!validName(input.name))throw new CoreError('订阅名称无效。');
    const providers=await request(c,metadata,'GET','/providers/proxies');if(!providers.providers?.[input.name])throw new CoreError('订阅不在当前内核中。');
    await request(c,metadata,'PUT','/providers/proxies/'+encodeURIComponent(input.name));
    return status(c,'订阅已更新；内核未重启。');
  }
  const state=readState(c),file=state.configPath;
  const backup=file+'.last-valid';
  try {
    const config=YAML.parse(fs.readFileSync(path.join(c.runtime,'config.yaml'),'utf8'));
    config['external-controller-unix']=metadata.socketPath;config.secret=metadata.secret;
    delete config['external-controller'];delete config['external-controller-tls'];delete config['external-controller-pipe'];
    config['allow-lan']=false;config['bind-address']='127.0.0.1';config.tun={...(config.tun||{}),enable:state.mode==='tun'};
    if(state.mode==='isolated'){config['mixed-port']=17901;config.port=0;config['socks-port']=0;config['redir-port']=0;config['tproxy-port']=0;config.dns={...(config.dns||{}),listen:'127.0.0.1:17953'};}
    writePrivate(file,YAML.stringify(config),c);verifyConfig(c,file);
    await request(c,metadata,'PUT','/configs',{path:file});writePrivate(backup,fs.readFileSync(file),c);
  }
  catch(error){if(fs.existsSync(backup)){writePrivate(file,fs.readFileSync(backup),c);try{await request(c,metadata,'PUT','/configs',{path:file});}catch{}}throw error;}
  return status(c,'配置已载入；内核未重启。');
}
if(require.main===module) {
  if(process.argv[2]==='--privileged') {
    (async()=>{try{const c=context();const result=await handle({action:process.argv[6]==='--start-tun'?'start-tun':'stop'},c);process.stdout.write(JSON.stringify(result));}catch(error){process.stdout.write(JSON.stringify({running:false,mode:'error',pid:null,message:error instanceof CoreError?error.message:'管理员内核操作失败。',configPath:''}));process.exitCode=1;}})();
  } else {
  let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{data+=chunk;if(Buffer.byteLength(data)>65536)process.exit(2)});
  process.stdin.on('end',async()=>{
    try { const input=JSON.parse(data);const c=context();if(c.privileged&&!['start-tun','stop'].includes(input.action))throw new CoreError('管理员操作仅限 TUN 启停。');const result=await handle(input,c);process.stdout.write(JSON.stringify(result)); }
    catch(error){process.stdout.write(JSON.stringify({running:false,mode:'error',pid:null,message:error instanceof CoreError?error.message:'独立内核操作失败；敏感原始输出已隐藏。',configPath:''}));process.exitCode=1;}
  });
  }
}
module.exports={context,prepare,handle,status,ownedProcess,validName,CoreError};
