'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const home = process.env.AX1OM_HOME || os.homedir();
const support = path.join(home, 'Library/Application Support');
const root = process.env.AX1OM_STATE_ROOT || path.join(support, 'AX1OM');
const relayRoot = process.env.AX1OM_RELAY_ROOT || path.join(support, 'GPT Google Relay');
const vergeRoot = process.env.AX1OM_VERGE_ROOT || path.join(support, 'io.github.clash-verge-rev.clash-verge-rev');
const runtimeRoot = path.join(root, 'runtime');
const YAML = require('./vendor/yaml');
function ownRuntimeExists() { return fs.existsSync(path.join(runtimeRoot, 'config.yaml')); }
function runtimeConfigFile() {
  if (!ownRuntimeExists()) return path.join(vergeRoot, 'clash-verge.yaml');
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'controller.json'), 'utf8'));
    const candidate = value.configPath;
    if (typeof candidate === 'string' && path.isAbsolute(candidate) && candidate.startsWith(runtimeRoot + path.sep) && fs.statSync(candidate).isFile() && fs.realpathSync(candidate).startsWith(fs.realpathSync(runtimeRoot) + path.sep)) return candidate;
  } catch {}
  return path.join(runtimeRoot, 'config.yaml');
}
function controllerMetadata() {
  const value = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'controller.json'), 'utf8'));
  if (typeof value.secret !== 'string' || !value.secret) throw Error('CONTROL_UNAVAILABLE');
  if (typeof value.socketPath === 'string' && path.isAbsolute(value.socketPath)) return {socketPath:value.socketPath,secret:value.secret};
  if (value.host === '127.0.0.1' && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535) return {host:value.host,port:value.port,secret:value.secret};
  throw Error('CONTROL_UNAVAILABLE');
}
function privateNodePath(id) {
  const key = {azure:'AX1OM_AZURE_CONFIG','la-a':'AX1OM_LA_CONFIG',panda:'AX1OM_PANDA_CONFIG'}[id];
  if (key && process.env[key]) return process.env[key];
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(root,'sources/legacy-paths.json'),'utf8'));
    if (typeof settings.privatePaths?.[id] === 'string' && path.isAbsolute(settings.privatePaths[id])) return settings.privatePaths[id];
  } catch {}
  return id === 'panda' ? path.join(relayRoot,'node.json') : path.join(root,'imports',id+'.json');
}
module.exports = {privateNodePath,home,root,relayRoot,vergeRoot,runtimeRoot,YAML,ownRuntimeExists,runtimeConfigFile,controllerMetadata};
