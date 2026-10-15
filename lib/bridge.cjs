'use strict';
const http = require('node:http');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const OPS = new Set(['search', 'comments', 'navigate', 'inspect', 'reply', 'dm']);
class Bridge {
  constructor(token, scriptFile, port = 19423) { this.token = token; this.scriptFile = scriptFile; this.port = port; this.client = null; this.pending = null; }
  status() { const c = this.client; return c && Date.now() - c.seen < 35000 ? { connected: true, account: c.account, url: c.url, ready: c.ready } : { connected: false, account: '', url: '', ready: false }; }
  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => { if (!res.headersSent) this.json(res, 400, { error: '请求格式无效' }); else res.end(); }));
    this.server.requestTimeout = 30000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
  }
  json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
  async handle(req, res) {
    if (req.headers.host !== `127.0.0.1:${this.port}` || (req.headers.origin && req.headers.origin !== 'https://www.douyin.com')) return this.json(res, 403, { error: '来源不允许' });
    if (req.url === '/mcp') {
      if (!this.mcpHandler) return this.json(res,503,{error:'MCP 未就绪'});
      return this.mcpHandler(req,res);
    }
    if (req.method === 'GET' && req.url === '/bridge.user.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(this.scriptFile));
    }
    const auth = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from('Bearer ' + this.token);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return this.json(res, 401, { error: '需要配对' });
    if (req.method !== 'POST' || !['/poll', '/result'].includes(req.url)) return this.json(res, 404, { error: '未知操作' });
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) { this.json(res, 413, { error: '数据过大' }); return; } chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId) || !/^\d{5,30}$/.test(body.account || '')) return this.json(res, 400, { error: '未识别登录账号' });
    if (this.status().connected && this.client.id !== body.clientId) return this.json(res, 409, { error: '仅支持一个浏览器标签页，请关闭其他连接页' });
    if (req.url === '/poll') {
      if (typeof body.url !== 'string' || !body.url.startsWith('https://www.douyin.com/')) return this.json(res, 400, { error: '页面地址无效' });
      this.client = { id: body.clientId, account: body.account, url: body.url, ready: body.ready === true, seen: Date.now() };
      const p = this.pending;
      if (p && !p.delivered && p.account === body.account && p.clientId === body.clientId) {
        p.delivered = true;
        return this.json(res, 200, { id: p.id, op: p.op, args: p.args, account: p.account });
      }
      return this.json(res, 200, { idle: true });
    }
    const p = this.pending;
    if (p && p.delivered && body.id === p.id && body.account === p.account && body.clientId === p.clientId) {
      clearTimeout(p.timer); this.pending = null;
      if (body.error) p.reject(new Error(String(body.error).slice(0, 240)));
      else p.resolve(body.value);
    }
    this.json(res, 200, { ok: true });
  }
  call(op, args, account, timeout = 30000) {
    if (!OPS.has(op)) return Promise.reject(new Error('不允许的浏览器操作'));
    if (this.pending) return Promise.reject(new Error('已有浏览器操作正在进行'));
    if (!this.status().connected || this.client.account !== account) return Promise.reject(new Error('浏览器未连接或账号已切换'));
    return new Promise((resolve, reject) => {
      const p = { id: randomUUID(), op, args, account, clientId: this.client.id, resolve, reject, delivered: false };
      p.timer = setTimeout(() => { if (this.pending === p) this.pending = null; reject(new Error('浏览器操作超时；发送操作请核实结果')); }, timeout);
      this.pending = p;
    });
  }
  close() {
    this.mcpHandler?.close();
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('应用关闭')); this.pending = null; }
    this.server?.closeAllConnections(); this.server?.close();
  }
}
module.exports = { Bridge };
