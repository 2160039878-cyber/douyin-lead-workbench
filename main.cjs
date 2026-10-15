'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, clipboard, shell, dialog, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const { Store } = require('./lib/store.cjs');
const { Service } = require('./lib/service.cjs');
const { Bridge } = require('./lib/bridge.cjs');
const { createMcpEndpoint } = require('./lib/mcp.cjs');
const { text, platformId } = require('./lib/rules.cjs');
let win, store, bridge, service, exiting = false;
const page = path.join(__dirname, 'ui/index.html');
const localCheck = process.argv.includes('--verify-local-ui');
if (localCheck) app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'lead-package-check-')));
// 纯表单界面无需 GPU；软件渲染同时兼容本机的远程桌面/虚拟显示环境。
app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
  app.whenReady().then(start).catch(e => { dialog.showErrorBox('启动失败', String(e.message).slice(0, 240)); app.quit(); });
}
async function start() {
  const dir = app.getPath('userData'); fs.mkdirSync(dir, { recursive: true });
  const secretFile = path.join(dir, 'credentials.bin');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，应用未启动');
  let credentials = fs.existsSync(secretFile) ? JSON.parse(safeStorage.decryptString(fs.readFileSync(secretFile))) : {};
  const secrets = {
    get: key => credentials[key] || '',
    set: (key, value) => { credentials = { ...credentials, [key]: value }; const tmp = secretFile + '.tmp'; fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(credentials))); fs.renameSync(tmp, secretFile); }
  };
  if (!secrets.get('pairing')) secrets.set('pairing', randomBytes(32).toString('hex'));
  if (!secrets.get('mcpToken')) secrets.set('mcpToken', randomBytes(32).toString('hex'));
  store = new Store(path.join(dir, 'workbench.db'));
  bridge = new Bridge(secrets.get('pairing'), path.join(__dirname, 'browser/workbench.user.js'));
  await bridge.start(); service = new Service(store, bridge, secrets);
  bridge.mcpHandler = createMcpEndpoint(service, {getToken:()=>secrets.get('mcpToken'),isEnabled:()=>store.meta('mcpEnabled')===true,openReview:()=>{win?.show();win?.focus();void win?.webContents.executeJavaScript("location.hash='review'");}});
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1320, height: 900, minWidth: 850, minHeight: 620, show: !localCheck, backgroundColor: '#f5f7f8', title: '抖音线索工作台',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_w, _p, done) => done(false));
  ipcMain.handle('workbench', async (event, action, raw) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== pathToFileURL(page).href) throw new Error('不允许的调用来源');
    try {
      switch (action) {
        case 'state': return {...service.state(raw || {}),mcp:{enabled:store.meta('mcpEnabled')===true,url:'http://127.0.0.1:19423/mcp'}};
        case 'mcpEnabled': {
          if(typeof raw!=='boolean')throw new Error('MCP 开关参数无效');
          store.meta('mcpEnabled',raw);store.event('mcp',raw?'enabled':'disabled',raw?'用户开启 MCP 接口':'用户关闭 MCP 接口');return raw;
        }
        case 'copyMcpToken': {
          const v=secrets.get('mcpToken');clipboard.writeText(v);
          setTimeout(()=>{if(clipboard.readText()===v)clipboard.clear()},60000).unref();return true;
        }
        case 'rotateMcpToken': secrets.set('mcpToken',randomBytes(32).toString('hex'));store.event('mcp','rotated','用户重置 MCP 令牌');return true;
        case 'settings': return service.saveSettings(raw);
        case 'createTask': return service.createTask(raw);
        case 'startTask': return service.startTask(raw);
        case 'control': return service.control(raw);
        case 'generate': return await service.generate(raw);
        case 'editDraft': return store.editDraft(text(raw.id,100), raw.content);
        case 'approve': {
          if (!Array.isArray(raw) || !raw.length || raw.length>10) throw new Error('每次审核 1–10 条');
          const drafts = raw.map(x => store.draft(text(x.id,100)));
          const { response } = await dialog.showMessageBox(win, { type:'question', title:'审核当前文案与目标', message:`批准这 ${drafts.length} 条草稿？`, detail:drafts.map(d=>`${d.kind==='reply'?'评论回复':'私信'} · 视频 ${d.video_id}\n目标 ${d.user_id || d.comment_id}\n${d.content}`).join('\n\n'), buttons:['取消','批准当前内容'], defaultId:0, cancelId:0 });
          if(response===1) service.approve(raw); return response===1;
        }
        case 'execute': return service.execute(raw);
        case 'resolve': return service.resolve(raw);
        case 'lead': return service.lead(raw);
        case 'note': return service.note(raw);
        case 'openVideo': return shell.openExternal('https://www.douyin.com/video/' + platformId(raw));
        case 'openDouyin': return shell.openExternal('https://www.douyin.com/');
        case 'installScript': return shell.openExternal('http://127.0.0.1:19423/bridge.user.js');
        case 'copyPairing': {
          const v=secrets.get('pairing'); clipboard.writeText(v);
          setTimeout(()=>{if(clipboard.readText()===v)clipboard.clear()},60000).unref(); return true;
        }
        case 'dataFolder': return shell.openPath(dir);
        case 'guide': return shell.openPath(path.join(__dirname, 'README.md'));
        case 'export': {
          const output=service.export(raw.kind, raw.day);
          const {filePath,canceled}=await dialog.showSaveDialog(win,{defaultPath:raw.kind==='csv'?'操作明细.csv':`每日记录-${raw.day}.txt`});
          if(!canceled&&filePath)fs.writeFileSync(filePath,output,'utf8');return !canceled;
        }
        case 'backup': {
          const {filePath,canceled}=await dialog.showSaveDialog(win,{defaultPath:`工作台备份-${Date.now()}.db`});
          if(!canceled&&filePath){if(fs.existsSync(filePath))throw new Error('备份须保存为新文件，请更换文件名');store.backup(filePath)}return !canceled;
        }
        default: throw new Error('未知操作');
      }
    } catch(e) { throw new Error(service.safeError(e)); }
  });
  await win.loadFile(page);
  if (localCheck) {
    require('./lib/local-check.cjs')(win, app, service, secrets).then(()=>app.quit()).catch(e=>{console.error(e.message);app.exit(1)});
  }
  win.on('close', e => {
    if (!exiting && service.active) {
      e.preventDefault();
      dialog.showMessageBox(win,{type:'question',message:'任务正在运行，暂停并退出？',detail:'已发出的请求将等待结果；结果不明的发送保留为待核实。',buttons:['继续运行','暂停并退出'],defaultId:0,cancelId:0}).then(async r=>{
        if(r.response!==1)return;service.control('pause');await service.completion;exiting=true;win.close();
      });
    }
  });
}
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{bridge?.close();store?.close();});
