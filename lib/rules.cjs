'use strict';
const { createHash } = require('node:crypto');
const text = (value, max = 2000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error('文本参数无效或过长');
  return value.trim();
};
function integer(value, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`数值必须在 ${min}–${max} 之间`);
  return n;
}
function words(value) {
  const list = Array.isArray(value) ? value : text(value || '', 2000).split(/[\n,，]/);
  if (list.length > 30) throw new Error('每组最多 30 个关键词');
  return [...new Set(list.map(v => text(v, 80)).filter(Boolean))];
}
function taskConfig(raw) {
  const search = words(raw.search), include = words(raw.include), exclude = words(raw.exclude);
  if (!search.length || !include.length) throw new Error('请填写视频搜索词和评论匹配词');
  if (!['any', 'all'].includes(raw.match || 'any')) throw new Error('匹配方式无效');
  return { search, include, exclude, match: raw.match || 'any',
    maxVideos: integer(raw.maxVideos ?? 10, 1, 100), pages: integer(raw.pages ?? 3, 1, 50),
    maxComments: integer(raw.maxComments ?? 60, 1, 1000), dwell: integer(raw.dwell ?? 5, 3, 120) };
}
function matchComment(value, config) {
  const s = String(value).normalize('NFKC').toLocaleLowerCase();
  const has = word => s.includes(word.normalize('NFKC').toLocaleLowerCase());
  const excluded = config.exclude.filter(has), hits = config.include.filter(has);
  return { matched: !excluded.length && (config.match === 'all' ? hits.length === config.include.length : !!hits.length), hits, excluded };
}
function platformId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('平台 ID 精度丢失，拒绝使用');
  const id = String(value ?? '');
  if (!/^\d{5,30}$/.test(id)) throw new Error('平台 ID 缺失或格式无效');
  return id;
}
function approvalHash(draft) {
  return createHash('sha256').update(JSON.stringify([draft.kind, draft.account, draft.video_id, draft.comment_id, draft.user_id, draft.content, draft.version])).digest('hex');
}
function apiUrl(value) {
  const u = new URL(text(value, 500));
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('模型地址须为不带凭据、查询参数的 HTTPS 地址');
  return u.href.replace(/\/$/, '');
}
function dayKey(ts = Date.now()) { return new Date(ts + 8 * 3600000).toISOString().slice(0, 10); }
function csv(rows) {
  if (!rows.length) return '\uFEFF暂无记录\r\n';
  const keys = Object.keys(rows[0]);
  const cell = v => { let s = String(v ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return '\uFEFF' + [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n');
}
module.exports = { text, integer, words, taskConfig, matchComment, platformId, approvalHash, apiUrl, dayKey, csv };
