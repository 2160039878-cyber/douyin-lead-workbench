'use strict';
// 固定提交中只提取需要的浏览器方法；不携带上游通用 eval 服务、配置或令牌。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const target = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/douyin.user.js'), 'utf8').replace(/\r/g, '');
const start = source.indexOf('  var BRIDGE_CODE = (function () {/*') + '  var BRIDGE_CODE = (function () {/*'.length;
const end = source.indexOf('*/}).toString()', start);
if (start < 40 || end < start) throw new Error('上游文件结构变化');
const core = source.slice(start, end);
const methods = ['_q', 'getComments', 'search', 'publish', '_getMyUidStrict', 'createConversation', 'sendDM'];
function extract(name) {
  const marker = '  ' + name + ':';
  const begin = core.indexOf(marker);
  if (begin < 0) throw new Error('缺少上游方法 ' + name);
  const tail = core.slice(begin + marker.length);
  const next = tail.search(/^  [A-Za-z_][A-Za-z_0-9]*:/m);
  const block = core.slice(begin, next < 0 ? core.lastIndexOf('};') : begin + marker.length + next);
  const close = block.lastIndexOf('\n  },');
  if (close < 0) throw new Error('方法边界变化 ' + name);
  return block.slice(0, close + 4);
}
let api = 'var PAGE_LOAD_TIME=Date.now();\n' +
  core.slice(core.indexOf('function getCookie'), core.indexOf('// 统一 fetch')) + '\n' +
  `async function bridgeFetchJson(label,url,init){
    const r=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('平台请求失败 HTTP '+r.status);
    let d;try{d=await r.json()}catch{throw new Error('平台返回非 JSON，请检查登录、验证码或限流')}
    if(d.status_code!==undefined&&d.status_code!==0)throw new Error('平台拒绝请求，状态 '+d.status_code);
    return d;
  }
  function _parseMyUid(info){const id=info?.user_uid||info?.user?.uid||'';return typeof id==='number'&&!Number.isSafeInteger(id)?'':(/^\\d{5,30}$/.test(String(id))?String(id):'')}
  ` + '\nwindow.__leadApi = {\n' + methods.map(extract).join(',\n') + '\n};\n';
api = api.replaceAll('window.__bridge', 'window.__leadApi').replace('this._getMyUid()', 'this._getMyUidStrict()');
api = api.replaceAll('var keys=_DM_HELPERS.getDMKeys();', "var keys=_DM_HELPERS.getDMKeys();if(!keys.ticket||!keys.privateKey||!keys.client_cert)throw new Error('当前页面缺少私信会话信息，请在抖音检查私信功能');")
  .replaceAll('var reqSign=await _DM_HELPERS.ecdsaSign(keys.privateKey,signData);', "var reqSign=await _DM_HELPERS.ecdsaSign(keys.privateKey,signData);if(!reqSign)throw new Error('当前私信会话签名不可用，未发送请求');");
api = api.replace("String(Number(sendCelltime)+5000+Math.floor(Math.random()*30000))", 'sendCelltime')
  .replace("Math.random()<0.9?'non_paste':'paste'", "'paste'")
  .replace("Math.random()<0.85?'others_homepage':'search_result'", "'search_result'")
  .replace("Math.random()<0.85?'others_homepage':'homepage'", "'search_result'");
api = api.replace(/console\.warn\([^\n]+\);/g, '')
  .replace(/throw new Error\('\[createConversation\] HTTP '[^;]+;/g, "throw new Error('私信会话请求失败 HTTP '+resp.status);")
  .replace(/throw new Error\('\[sendDM\] HTTP '[^;]+;/g, "throw new Error('私信请求失败 HTTP '+resp.status);")
  .replace(/throw new Error\('\[createConversation\] 未找到会话: '[^;]+;/g, "throw new Error('平台未返回可用私信会话');");
let dm = fs.readFileSync(path.join(root, 'scripts/dm-bridge-lib.js'), 'utf8');
// 上游用 32 位整数编码 64 位会话 ID，会截断；按同仓库 proto 的 int64 保持精度。
dm = dm.replace('encodeIntField(3, opts.conversation_short_id || 0)', 'encodeUint64Field(3, opts.conversation_short_id || 0)');
const selected = ('// Derived from Yht20927/douyin-cli @ 4073159bea585de6d33a4747a475669440737932 (MIT)\n' + dm + '\n' + api).replace(/[ \t]+$/gm, '');
fs.mkdirSync(path.join(target, 'vendor'), { recursive: true });
fs.mkdirSync(path.join(target, 'browser'), { recursive: true });
fs.writeFileSync(path.join(target, 'vendor/api.js'), selected);
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'vendor/LICENSE'));
fs.writeFileSync(path.join(target, 'vendor/ORIGIN.txt'), 'https://github.com/Yht20927/douyin-cli\nCommit: 4073159bea585de6d33a4747a475669440737932\nMIT. Selected browser methods; removed general eval transport, random posting metadata and raw response errors. Fixed int64 encoding. DM acknowledgement remains unverified.\n');
const transport = fs.readFileSync(path.join(target, 'browser/transport.js'), 'utf8');
fs.writeFileSync(path.join(target, 'browser/workbench.user.js'), transport.replace('/*__API_SOURCE__*/', JSON.stringify(selected)));
