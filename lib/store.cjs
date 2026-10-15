'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { approvalHash, text, dayKey } = require('./rules.cjs');
class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wb_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wb_tasks(id TEXT PRIMARY KEY,name TEXT,account TEXT,config TEXT,state TEXT,progress TEXT,error TEXT,created INTEGER,updated INTEGER);
      CREATE TABLE IF NOT EXISTS wb_videos(id TEXT PRIMARY KEY,title TEXT,url TEXT);
      CREATE TABLE IF NOT EXISTS wb_task_videos(task_id TEXT,video_id TEXT,created INTEGER,PRIMARY KEY(task_id,video_id));
      CREATE TABLE IF NOT EXISTS wb_comments(id TEXT PRIMARY KEY,video_id TEXT REFERENCES wb_videos(id),user_id TEXT,nickname TEXT,body TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS wb_matches(task_id TEXT REFERENCES wb_tasks(id),comment_id TEXT REFERENCES wb_comments(id),keyword TEXT,hits TEXT,matched INTEGER,created INTEGER,PRIMARY KEY(task_id,comment_id,keyword));
      CREATE TABLE IF NOT EXISTS wb_leads(id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'keep',note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS wb_drafts(id TEXT PRIMARY KEY,task_id TEXT,comment_id TEXT,video_id TEXT,user_id TEXT,account TEXT,kind TEXT,content TEXT,version INTEGER,state TEXT,approved_hash TEXT,approved_at INTEGER,started INTEGER,finished INTEGER,result_id TEXT,error TEXT,model TEXT,usage TEXT,elapsed INTEGER,created INTEGER);
      CREATE TABLE IF NOT EXISTS wb_events(id INTEGER PRIMARY KEY,ts INTEGER,task_id TEXT,video_id TEXT,comment_id TEXT,user_id TEXT,kind TEXT,status TEXT,detail TEXT);
      CREATE TABLE IF NOT EXISTS wb_notes(day TEXT PRIMARY KEY,note TEXT NOT NULL);
    `);
    this.db.prepare("UPDATE wb_tasks SET state='paused',error='应用已重启，请确认后继续' WHERE state='running'").run();
    this.db.prepare("UPDATE wb_drafts SET state='uncertain',error='应用中断，发送结果待核实',finished=? WHERE state='sending'").run(Date.now());
  }
  all(sql, ...p) { return this.db.prepare(sql).all(...p); }
  get(sql, ...p) { return this.db.prepare(sql).get(...p); }
  run(sql, ...p) { return this.db.prepare(sql).run(...p); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  meta(key, value) {
    if (value !== undefined) this.run('INSERT INTO wb_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
    return JSON.parse(this.get('SELECT value FROM wb_meta WHERE key=?', key)?.value || 'null');
  }
  event(kind, status, detail, ids = {}) {
    this.run('INSERT INTO wb_events(ts,task_id,video_id,comment_id,user_id,kind,status,detail) VALUES(?,?,?,?,?,?,?,?)', Date.now(), ids.task_id || '', ids.video_id || '', ids.comment_id || '', ids.user_id || '', kind, status, text(String(detail), 4000));
  }
  createTask(config, account) {
    const id = randomUUID(), now = Date.now();
    this.run('INSERT INTO wb_tasks VALUES(?,?,?,?,?,?,?,?,?)', id, config.search.join(' / '), account, JSON.stringify(config), 'ready', JSON.stringify({ keyword: 0, offset: 0, videos: [], index: 0, cursor: 0, page: 0, count: 0, seen: [], repeats: 0, searchRepeats: 0, visited: 0, exhausted: false }), '', now, now);
    this.event('task', 'ready', '创建采集任务', { task_id: id }); return id;
  }
  task(id) { const t = this.get('SELECT * FROM wb_tasks WHERE id=?', id); if (!t) throw new Error('任务不存在'); return { ...t, config: JSON.parse(t.config), progress: JSON.parse(t.progress) }; }
  saveTask(t) { this.run('UPDATE wb_tasks SET state=?,progress=?,error=?,updated=? WHERE id=?', t.state, JSON.stringify(t.progress), t.error || '', Date.now(), t.id); }
  addComment(task, video, c, keyword, match) {
    this.transaction(() => {
      this.run('INSERT INTO wb_videos VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title', video.id, video.title, 'https://www.douyin.com/video/' + video.id);
      this.run('INSERT INTO wb_comments VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING', c.id, video.id, c.user_id, c.nickname, c.body, c.created);
      this.run('INSERT OR IGNORE INTO wb_matches VALUES(?,?,?,?,?,?)', task.id, c.id, keyword, JSON.stringify(match.hits), Number(match.matched), Date.now());
      if (match.matched) this.run('INSERT OR IGNORE INTO wb_leads(id) VALUES(?)', c.user_id || 'comment:' + c.id);
    });
  }
  source(commentId, taskId) {
    const r = this.get(`SELECT c.*,v.title,t.account,m.keyword,m.hits FROM wb_comments c JOIN wb_videos v ON v.id=c.video_id JOIN wb_matches m ON m.comment_id=c.id JOIN wb_tasks t ON t.id=m.task_id WHERE c.id=? AND m.task_id=? AND m.matched=1 LIMIT 1`, commentId, taskId);
    if (!r) throw new Error('未找到对应的命中评论'); return r;
  }
  addDraft(source, taskId, kind, content, model = '', usage = '', elapsed = 0) {
    if (!['reply', 'dm'].includes(kind)) throw new Error('操作类型无效');
    if (kind === 'dm' && !source.user_id) throw new Error('缺少可靠用户 ID，不能创建私信');
    const id = randomUUID();
    this.run(`INSERT INTO wb_drafts(id,task_id,comment_id,video_id,user_id,account,kind,content,version,state,model,usage,elapsed,created) VALUES(?,?,?,?,?,?,?,?,1,'draft',?,?,?,?)`, id, taskId, source.id, source.video_id, source.user_id, source.account, kind, text(content, 1000), model, usage, elapsed, Date.now());
    this.event('draft', 'draft', '已生成待审核草稿', { ...source, task_id: taskId, comment_id: source.id }); return id;
  }
  draft(id) { const d = this.get('SELECT * FROM wb_drafts WHERE id=?', id); if (!d) throw new Error('草稿不存在'); return d; }
  editDraft(id, content) {
    const d = this.draft(id);
    if (!['draft', 'approved', 'failed', 'skipped'].includes(d.state)) throw new Error('该记录不可编辑；待核实记录请先核实结果');
    this.run("UPDATE wb_drafts SET content=?,version=version+1,state='draft',approved_hash=NULL,approved_at=NULL,error=NULL WHERE id=?", text(content, 1000), id);
    this.event('edit', 'draft', '修改文案，原审核已失效', d);
  }
  approve(items, account) {
    if (!Array.isArray(items) || !items.length || items.length > 10) throw new Error('每批审核 1–10 条');
    this.transaction(() => {
      for (const item of items) {
        const d = this.draft(item.id);
        if (d.version !== item.version || !['draft', 'failed', 'skipped'].includes(d.state)) throw new Error('内容或状态已变化，请刷新后重新审核');
        if (!d.content.trim() || d.account !== account) throw new Error('内容为空或当前账号不匹配');
        const lead = this.get('SELECT status FROM wb_leads WHERE id=?', d.user_id || 'comment:' + d.comment_id);
        if (lead?.status === 'exclude') throw new Error('该潜客已排除');
        this.run("UPDATE wb_drafts SET state='approved',approved_hash=?,approved_at=?,error=NULL WHERE id=?", approvalHash(d), Date.now(), d.id);
        this.event('approve', 'approved', '用户审核了当前目标与文案', d);
      }
    });
  }
  duplicate(d) {
    return this.get(`SELECT id FROM wb_drafts WHERE id<>? AND account=? AND kind=? AND state IN ('success','sending','uncertain') AND ${d.kind === 'dm' ? 'user_id' : 'comment_id'}=? LIMIT 1`, d.id, d.account, d.kind, d.kind === 'dm' ? d.user_id : d.comment_id);
  }
  claim(id, account) {
    return this.transaction(() => {
      const d = this.draft(id);
      if (d.state !== 'approved' || d.approved_hash !== approvalHash(d) || d.account !== account) throw new Error('审核状态或账号已变化');
      if (this.duplicate(d)) throw new Error('已联系过或存在待核实发送，阻止重复联系');
      if (this.get('SELECT status FROM wb_leads WHERE id=?', d.user_id || 'comment:' + d.comment_id)?.status === 'exclude') throw new Error('潜客已排除');
      this.run("UPDATE wb_drafts SET state='sending',started=? WHERE id=?", Date.now(), id); return d;
    });
  }
  finish(d, state, result = '', error = '') {
    this.run('UPDATE wb_drafts SET state=?,result_id=?,error=?,finished=? WHERE id=?', state, result, error, Date.now(), d.id);
    this.event(d.kind, state, error || '平台确认操作结果', d);
  }
  snapshot(limit = 5000) {
    if (!Number.isInteger(limit) || limit < -1) throw new Error('列表范围无效');
    return {
      tasks: this.all('SELECT * FROM wb_tasks ORDER BY created DESC').map(t => ({ ...t, config: JSON.parse(t.config), progress: JSON.parse(t.progress) })),
      leads: this.all(`SELECT c.*,v.title,v.url,m.task_id,m.keyword,m.hits,m.created AS found_at,l.status,l.note FROM wb_matches m JOIN wb_comments c ON c.id=m.comment_id JOIN wb_videos v ON v.id=c.video_id LEFT JOIN wb_leads l ON l.id=CASE WHEN c.user_id='' THEN 'comment:'||c.id ELSE c.user_id END WHERE m.matched=1 ORDER BY m.created DESC LIMIT ?`, limit),
      drafts: this.all(`SELECT d.*,c.body,c.nickname,v.title,v.url FROM wb_drafts d LEFT JOIN wb_comments c ON c.id=d.comment_id LEFT JOIN wb_videos v ON v.id=d.video_id ORDER BY d.created DESC LIMIT ?`, limit),
      events: this.all('SELECT * FROM wb_events ORDER BY id DESC LIMIT ?', limit),
      counts: { comments: this.get('SELECT COUNT(*) AS n FROM wb_comments').n, videos: this.get('SELECT COUNT(*) AS n FROM wb_videos').n },
      notes: this.all('SELECT * FROM wb_notes ORDER BY day DESC'), day: dayKey()
    };
  }
  backup(file) { this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
  stats(from, to) {
    const count = (sql,...p) => this.get(sql,...p).n;
    const window = ' BETWEEN ? AND ?';
    const drafts = this.all('SELECT kind,state,COUNT(*) AS n FROM wb_drafts WHERE COALESCE(started,created) BETWEEN ? AND ? GROUP BY kind,state',from,to);
    return {
      videos:count('SELECT COUNT(DISTINCT video_id) AS n FROM wb_task_videos WHERE created'+window,from,to),
      comments:count('SELECT COUNT(DISTINCT comment_id) AS n FROM wb_matches WHERE created'+window,from,to),
      matches:count('SELECT COUNT(DISTINCT comment_id) AS n FROM wb_matches WHERE matched=1 AND created'+window,from,to),
      leads:count("SELECT COUNT(DISTINCT CASE WHEN c.user_id='' THEN 'comment:'||c.id ELSE c.user_id END) AS n FROM wb_matches m JOIN wb_comments c ON c.id=m.comment_id WHERE m.matched=1 AND m.created"+window,from,to), drafts,
      ranking:this.all(`SELECT v.id,v.title,COUNT(DISTINCT m.comment_id) AS matches,COUNT(DISTINCT CASE WHEN l.status='followed' THEN l.id END) AS followed,
        (SELECT COUNT(*) FROM wb_drafts d WHERE d.video_id=v.id AND d.kind='reply' AND d.state='success' AND d.finished BETWEEN ? AND ?) AS replies
        FROM wb_matches m JOIN wb_comments c ON c.id=m.comment_id JOIN wb_videos v ON v.id=c.video_id LEFT JOIN wb_leads l ON l.id=CASE WHEN c.user_id='' THEN 'comment:'||c.id ELSE c.user_id END
        WHERE m.matched=1 AND m.created BETWEEN ? AND ? GROUP BY v.id ORDER BY matches DESC LIMIT 10`,from,to,from,to)
    };
  }
  close() { this.db.close(); }
}
module.exports = { Store };
