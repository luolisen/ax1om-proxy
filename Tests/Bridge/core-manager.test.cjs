'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {context,prepare,handle,validName,ownedProcess}=require('../../Sources/AX1OM/Resources/core-manager.cjs');
const YAML=require('../../Sources/AX1OM/Resources/vendor/yaml');
const binary=path.resolve(__dirname,'../../vendor-runtime/bin/mihomo');
function fixture(){const root=fs.mkdtempSync('/tmp/ax1om-core-test-');return context({AX1OM_STATE_ROOT:root,AX1OM_MIHOMO_BINARY:binary},[]);}
function clean(c){fs.rmSync(c.root,{recursive:true,force:true});fs.rmSync(c.socketDir,{recursive:true,force:true});}
function api(c,method,url,body){const metadata=JSON.parse(fs.readFileSync(path.join(c.runtime,'controller.json'),'utf8'));return new Promise((resolve,reject)=>{const req=http.request({socketPath:metadata.socketPath,path:url,method,headers:{Authorization:'Bearer '+metadata.secret,'Content-Type':'application/json'}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({code:res.statusCode,data:data?JSON.parse(data):{}}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});}
test('owned state and socket are isolated with private permissions',()=>{const a=fixture(),b=fixture();try{const metadata=prepare(a);prepare(b);assert.notEqual(a.socketDir,b.socketDir);assert.equal(metadata.secret.length,64);assert.equal(fs.statSync(a.runtime).mode&0o777,0o700);assert.equal(fs.statSync(path.join(a.runtime,'controller.json')).mode&0o777,0o600);assert.equal(ownedProcess(a,{pid:process.pid,binary:fs.realpathSync(binary),configPath:path.join(a.runtime,'config.yaml')}),false);}finally{clean(a);clean(b);}});
test('guards reject unknown action, name, privilege and socket substitution',async()=>{const c=fixture();try{assert.equal(validName('group/name'),true);assert.equal(validName('bad\nname'),false);await assert.rejects(handle({action:'delete-all'},c));assert.throws(()=>context({},['--privileged','/Users/other','500','20','--start-tun']));prepare(c);fs.writeFileSync(path.join(c.runtime,'controller.json'),JSON.stringify({socketPath:'/tmp/foreign.sock',secret:'a'.repeat(64)}));assert.throws(()=>prepare(c));}finally{clean(c);}});
test('real isolated core preserves PID and live transfer across selection and provider update', {skip:!fs.existsSync(binary),timeout:60000},async()=>{
  const c=fixture();let request,response,server;
  try{
    prepare(c);fs.writeFileSync(path.join(c.runtime,'fixture.yaml'),YAML.stringify({proxies:[{name:'Fixture Direct',type:'direct'}]}),{mode:0o600});
    const config={'mixed-port':17901,ipv6:false,mode:'rule','log-level':'warning',tun:{enable:true,'auto-route':true},dns:{enable:false},'proxy-providers':{fixture:{type:'file',path:'fixture.yaml','health-check':{enable:false}}},'proxy-groups':[{name:'Test Select',type:'select',proxies:['DIRECT','REJECT'],use:['fixture']}],rules:['MATCH,Test Select']};
    fs.writeFileSync(path.join(c.runtime,'config.yaml'),YAML.stringify(config),{mode:0o600});
    const started=await handle({action:'start-isolated'},c);assert.equal(started.running,true);assert.equal(started.mode,'isolated');const pid=started.pid;
    await assert.rejects(handle({action:'preflight-tun'},c),/其他 Mihomo/);
    assert.equal(YAML.parse(fs.readFileSync(started.configPath,'utf8')).tun.enable,false);assert.equal(YAML.parse(fs.readFileSync(path.join(c.runtime,'config.yaml'),'utf8')).tun.enable,true);
    server=http.createServer((req,res)=>{response=res;res.writeHead(200,{'Content-Type':'text/plain'});res.write('begin\n');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let received='';
    await new Promise((resolve,reject)=>{request=http.get({host:'127.0.0.1',port:17901,headers:{Host:`127.0.0.1:${server.address().port}`},path:`http://127.0.0.1:${server.address().port}/ongoing`},res=>{res.on('data',data=>{received+=data;resolve();});res.on('error',reject);res.on('end',()=>{if(!received)reject(Error('Fixture stream ended without bytes'));});});request.setTimeout(5000,()=>request.destroy(Error('Fixture stream timeout')));request.on('error',reject);});
    const before=(await api(c,'GET','/connections')).data.connections;assert.equal(before.length,1);const id=before[0].id;
    await handle({action:'select-node',group:'Test Select',node:'Fixture Direct'},c);
    fs.writeFileSync(path.join(c.runtime,'fixture.yaml'),YAML.stringify({proxies:[{name:'Fixture Direct',type:'direct'},{name:'Fixture Direct 2',type:'direct'}]}),{mode:0o600});
    await handle({action:'update-provider',name:'fixture'},c);
    assert.equal((await handle({action:'status'},c)).pid,pid);
    assert.ok((await api(c,'GET','/connections')).data.connections.some(connection=>connection.id===id));
    response.write('after-provider-update\n');await new Promise(resolve=>setTimeout(resolve,50));assert.ok(received.includes('after-provider-update'));
    const providers=(await api(c,'GET','/providers/proxies')).data.providers;assert.equal(providers.fixture.proxies.length,2);
    await assert.rejects(handle({action:'select-node',group:'Test Select',node:'missing'},c));
    await handle({action:'reload-config'},c);assert.equal((await handle({action:'status'},c)).pid,pid);
    const lastValid=fs.readFileSync(started.configPath,'utf8');
    fs.writeFileSync(path.join(c.runtime,'config.yaml'),'proxy-groups: [invalid');
    await assert.rejects(handle({action:'reload-config'},c));
    assert.equal(fs.readFileSync(started.configPath,'utf8'),lastValid);assert.equal((await handle({action:'status'},c)).pid,pid);
    assert.equal((await handle({action:'stop'},c)).running,false);
  }finally{request?.destroy();response?.end();try{await handle({action:'stop'},c);}catch{}if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}clean(c);}
});
