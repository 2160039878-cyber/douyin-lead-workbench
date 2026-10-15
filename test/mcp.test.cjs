'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const http=require('node:http');
const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');
const {Store}=require('../lib/store.cjs');
const {Service}=require('../lib/service.cjs');
const {Bridge}=require('../lib/bridge.cjs');
const {createMcpEndpoint}=require('../lib/mcp.cjs');

test('真实 MCP SDK 客户端经 HTTP 完成采集、草稿与审核保护流程（平台传输隔离模拟）',async()=>{
  const account='1234567890',store=new Store(':memory:');let enabled=true,token='mcp-test-only',url='https://www.douyin.com/',posts=0,opened=0;
  const fixtureBrowser={status:()=>({connected:true,account,url,ready:true}),call:async(op,args)=>{
    if(op==='search')return {items:[{id:'3333333333333333333',title:'本地测试视频'}],hasMore:false,cursor:0};
    if(op==='navigate'){url='https://www.douyin.com/video/'+args.videoId;return {navigate:url}}
    if(op==='comments')return {items:[{id:'1111111111111111111',user_id:'22222222222',nickname:'测试数据',body:'报价多少',created:1}],hasMore:false,cursor:0};
    if(op==='reply'){posts++;return {confirmed:true,resultId:'4444444444444444444'}}
    throw new Error('测试禁止未声明操作');
  }};
  const service=new Service(store,fixtureBrowser,{get:key=>key==='mcpToken'?token:'',set:()=>{}});service.wait=async()=>true;
  const bridge=new Bridge('browser-test-only',path.join(__dirname,'../browser/workbench.user.js'),0);
  bridge.mcpHandler=createMcpEndpoint(service,{getToken:()=>token,isEnabled:()=>enabled,openReview:()=>opened++});
  await bridge.start();
  const endpoint='http://127.0.0.1:'+bridge.port+'/mcp';
  const client=new Client({name:'workbench-test',version:'1.0.0'});
  const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer '+token}}});
  const call=async(name,args={})=>client.callTool({name,arguments:args});
  const value=result=>{assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content.find(c=>c.type==='text').text)};
  try{
    await client.connect(transport);
    const list=await client.listTools();assert.equal(list.tools.length,10);assert.ok(!list.tools.some(t=>/approve|resolve|eval|settings/.test(t.name)&&t.name!=='execute_approved'));
    const status=value(await call('get_status'));assert.equal(status.bridge.account,account);assert.ok(!JSON.stringify(status).includes(token));
    const taskId=value(await call('create_task',{search:['装修'],include:['报价'],maxVideos:1,pages:1,dwell:3})).taskId;
    value(await call('start_task',{taskId}));await service.completion;
    const leads=value(await call('list_records',{collection:'leads'})).records;assert.equal(leads.length,1);
    const draftId=value(await call('generate_draft',{taskId,commentId:leads[0].comment_id,kind:'reply',ai:false})).draftId;
    assert.equal((await call('execute_approved',{draftIds:[draftId]})).isError,true);assert.equal(posts,0);
    value(await call('open_review'));assert.equal(opened,1);assert.equal(store.draft(draftId).state,'draft');
    store.approve([{id:draftId,version:1}],account);
    value(await call('edit_draft',{draftId,content:'修改后的测试文案'}));assert.equal(store.draft(draftId).state,'draft');
    assert.equal((await call('execute_approved',{draftIds:[draftId]})).isError,true);assert.equal(posts,0);
    store.approve([{id:draftId,version:2}],account);
    value(await call('execute_approved',{draftIds:[draftId]}));await service.completion;assert.equal(posts,1);assert.equal(store.draft(draftId).state,'success');
    assert.equal((await call('execute_approved',{draftIds:[draftId]})).isError,true);assert.equal(posts,1);
    const logs=value(await call('list_records',{collection:'logs',query:'MCP',limit:2}));assert.equal(logs.records.length,2);assert.equal(logs.nextOffset,2);
    const pausedId=value(await call('create_task',{search:['暂停测试'],include:['报价'],maxVideos:1})).taskId;
    delete service.wait;
    value(await call('start_task',{taskId:pausedId}));value(await call('control_task',{action:'pause'}));await service.completion;
    assert.equal(store.task(pausedId).state,'paused');
    service.wait=async()=>true;value(await call('start_task',{taskId:pausedId}));await service.completion;assert.equal(store.task(pausedId).state,'done');
    const response=await call('create_task',{search:['装修'],include:['报价'],maxVideos:10001});assert.equal(response.isError,true);
    const wire=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:123,method:'tools/call',params:{name:'create_task',arguments:{search:['中文分片'],include:['报价']}}}));
    const boundary=wire.indexOf(Buffer.from('中文分片'))+1;
    const fragmented=await new Promise((resolve,reject)=>{
      const req=http.request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'}},res=>{
        const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){reject(e)}});
      });req.on('error',reject);req.write(wire.subarray(0,boundary));setTimeout(()=>req.end(wire.subarray(boundary)),20);
    });
    const fragmentedId=value(fragmented.result).taskId;assert.equal(store.task(fragmentedId).name,'中文分片');
    const req=async(headers={},body='{}')=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
    assert.equal((await req()).status,401);
    assert.equal((await req({Authorization:'Bearer browser-test-only'})).status,401);
    assert.equal((await req({Authorization:'Bearer '+token,Origin:'https://www.douyin.com'})).status,403);
    assert.equal((await req({Authorization:'Bearer '+token},' '.repeat(65537))).status,413);
    token='rotated-test-only';assert.equal((await req({Authorization:'Bearer mcp-test-only'})).status,401);
    enabled=false;assert.equal((await req({Authorization:'Bearer '+token})).status,503);
  }finally{await client.close();bridge.close();store.close();}
});
