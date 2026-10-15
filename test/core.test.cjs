'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Store } = require('../lib/store.cjs');
const { Service } = require('../lib/service.cjs');
const { Bridge } = require('../lib/bridge.cjs');
const { taskConfig, matchComment, platformId, dayKey, csv } = require('../lib/rules.cjs');
const config = () => taskConfig({search:'装修',include:'报价,预算',exclude:'不需要',maxVideos:2,pages:3,maxComments:40,dwell:3});
const account='1234567890';
function seed(file=':memory:') {
  const store=new Store(file), taskId=store.createTask(config(),account),t=store.task(taskId);
  const c={id:'1111111111111111111',user_id:'22222222222',nickname:'测试用户',body:'请问报价多少',created:1000};
  store.addComment(t,{id:'3333333333333333333',title:'测试视频'},c,'装修',matchComment(c.body,t.config));
  return {store,taskId,c,source:store.source(c.id,taskId)};
}
const secrets={get:()=>'',set:()=>{}};
test('筛选、排除、ID精度与CSV公式保护',()=>{
  assert.equal(matchComment('不需要报价',config()).matched,false);
  assert.equal(matchComment('请问报价',config()).matched,true);
  assert.equal(matchComment('报价',{...config(),match:'all'}).matched,false);
  assert.throws(()=>platformId(9999999999999999999));
  assert.equal(dayKey(Date.UTC(2026,9,14,16)), '2026-10-15');
  assert.ok(csv([{a:'=CMD()',b:'正常'}]).includes("'=CMD()"));
});
test('相同评论去重且不同任务来源保留；审核修改、账号和重复发送守卫',()=>{
  const {store,taskId,c,source}=seed();
  store.addComment(store.task(taskId),{id:source.video_id,title:'视频'},c,'装修',matchComment(c.body,config()));
  assert.equal(store.snapshot().leads.length,1);
  const id=store.addDraft(source,taskId,'reply','已审核文案');
  assert.throws(()=>store.claim(id,account));
  store.approve([{id,version:1}],account);
  store.editDraft(id,'修改后的文案');
  assert.equal(store.draft(id).state,'draft');assert.throws(()=>store.claim(id,account));
  assert.throws(()=>store.approve([{id,version:1}],account));
  store.approve([{id,version:2}],account);assert.throws(()=>store.claim(id,'999999'));
  const d=store.claim(id,account);store.finish(d,'success','4444444444');
  const second=store.addDraft(source,taskId,'reply','第二条');store.approve([{id:second,version:1}],account);
  assert.throws(()=>store.claim(second,account),/重复/);
  store.close();
});
test('发送超时进入待核实且不会继续发送；重启恢复',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lead-test-'));const file=path.join(dir,'test.db');
  const {store,taskId,source}=seed(file);let calls=0;
  const bridge={status:()=>({connected:true,account}),call:async()=>{calls++;throw new Error('超时')}};
  const service=new Service(store,bridge,secrets);service.wait=async()=>true;
  const id=store.addDraft(source,taskId,'dm','测试私信');store.approve([{id,version:1}],account);
  service.execute([id]);await service.completion;
  assert.equal(calls,1);assert.equal(store.draft(id).state,'uncertain');
  assert.throws(()=>service.execute([id]));
  const id2=store.addDraft(source,taskId,'reply','待恢复');store.approve([{id:id2,version:1}],account);store.claim(id2,account);
  store.close();const reopened=new Store(file);assert.equal(reopened.draft(id2).state,'uncertain');reopened.close();
});
test('无可靠回执不记成功；人工核实必须说明依据',async()=>{
  const {store,taskId,source}=seed();const bridge={status:()=>({connected:true,account}),call:async()=>({confirmed:false})};
  const service=new Service(store,bridge,secrets);service.wait=async()=>true;
  const id=store.addDraft(source,taskId,'dm','测试');store.approve([{id,version:1}],account);service.execute([id]);await service.completion;
  assert.equal(store.draft(id).state,'uncertain');assert.throws(()=>service.resolve({id,state:'success',note:''}));
  service.resolve({id,state:'success',note:'测试模拟核实依据'});assert.equal(store.draft(id).result_id,'manual');store.close();
});
test('分页终止、重复页、评论去重与真实导航先于采集',async()=>{
  const store=new Store(':memory:');const ops=[];let comments=0,url='https://www.douyin.com/';
  const bridge={status:()=>({connected:true,account,url,ready:true}),call:async(op,args)=>{
    ops.push(op);
    if(op==='search')return {items:[{id:'3333333333333333333',title:'装修'}],hasMore:false,cursor:0};
    if(op==='navigate'){url='https://www.douyin.com/video/'+args.videoId;return {navigate:url}}
    if(op==='comments'){comments++;return {items:[{id:'1111111111111111111',user_id:'2222222222',nickname:'测试',body:'报价',created:1}],hasMore:true,cursor:comments*20}}
  }};
  const service=new Service(store,bridge,secrets);service.wait=async()=>true;
  const id=service.createTask(config());service.startTask(id);await service.completion;
  assert.equal(store.task(id).state,'done');assert.equal(store.snapshot().leads.length,1);assert.equal(comments,3);
  assert.ok(ops.indexOf('navigate')<ops.indexOf('comments'));store.close();
});
test('只读请求限流不重试；模型配置避免密钥跨服务泄露',async()=>{
  const {store}=seed();let calls=0;const saved={apiKey:'test-only-placeholder'};
  const service=new Service(store,{call:async()=>{calls++;throw new Error('平台请求失败 HTTP 429')}},{get:k=>saved[k]||'',set:(k,v)=>saved[k]=v});
  await assert.rejects(service.read('search',{},account),/429/);assert.equal(calls,1);
  assert.throws(()=>service.saveSettings({...service.settings(),baseUrl:'https://example.org/v1'}),/重新填写/);
  assert.equal(service.safeError(new Error(saved.apiKey)),'[已隐藏]');store.close();
});
test('本机桥接拒绝无认证请求、来源伪造与通用执行；超时不重发',async()=>{
  const bridge=new Bridge('test-only-token',path.join(__dirname,'../browser/workbench.user.js'),19429);await bridge.start();
  const endpoint='http://127.0.0.1:19429';
  try{
    assert.equal((await fetch(endpoint+'/poll',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(endpoint+'/poll',{method:'POST',headers:{Authorization:'Bearer test-only-token',Origin:'https://evil.example'},body:'{}'})).status,403);
    await assert.rejects(bridge.call('eval',{},account),/不允许/);
    const clientId='11111111-1111-4111-8111-111111111111',base={clientId,account,url:'https://www.douyin.com/',ready:true};
    const post=async(route,body)=>(await fetch(endpoint+route,{method:'POST',headers:{Authorization:'Bearer test-only-token'},body:JSON.stringify(body)})).json();
    await post('/poll',base);
    const pending=bridge.call('reply',{text:'测试'},account,80);const rejected=assert.rejects(pending,/超时/);
    const command=await post('/poll',base);assert.equal(command.op,'reply');
    assert.equal((await post('/poll',base)).idle,true);await rejected;assert.equal((await post('/poll',base)).idle,true);
  }finally{bridge.close()}
});
test('生成浏览器脚本语法和固定操作入口；不携带上游令牌',()=>{
  const api=fs.readFileSync(path.join(__dirname,'../vendor/api.js'),'utf8');
  const userscript=fs.readFileSync(path.join(__dirname,'../browser/workbench.user.js'),'utf8');
  new vm.Script(api);new vm.Script(userscript);
  assert.ok(!userscript.includes('msg.expression'));assert.ok(!/token:\s*'[a-f0-9]{30}/.test(userscript));
  assert.ok(api.includes('encodeUint64Field(3, opts.conversation_short_id'));
});
test('关键词搜索自动取下一页；模型错误不生成假草稿',async()=>{
  const {store,taskId,source}=seed();let calls=0,url='https://www.douyin.com/';
  const bridge={status:()=>({connected:true,account,url,ready:true}),call:async(op,args)=>{
    if(op==='search'){calls++;return {items:[{id:calls===1?'5555555555555555555':'6666666666666666666',title:'分页视频'}],hasMore:calls===1,cursor:calls*10}}
    if(op==='navigate'){url='https://www.douyin.com/video/'+args.videoId;return {navigate:url}}
    if(op==='comments')return {items:[],hasMore:false,cursor:0};
  }};
  const secret={get:()=> 'test-only',set:()=>{}};
  const service=new Service(store,bridge,secret);service.wait=async()=>true;
  const id=service.createTask(config());service.startTask(id);await service.completion;
  assert.equal(calls,2);assert.equal(store.task(id).progress.visited,2);
  assert.equal(service.state().stats.videos,2);
  store.meta('settings',{baseUrl:'https://example.invalid/v1',model:'test'});
  const original=global.fetch;global.fetch=async()=>({ok:false,status:503});
  try{await assert.rejects(service.generate({commentId:source.id,taskId,kind:'reply',ai:true}),/HTTP 503/);assert.equal(store.snapshot().drafts.length,0)}finally{global.fetch=original;store.close()}
});
