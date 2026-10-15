'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles = {dashboard:'工作台',tasks:'搜索采集',leads:'潜客列表',review:'审核发送',logs:'操作日志',settings:'设置'};
const labels = {ready:'待开始',running:'运行中',paused:'已暂停',stopped:'已停止',done:'已完成',draft:'待审核',approved:'已批准',sending:'执行中',success:'成功',failed:'失败',uncertain:'待核实',skipped:'已跳过',keep:'保留',exclude:'已排除',followed:'已跟进'};
const kindLabel = {reply:'评论回复',dm:'私信',task:'任务',search:'搜索',comments:'评论采集',browse:'浏览',draft:'草稿',approve:'审核',edit:'编辑',send:'发送'};
const badge = s => `<span class="badge ${esc(s)}">${esc(labels[s] || s)}</span>`;
const time = ts => ts ? new Date(ts).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
const day = ts => new Date(Number(ts) + 8*3600000).toISOString().slice(0,10);
let state, page = 'dashboard', busy = false, filter = '', leadStatus = '', reviewStatus = '', from = '', to = '', selected = new Set(), modalAction;
const invoke = (a,v) => window.workbench.invoke(a,v);
function toast(message,error=false) { const el=$('#toast');el.textContent=message;el.className=error?'error':'';el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,6000); }
function heading(title,desc,action='') {return `<div class="page-heading"><div><div class="eyebrow">LOCAL WORKSPACE / ${esc(page.toUpperCase())}</div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`}
function empty(title,desc,action='') {return `<div class="empty"><strong>${title}</strong><p>${desc}</p>${action}</div>`}
function btn(action,label,data='',primary=false) {return `<button data-action="${action}" ${data} class="${primary?'primary':''}">${label}</button>`}
function inRange(ts) {const d=day(ts);return (!from||d>=from)&&(!to||d<=to)}
function searchbar(extra='') {return `<div class="toolbar"><label><span>检索关键词 / 视频 ID / 用户 / 任务</span><input id="filter" value="${esc(filter)}" placeholder="输入后按回车筛选"></label>${extra}<label><span>开始日期</span><input id="from" type="date" value="${from}"></label><label><span>结束日期</span><input id="to" type="date" value="${to}"></label>${btn('filter','筛选')}${btn('clearFilter','清除')}</div>`}
function matched(row) {return !filter||JSON.stringify(row).toLowerCase().includes(filter.toLowerCase())}
function taskList() {
  const tasks=state.tasks.filter(t=>matched(t)&&inRange(t.created));
  if(!tasks.length)return empty('还没有采集任务','填写搜索词和评论匹配词，创建第一条任务。');
  return `<div class="table-wrap"><table><thead><tr><th>任务</th><th>进度</th><th>状态</th><th>操作</th></tr></thead><tbody>${tasks.map(t=>`<tr><td><strong>${esc(t.name)}</strong><div class="detail">${time(t.created)}<br>${esc(t.error||'')}</div></td><td>${t.progress.visited} / ${t.config.maxVideos} 个视频<div class="detail">当前评论 ${t.progress.count} 条 · 第 ${t.progress.page} 页</div></td><td>${badge(t.state)}</td><td>${['ready','paused'].includes(t.state)?btn('startTask',t.state==='ready'?'开始':'继续',`data-id="${t.id}"`):'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
function activity(events) {return events.length?`<div class="activity">${events.map(e=>`<div class="activity-item"><small>${time(e.ts).split(' ')[1]||time(e.ts)}</small><div><strong>${esc(kindLabel[e.kind]||e.kind)}</strong><p>${esc(e.detail)}</p></div>${badge(e.status)}</div>`).join('')}</div>`:empty('记录从第一步开始','搜索、审核与发送动作会按时间保存在这里。')}
function dashboard() {
  const totals=state.stats;
  const sum=(status,kind)=>totals.drafts.filter(d=>d.state===status&&(!kind||d.kind===kind)).reduce((n,d)=>n+d.n,0);
  const stats=[['搜索视频',totals.videos,`已读取 ${totals.comments} 条评论`],['命中评论',totals.matches,`${totals.leads} 位潜客`],['待审核',sum('draft'),`${sum('approved')} 条已批准`],['成功发送',sum('success'),`评论 ${sum('success','reply')} · 私信 ${sum('success','dm')} · 待核实 ${sum('uncertain')}`]];
  return heading('让每条线索，都有来处。','从评论发现需求，在审核后建立联系。',btn('tasks','创建采集任务','',true))+
    searchbar()+`<div class="metrics">${stats.map(([label,value,desc])=>`<div class="metric"><small>${label}</small><div class="value">${value}</div><small>${desc}</small></div>`).join('')}</div>`+
    `<div class="grid"><section class="panel"><div class="panel-header"><h2>当前任务</h2>${badge(state.active?'running':'ready')}</div>${state.active?`<p>${esc(state.active.current)}</p><p class="help">${state.active.stopping?'正在等待当前请求结束…':'任务按单账号串行执行'}</p><div class="actions">${btn('pause','暂停')}${btn('stop','停止')}</div>`:empty('目前没有运行中的任务','采集和发送由你主动启动。')}
    <hr class="divider"><h2>视频线索表现</h2>${totals.ranking.length?`<div class="table-wrap"><table><thead><tr><th>来源视频</th><th>命中评论</th><th>回复成功</th><th>已跟进</th></tr></thead><tbody>${totals.ranking.map(v=>`<tr><td>${btn('openVideo',esc(v.title.slice(0,28)||v.id),`data-id="${v.id}"`)}</td><td>${v.matches}</td><td>${v.replies}</td><td>${v.followed}</td></tr>`).join('')}</tbody></table></div>`:empty('暂无视频数据','采集后按命中评论数展示；不推断成交效果。')}</section>
    <section class="panel"><h2>首次使用 · 连接你的工作流</h2><div class="steps">${[['连接浏览器','在 Chrome/Edge 登录抖音，安装配套脚本并完成本机配对。'],['搜索与筛选','视频搜索词决定范围，评论匹配词决定保留哪些线索。'],['审核后执行','编辑草稿并批准具体内容，执行结果逐条留存。']].map(([t,d],i)=>`<div class="step"><span class="step-number">0${i+1}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}</div><div class="actions">${btn('settings','打开连接设置')}</div><hr class="divider"><h2>最近活动</h2>${activity(state.events.filter(e=>inRange(e.ts)).slice(0,5))}</section></div>`;
}
function tasks() {
  return heading('搜索采集','视频范围与评论意向分开配置。自动浏览，按页记录。')+
    (!state.bridge.connected?`<div class="callout warning">浏览器尚未连接。请先在设置中完成配对并登录抖音。 ${btn('settings','前往设置')}</div>`:'')+
    `<section class="panel"><h2>新建采集任务</h2><form id="taskForm"><div class="form-row"><label>视频搜索词<textarea name="search" placeholder="例如：装修预算" required maxlength="2000"></textarea><span class="help">每行一个词，或用逗号分隔</span></label><label>评论匹配词<textarea name="include" placeholder="例如：多少钱&#10;求报价" required maxlength="2000"></textarea></label><label>排除词<textarea name="exclude" placeholder="例如：不需要" maxlength="2000"></textarea></label></div><div class="form-row"><label>匹配方式<select name="match"><option value="any">命中任意关键词</option><option value="all">命中全部关键词</option></select></label><label>最多视频数<input type="number" name="maxVideos" value="10" min="1" max="100" required></label><label>每视频最多评论页数<input type="number" name="pages" value="3" min="1" max="50" required></label><label>每视频最多评论数<input type="number" name="maxComments" value="60" min="1" max="1000" required></label><label>视频停留秒数<input type="number" name="dwell" value="5" min="3" max="120" required></label></div><div class="actions"><button class="primary" type="submit" ${!state.bridge.connected?'disabled':''}>创建任务</button><small>创建后手动开始；遇到验证或限流自动暂停。</small></div></form></section><section class="panel"><div class="panel-header"><h2>采集任务</h2><div class="actions">${btn('pause','暂停当前')}${btn('stop','停止当前')}</div></div>${taskList()}</section>`;
}
function leads() {
  const list=state.leads.filter(l=>matched(l)&&inRange(l.found_at)&&(!leadStatus||l.status===leadStatus));
  const groups=new Map();for(const l of list){const key=l.user_id||'comment:'+l.id;if(!groups.has(key))groups.set(key,[]);if(!groups.get(key).some(x=>x.id===l.id&&x.task_id===l.task_id))groups.get(key).push(l)}
  return heading('潜客列表','保留原评论与来源证据。同一用户归并展示，未知身份不合并。')+
    searchbar(`<label><span>潜客状态</span><select id="leadStatus"><option value="">全部状态</option>${['keep','exclude','followed'].map(s=>`<option value="${s}" ${leadStatus===s?'selected':''}>${labels[s]}</option>`).join('')}</select></label>`)+
    `<section class="panel"><div class="panel-header"><h2>${groups.size} 位潜客 · ${list.length} 条来源记录</h2><small>最多展示最近 5000 条；发送明细可完整导出</small></div>${groups.size?[...groups.entries()].map(([key,items])=>`<article class="lead-group"><div class="lead-heading"><div><h3>${esc(items[0].nickname||'未提供昵称')}</h3><small>${items[0].user_id?'用户 '+esc(items[0].user_id):'身份待核实 · 仅保留单条评论'}</small></div>${badge(items[0].status||'keep')}</div><div class="actions">${btn('leadKeep','保留',`data-id="${esc(key)}"`)}${btn('leadExclude','排除',`data-id="${esc(key)}"`)}${btn('leadFollowed','已跟进',`data-id="${esc(key)}"`)}${btn('leadNote','备注',`data-id="${esc(key)}"`)}</div>${items[0].note?`<p class="help">备注：${esc(items[0].note)}</p>`:''}${items.map(l=>`<div class="quote">${esc(l.body)}</div><div class="source">视频：${esc(l.title||l.video_id)}<br>搜索词：${esc(l.keyword)} · 评论时间：${time(l.created*1000)}<br>${JSON.parse(l.hits).map(h=>`<span class="tag">${esc(h)}</span>`).join('')}</div><div class="actions">${btn('openVideo','原视频',`data-id="${l.video_id}"`)}${['templateReply','aiReply','templateDm','aiDm'].map((a,i)=>btn(a,['模板回复','AI 回复','模板私信','AI 私信'][i],`data-comment="${l.id}" data-task="${l.task_id}"`)).join('')}</div>`).join('')}</article>`).join(''):empty('没有符合条件的潜客','完成采集，或调整筛选条件。')}</section>`;
}
function review() {
  const rows=state.drafts.filter(d=>matched(d)&&inRange(d.created)&&(!reviewStatus||d.state===reviewStatus));
  return heading('审核发送','每一条批准都绑定当前目标和内容。修改文案后必须重新审核。')+
    `<div class="callout warning">私信接口的可靠确认尚未通过真实账号验收；发送后若无确认会进入“待核实”并暂停队列。不要重复发送。</div>`+
    searchbar(`<label><span>发送状态</span><select id="reviewStatus"><option value="">全部状态</option>${['draft','approved','success','uncertain','failed'].map(s=>`<option value="${s}" ${reviewStatus===s?'selected':''}>${labels[s]}</option>`).join('')}</select></label>`)+
    `<div class="panel"><div class="panel-header"><h2>审核队列</h2><span id="selectionCount">已选 ${selected.size} 条</span></div><div class="actions">${btn('approve','批准所选内容','',true)}${btn('execute','执行所选已批准记录')}${btn('pause','暂停执行')}${btn('clearSelected','清空选择')}</div><p class="help">每批最多 10 条；默认间隔 60 秒；已成功或待核实的相同目标不会再次联系。</p></div>`+
    (rows.length?rows.map(d=>`<article class="draft"><div class="lead-heading"><label class="checklabel"><input type="checkbox" data-select="${d.id}" ${selected.has(d.id)?'checked':''} ${['success','sending','uncertain'].includes(d.state)?'disabled':''}><strong>${d.kind==='reply'?'评论回复':'私信'} · ${esc(d.nickname||d.user_id||'未知用户')}</strong></label>${badge(d.state)}</div><div class="draft-grid"><div><small>来源评论 · ${esc(d.title||d.video_id)}</small><p>${esc(d.body)}</p><small>目标 ${esc(d.user_id||d.comment_id)} · ${time(d.created)}</small></div><div class="outgoing"><small>待发送文案 · 第 ${d.version} 版</small><p>${esc(d.content)}</p></div></div>${d.error?`<p class="error">${esc(d.error)}</p>`:''}<div class="actions">${btn('openVideo','查看原视频',`data-id="${d.video_id}"`)}${['draft','approved','failed','skipped'].includes(d.state)?btn('editDraft','编辑文案',`data-id="${d.id}"`):''}${d.state==='uncertain'?btn('resolveSent','已人工核实发送',`data-id="${d.id}"`)+btn('resolveFailed','已人工核实未发送',`data-id="${d.id}"`):''}<small>${d.model?'模型：'+esc(d.model)+' · '+d.elapsed+' ms':'固定模板'}${d.approved_at?' · 审核 '+time(d.approved_at):''}</small></div></article>`).join(''):empty('暂无草稿','到潜客列表选择模板或 AI 生成草稿。'));
}
function logs() {
  const rows=state.events.filter(e=>matched(e)&&inRange(e.ts));
  const reportDay=from||state.day;
  return heading('操作日志','每一次动作都有时间、来源和结果。支持按日期追溯与导出。',`<div class="actions">${btn('exportCsv','导出发送明细')}${btn('exportDaily','导出每日记录')}</div>`)+searchbar()+
    `<section class="panel"><h2>${reportDay} · 每日备注</h2><form id="noteForm"><label>补充今日跟进情况<textarea name="note" maxlength="4000">${esc(state.notes.find(n=>n.day===reportDay)?.note||'')}</textarea></label><button type="submit">保存备注</button></form></section><section class="panel"><div class="panel-header"><h2>操作明细</h2><small>界面展示最近 5000 条</small></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>时间（北京时间）</th><th>操作</th><th>结果</th><th>详情与来源</th></tr></thead><tbody>${rows.map(e=>`<tr><td class="num">${time(e.ts)}</td><td>${esc(kindLabel[e.kind]||e.kind)}</td><td>${badge(e.status)}</td><td>${esc(e.detail)}<div class="detail">${e.video_id?'视频 '+esc(e.video_id):''}${e.user_id?' · 用户 '+esc(e.user_id):''}<br>${e.task_id?'任务 '+esc(e.task_id):''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('暂无操作记录','创建任务后，操作记录会自动保存。')}</section>`;
}
function settings() {
  const s=state.settings;
  const field=(name,label,type='text',help='')=>`<label>${label}<input type="${type}" name="${name}" value="${esc(s[name]||'')}" ${type==='number'?'min="1" max="3600"':''}>${help?`<span class="help">${help}</span>`:''}</label>`;
  return heading('设置','连接本机浏览器，配置模型与操作边界。')+
    `<section class="panel"><div class="panel-header"><h2>01 / 浏览器连接</h2>${badge(state.bridge.connected?'success':'paused')}</div><p>${state.bridge.connected?'已连接账号 '+esc(state.bridge.account):'未连接。请使用 Chrome 或 Edge，并保持一个已登录抖音的标签页。'}</p><ol><li>在浏览器安装 Tampermonkey 扩展，并允许用户脚本运行。</li><li>点击“安装配套脚本”，在扩展中确认安装。</li><li>打开抖音并登录；点击“复制配对码”，在扩展菜单选择“连接工作台：输入配对码”。</li><li>返回工作台确认显示“已连接”。请勿分享配对码。</li></ol><div class="actions">${btn('installScript','安装配套脚本','',true)}${btn('copyPairing','复制配对码')}${btn('openDouyin','打开抖音')}${btn('refresh','检查连接')}</div><p class="help">配对码 60 秒后从剪贴板清除。浏览器需保持打开，电脑休眠或验证提示会中断任务。</p></section>
    <section class="panel"><h2>02 / 模型、话术与任务限额</h2><form id="settingsForm"><div class="form-row">${field('baseUrl','API 基础地址','url','HTTPS 地址，含服务所需的 /v1；不含 /chat/completions')}${field('model','模型名称')}
    <label>API Key<input type="password" name="apiKey" autocomplete="new-password" placeholder="${s.keyConfigured?'已保存；留空保持不变':'未配置'}"><span class="help">系统加密保存，不在日志中记录。</span></label></div><label class="checklabel"><input type="checkbox" name="clearKey">清除已保存的 API Key</label><hr class="divider"><label>业务与产品介绍<textarea name="business" maxlength="8000">${esc(s.business)}</textarea></label><div class="form-row">${field('tone','回复语气')}${field('forbidden','禁止承诺的内容')}</div><div class="form-row"><label>评论回复模板<textarea name="replyTemplate" maxlength="1000">${esc(s.replyTemplate)}</textarea><span class="help">支持 {comment} 和 {video} 占位符。</span></label><label>私信模板<textarea name="dmTemplate" maxlength="1000">${esc(s.dmTemplate)}</textarea></label></div><div class="form-row">${field('interval','发送间隔（秒，最少 60）','number')}${field('replyLimit','每批评论上限（1–10）','number')}${field('dmLimit','每批私信上限（1–10）','number')}</div><button class="primary" type="submit">保存设置</button><p class="help">这些限额是软件默认值，不代表平台安全阈值。未配置模型时可使用固定话术。</p></form></section>
    <section class="panel" id="mcpPanel"><div class="panel-header"><h2>03 / MCP 接口</h2><span class="badge">${state.mcp?.enabled?'已启用':'未启用'}</span></div><p>供本机 AI 客户端读取线索、控制采集、生成草稿和执行已批准记录。批准草稿及人工核实仍在桌面完成。</p><label>Streamable HTTP 地址<input value="http://127.0.0.1:19423/mcp" readonly></label><p class="help">认证：Authorization: Bearer &lt;MCP 令牌&gt;。使用独立令牌，浏览器配对码不能代替。启用后持有令牌的本机客户端可读取业务数据。</p><div class="actions">${btn('toggleMcp',state.mcp?.enabled?'关闭 MCP':'启用 MCP','',!state.mcp?.enabled)}${btn('copyMcpToken','复制 MCP 令牌')}${btn('rotateMcpToken','重置 MCP 令牌')}</div><p class="help">仅监听本机；默认关闭。令牌不显示在界面或日志中，剪贴板 60 秒后清除。重置后旧客户端需要重新配置。</p></section>
    <section class="panel"><h2>04 / 本地数据</h2><p>任务、评论、审核和日志保存在本机 SQLite。备份文件含业务数据，请妥善保管。</p><div class="actions">${btn('backup','保存数据库备份')}${btn('dataFolder','打开数据目录')}${btn('guide','打开使用说明')}</div><p class="help">真实搜索、评论及私信尚待你的账号验收；安装包不包含账号、密钥或历史业务数据。</p></section>`;
}
function render() {
  if(!state)return;
  document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  $('#breadcrumb').textContent='工作空间 / '+titles[page];
  $('#connection').textContent=state.bridge.connected?'● 浏览器已连接':'○ 浏览器未连接';$('#connection').classList.toggle('online',state.bridge.connected);
  $('#main').innerHTML=({dashboard,tasks,leads,review,logs,settings}[page])();
}
async function refresh(draw=true,preserve=false){
  const forms=preserve?[...document.querySelectorAll('main form')].map(f=>({id:f.id,values:[...f.elements].filter(e=>e.name).map(e=>({name:e.name,value:e.value,checked:e.checked,type:e.type}))})):[];
  state=await invoke('state',{from,to});if(draw){render();for(const f of forms){const el=document.getElementById(f.id);if(el)for(const item of f.values){const field=el.elements.namedItem(item.name);if(field){field.value=item.value;if(item.type==='checkbox')field.checked=item.checked}}}}
}
function navigate(p){page=titles[p]?p:'dashboard';filter='';leadStatus='';reviewStatus='';selected.clear();render()}
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
function edit(title,hint,value,action){$('#editorTitle').textContent=title;$('#editorHint').textContent=hint;$('#editorText').value=value;modalAction=action;$('#editor').returnValue='';$('#editor').showModal()}
$('#editor').addEventListener('close',async()=>{if($('#editor').returnValue!=='save'||!modalAction)return;try{await modalAction($('#editorText').value);toast('已保存');await refresh()}catch(e){toast(e.message,true)}});
document.addEventListener('change',e=>{if(e.target.dataset.select){e.target.checked?selected.add(e.target.dataset.select):selected.delete(e.target.dataset.select);$('#selectionCount').textContent=`已选 ${selected.size} 条`}});
document.addEventListener('keydown',e=>{if(e.target.id==='filter'&&e.key==='Enter'){e.preventDefault();applyFilter()}});
function applyFilter(){filter=$('#filter')?.value||'';from=$('#from')?.value||'';to=$('#to')?.value||'';leadStatus=$('#leadStatus')?.value||'';reviewStatus=$('#reviewStatus')?.value||'';if(from&&to&&from>to){toast('开始日期不能晚于结束日期',true);return}refresh().catch(e=>toast(e.message,true))}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-action]');if(!b)return;const a=b.dataset.action,id=b.dataset.id;
  if(a==='pause'||a==='stop'){try{await invoke('control',a);toast('已请求'+(a==='pause'?'暂停':'停止')+'，等待当前请求结束')}catch(e){toast(e.message,true)}return}
  if(busy)return;
  if(titles[a]){location.hash=a;return}if(a==='filter'){applyFilter();return}if(a==='clearFilter'){filter=from=to=leadStatus=reviewStatus='';await refresh();return}if(a==='clearSelected'){selected.clear();render();return}
  busy=true;b.disabled=true;
  try{
    if(a==='toggleMcp'){await invoke('mcpEnabled',!state.mcp?.enabled);toast(state.mcp?.enabled?'MCP 已关闭':'MCP 已启用，请配置客户端的独立令牌')}
    else if(a==='copyMcpToken'){await invoke(a);toast('MCP 令牌已复制；请只粘贴到可信本机客户端的认证配置')}
    else if(a==='rotateMcpToken'){await invoke(a);toast('MCP 令牌已重置，旧令牌立即失效')}
    else if(a==='startTask')await invoke(a,id);
    else if(a==='pause'||a==='stop')await invoke('control',a);
    else if(a==='openVideo')await invoke(a,id);
    else if(['templateReply','aiReply','templateDm','aiDm'].includes(a)){await invoke('generate',{commentId:b.dataset.comment,taskId:b.dataset.task,kind:a.endsWith('Dm')?'dm':'reply',ai:a.startsWith('ai')});toast('草稿已生成，请到审核发送查看')}
    else if(a==='approve'){const items=[...selected].map(id=>{const d=state.drafts.find(d=>d.id===id);return {id,version:d.version}});const ok=await invoke('approve',items);if(ok){selected.clear();toast('已批准当前文案；点击执行后才会发送')}}
    else if(a==='execute'){await invoke(a,[...selected]);selected.clear();toast('开始执行已审核记录')}
    else if(a==='editDraft'){const d=state.drafts.find(x=>x.id===id);edit('编辑待发送文案','保存后原审核自动失效，需要重新批准。',d.content,content=>invoke('editDraft',{id,content}))}
    else if(a==='resolveSent'||a==='resolveFailed')edit('人工核实结果','请先到抖音原页面检查，填写确认依据。不要根据猜测标记结果。','',note=>invoke('resolve',{id,state:a==='resolveSent'?'success':'failed',note}));
    else if(a.startsWith('lead')){const l=state.leads.find(l=>(l.user_id||'comment:'+l.id)===id);if(a==='leadNote')edit('潜客备注','记录需求或跟进信息。',l.note||'',note=>invoke('lead',{id,status:l.status||'keep',note}));else await invoke('lead',{id,status:{leadKeep:'keep',leadExclude:'exclude',leadFollowed:'followed'}[a],note:l.note||''})}
    else if(a==='exportCsv'||a==='exportDaily'){const ok=await invoke('export',{kind:a==='exportCsv'?'csv':'daily',day:from||state.day});if(ok)toast('已导出')}
    else if(a==='refresh')toast('连接状态已刷新');
    else {const ok=await invoke(a);if(a==='copyPairing')toast('配对码已复制，60 秒后清除；请在脚本菜单中粘贴');if(a==='backup'&&ok)toast('数据库备份已保存')}
    await refresh(!$('#editor').open);
  }catch(e){toast(e.message,true)}finally{busy=false;b.disabled=false}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='editorForm')return;
  e.preventDefault();if(busy)return;busy=true;
  const data=Object.fromEntries(new FormData(e.target)),button=e.target.querySelector('button[type=submit]');if(button)button.disabled=true;
  try{
    if(e.target.id==='taskForm'){await invoke('createTask',data);toast('任务已创建，点击开始运行')}
    if(e.target.id==='settingsForm'){data.clearKey=data.clearKey==='on';await invoke('settings',data);toast('设置已保存')}
    if(e.target.id==='noteForm'){await invoke('note',{day:from||state.day,note:data.note});toast('每日备注已保存')}
    await refresh();
  }catch(e){toast(e.message,true)}finally{busy=false;if(button)button.disabled=false}
});
refresh().then(()=>{page=titles[location.hash.slice(1)]?location.hash.slice(1):'dashboard';render()}).catch(e=>{ $('#main').textContent='加载失败：'+e.message });
setInterval(async()=>{if(busy||$('#editor').open)return;try{const editing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'');await refresh(!editing,true)}catch(e){toast(e.message,true)}},3000);
