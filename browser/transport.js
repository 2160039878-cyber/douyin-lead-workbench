// ==UserScript==
// @name         抖音线索工作台 · 本机连接
// @namespace    local-lead-workbench
// @version      0.1.0
// @description  本机配对、固定操作、审核后发送；不提供任意脚本执行入口
// @match        https://www.douyin.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// ==/UserScript==
(function () {
  'use strict';
  const apiSource = /*__API_SOURCE__*/;
  // 仅注入随安装包发布的固定源码，网络命令永远不能提供 expression 或脚本。
  unsafeWindow.eval(apiSource);
  const api = unsafeWindow.__leadApi;
  const server = 'http://127.0.0.1:19423';
  let token = GM_getValue('pairing', '');
  const clientId = sessionStorage.getItem('lead-workbench-tab') || crypto.randomUUID();
  sessionStorage.setItem('lead-workbench-tab', clientId);
  GM_registerMenuCommand('连接工作台：输入配对码', () => {
    const value = prompt('在桌面软件「设置」复制配对码，然后粘贴到此处。');
    if (value && /^[a-f0-9]{64}$/.test(value.trim())) { token = value.trim(); GM_setValue('pairing', token); }
  });
  GM_registerMenuCommand('断开工作台', () => { token = ''; GM_setValue('pairing', ''); });
  function post(route, body) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ method: 'POST', url: server + route, timeout: 10000,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, data: JSON.stringify(body),
      onload: r => { try { if (r.status !== 200) throw new Error('本机连接拒绝 ' + r.status); resolve(JSON.parse(r.responseText)); } catch(e) { reject(e); } },
      onerror: () => reject(new Error('工作台未启动')), ontimeout: () => reject(new Error('工作台连接超时')) }));
  }
  const id = v => { if ((typeof v === 'number' && !Number.isSafeInteger(v)) || !/^\d{5,30}$/.test(String(v || ''))) throw new Error('平台标识无效'); return String(v); };
  const str = (v, max = 1000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('文本参数无效'); return v; };
  function check(value) { if (value?.status_code !== undefined && value.status_code !== 0) throw new Error('平台拒绝请求，状态 ' + value.status_code); return value; }
  async function execute(m) {
    const a = m.args || {};
    if (['reply','dm'].includes(m.op)) {
      if (await api._getMyUidStrict() !== m.account) throw new Error('登录账号已变化，操作已暂停');
      str(a.text); id(a.videoId || a.userId);
    }
    switch (m.op) {
      case 'inspect': return { url: location.href, ready: !!document.querySelector('video') };
      case 'navigate': return { navigate: 'https://www.douyin.com/video/' + id(a.videoId) };
      case 'search': {
        const d = check(await api.search(str(a.keyword,80), Number(a.offset)||0, 10));
        return { items: (d.data || []).filter(x=>x.aweme_info).map(x=>({ id:id(x.aweme_info.aweme_id),title:String(x.aweme_info.desc||'').slice(0,2000) })), hasMore: d.has_more===true||Number(d.has_more)===1, cursor: d.cursor ?? ((Number(a.offset)||0)+(d.data||[]).length) };
      }
      case 'comments': {
        const d = check(await api.getComments(id(a.videoId), Number(a.cursor)||0, 20));
        const items = (d.comments || []).map(c=>{
          let uid='';try { uid=id(c.user?.uid || c.user?.uid_str); } catch {}
          return { id:id(c.cid),user_id:uid,nickname:String(c.user?.nickname||'').slice(0,100),body:String(c.text||'').slice(0,4000),created:Number(c.create_time)||0 };
        });
        window.scrollBy({top:400,behavior:'smooth'});
        return {items,hasMore:d.has_more===true||Number(d.has_more)===1,cursor:d.cursor ?? null};
      }
      case 'reply': {
        const d=check(await api.publish(id(a.videoId),str(a.text),id(a.commentId),null,null,null));
        const c=d.comment;
        if(!c?.cid || String(c.text||'')!==a.text) return {confirmed:false};
        return {confirmed:true,resultId:id(c.cid)};
      }
      case 'dm': {
        const c=await api.createConversation(id(a.userId));
        if(!c?.conversation_id)throw new Error('无法建立私信会话');
        await api.sendDM([c.conversation_id,c.conversation_short_id||'0',c.ticket||''].join('|'),str(a.text));
        // 上游解码器没有可靠的发送确认字段，不能把 HTTP 成功伪装成送达。
        return {confirmed:false};
      }
      default: throw new Error('不支持的操作');
    }
  }
  let account='', lastProbe=0;
  async function loop() {
    try {
      if (!token) return;
      if(Date.now()-lastProbe>30000) { account=await api._getMyUidStrict();lastProbe=Date.now(); }
      if(!account)return;
      const base={clientId,account,url:location.href,ready:!!document.querySelector('video')};
      const m=await post('/poll',base);
      if(m.id) {
        let value,error;
        try { if(m.account!==account)throw new Error('账号不匹配');value=await execute(m); }
        catch(e) { error=String(e.message).slice(0,240); }
        await post('/result',{...base,id:m.id,value,error});
        if(value?.navigate) { location.assign(value.navigate);return; }
      }
    } catch { /* 连接问题留在桌面状态；不打印页面凭据或原始响应。 */ }
    finally { setTimeout(loop,1500); }
  }
  loop();
})();
