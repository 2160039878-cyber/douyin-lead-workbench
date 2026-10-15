'use strict';
// 独立启动真实 Electron，只检查本地 UI 与加密存储，不连接/操作抖音。
const { app }=require('electron');
app.disableHardwareAcceleration();
require('electron').dialog.showErrorBox = (_title,message) => { console.error('APP_START_FAILURE: '+message);app.exit(1); };
process.on('uncaughtException',e=>{console.error(e.stack);app.exit(1)});
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const output=path.resolve(__dirname,'../../../ui-smoke');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'lead-ui-smoke-')));
const errors=[];const timer=setTimeout(()=>{console.error('Smoke timeout');app.exit(1)},45000);
app.on('browser-window-created',(_e,win)=>{
  win.hide();
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
  win.webContents.once('did-finish-load',async()=>{
    try {
      await new Promise(r=>setTimeout(r,1500));
      const reports=[];
      for(const p of ['dashboard','tasks','leads','review','logs','settings']) {
        await win.webContents.executeJavaScript(`location.hash=${JSON.stringify(p)}`);
        await new Promise(r=>setTimeout(r,300));
        const status=await win.webContents.executeJavaScript(`({title:document.querySelector('h1')?.textContent,hasApi:typeof window.workbench?.invoke==='function',overflow:document.documentElement.scrollWidth>innerWidth,error:document.body.textContent.includes('加载失败')})`);
        if(!status.title||!status.hasApi||status.error||status.overflow)throw new Error('页面检查失败 '+p+' '+JSON.stringify(status));
        reports.push({page:p,...status});
        fs.writeFileSync(path.join(output,p+'.png'),(await win.webContents.capturePage()).toPNG());
      }
      const security=await win.webContents.executeJavaScript(`({node:typeof require,keyField:document.querySelector('[name=apiKey]').value})`);
      if(security.node!=='undefined'||security.keyField!=='')throw new Error('隔离或密钥回显检查失败');
      if(errors.length)throw new Error(errors.join('\n'));
      fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,reports,security},null,2));
      console.log('UI smoke passed: 6 pages, IPC, isolation, no overflow, no model key');
      clearTimeout(timer);win.close();
    }catch(e){console.error(e.message);clearTimeout(timer);app.exit(1)}
  });
});
require('../main.cjs');
