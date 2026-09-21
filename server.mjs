#!/usr/bin/env node
// 随拾 · 局域网分享服务（可选伴生进程，零依赖，只用 Node 内置模块）
//
// 在电脑上把若干本地目录以 HTTP 的方式共享给同一局域网内的平板 / 手机：
//   node server.mjs D:\Videos E:\Clips            共享两个目录，默认端口 8970
//   node server.mjs --port 9000 --token 1234 D:\Videos
//   node server.mjs                                不带参数时读取同目录下的 share.json
//
// share.json 示例：{ "folders": ["D:\\Videos"], "port": 8970, "token": "" }
//
// 提供的接口（前端 index.html 在同源下探测到 /api/share/info 后进入「局域网模式」）：
//   GET  /                                页面本身
//   GET  /api/share/info                  服务信息与共享目录列表
//   POST /api/share/login  {token}        设置口令 Cookie（仅在启动时给了 --token 才需要）
//   GET  /api/share/list?folder=ID&recursive=1
//   GET  /media/ID/相对路径                 媒体文件（支持 HTTP Range，拖进度条 / iOS 依赖它）
//   GET  /thumb/ID/相对路径                 视频封面 JPEG（需本机有 ffmpeg；响应头 X-Duration 带时长秒数）
//
// 只读：不提供删除 / 重命名接口，平板端相应按钮会隐藏。

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, 'index.html');
const THUMB_DIR = path.join(__dirname, '.suishi-cache', 'thumbs');

// 与 index.html 里的 VIDEO_EXT / IMAGE_EXT 保持一致
const VIDEO_EXT = ['mp4','webm','ogg','ogv','mov','m4v','mkv','avi','wmv','flv','ts'];
const IMAGE_EXT = ['jpg','jpeg','png','gif','webp','avif','bmp','svg','ico',
                   'heic','heif','tif','tiff','psd','raw','cr2','cr3','nef','arw','dng'];
const MEDIA_EXT = new Set([...VIDEO_EXT, ...IMAGE_EXT]);
const SIDECAR_SUFFIX = '.suishi.json';
const SKIP_DIRS = new Set(['$RECYCLE.BIN', 'System Volume Information', 'node_modules', '.suishi-cache']);

const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  ogg: 'video/ogg', ogv: 'video/ogg', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', flv: 'video/x-flv', ts: 'video/mp2t',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  json: 'application/json', html: 'text/html; charset=utf-8',
};

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const opts = { port: null, token: null, thumbs: true, folders: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (a === '--token' || a === '-t') opts.token = String(argv[++i] || '');
    else if (a.startsWith('--token=')) opts.token = a.slice(8);
    else if (a === '--no-thumbs') opts.thumbs = false;
    else if (a === '-h' || a === '--help') { printUsage(); process.exit(0); }
    else opts.folders.push(a);
  }
  return opts;
}
function printUsage() {
  console.log(`用法：node server.mjs [--port 8970] [--token 口令] [--no-thumbs] <目录> [<目录>...]
不带目录参数时读取 share.json（{ "folders": [...], "port": 8970, "token": "" }）。`);
}

const cli = parseArgs(process.argv.slice(2));
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'share.json'), 'utf8')); } catch {}
const PORT = cli.port || Number(fileCfg.port) || 8970;
const TOKEN = (cli.token != null ? cli.token : (fileCfg.token || '')).trim();
const THUMBS_WANTED = cli.thumbs && fileCfg.thumbs !== false;
const folderInputs = cli.folders.length ? cli.folders : (Array.isArray(fileCfg.folders) ? fileCfg.folders : []);
if (!folderInputs.length) { printUsage(); process.exit(1); }

// 目录 id 由绝对路径哈希得来：重启后不变，平板上的收藏 / 续播记录才能对得上
const folders = [];
for (const p of folderInputs) {
  const abs = path.resolve(String(p));
  let st = null;
  try { st = fs.statSync(abs); } catch {}
  if (!st || !st.isDirectory()) { console.error(`跳过：不是目录 → ${abs}`); continue; }
  const id = 'r_' + crypto.createHash('sha1').update(abs.toLowerCase()).digest('hex').slice(0, 10);
  if (folders.some(f => f.id === id)) continue;
  folders.push({ id, name: path.basename(abs) || abs, root: abs });
}
if (!folders.length) { console.error('没有可用的目录，退出。'); process.exit(1); }

// ---------- 口令（可选） ----------
const COOKIE_NAME = 'suishi_share';
const cookieValueForToken = TOKEN ? crypto.createHash('sha256').update('suishi-share:' + TOKEN).digest('hex') : '';
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function isAuthed(req) {
  if (!TOKEN) return true;
  const c = parseCookies(req)[COOKIE_NAME] || '';
  if (c.length !== cookieValueForToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(cookieValueForToken));
}

// ---------- ffmpeg 探测 ----------
let ffmpegOk = false;
function probeFfmpeg() {
  return new Promise((resolve) => {
    if (!THUMBS_WANTED) return resolve(false);
    let p;
    try { p = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] }); }
    catch { return resolve(false); }
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

// ---------- 工具 ----------
function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function extOf(name) { return name.split('.').pop().toLowerCase(); }
function isMediaName(name) { return MEDIA_EXT.has(extOf(name)); }

// 把 /media/ID/a/b/c.mp4 解析成 { folder, abs, rel }；任何越界（..、绝对路径、符号链接逃逸）都返回 null
async function resolveMediaPath(pathname, prefix) {
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const folderId = rest.slice(0, slash);
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return null;
  let rel;
  try { rel = rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/'); } catch { return null; }
  if (!rel || rel.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
  const abs = path.resolve(folder.root, rel);
  const rootWithSep = folder.root.endsWith(path.sep) ? folder.root : folder.root + path.sep;
  if (!abs.startsWith(rootWithSep)) return null;
  let real;
  try { real = await fsp.realpath(abs); } catch { return null; }
  let rootReal;
  try { rootReal = await fsp.realpath(folder.root); } catch { return null; }
  const rootRealSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (!real.startsWith(rootRealSep)) return null;
  return { folder, abs: real, rel };
}

// ---------- 目录遍历 ----------
async function listFolder(folder, recursive) {
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    const files = [];
    const subdirs = [];
    const sidecars = new Set();
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if (e.isDirectory()) { if (recursive) subdirs.push(e.name); }
      else if (e.isFile()) {
        if (isMediaName(e.name)) files.push(e.name);
        else if (e.name.toLowerCase().endsWith(SIDECAR_SUFFIX)) sidecars.add(e.name.slice(0, -SIDECAR_SUFFIX.length));
      }
    }
    const stats = await Promise.all(files.map(n => fsp.stat(path.join(dir, n)).catch(() => null)));
    files.forEach((name, i) => {
      const st = stats[i];
      if (!st) return;
      const stem = name.replace(/\.[^.]+$/, '');
      out.push({ path: rel, name, size: st.size, mtime: Math.round(st.mtimeMs), sidecar: sidecars.has(stem) });
    });
    for (const d of subdirs) await walk(path.join(dir, d), rel ? `${rel}/${d}` : d);
  }
  await walk(folder.root, '');
  return out;
}

// ---------- 带 Range 的文件响应 ----------
async function serveFile(req, res, abs, { cacheControl = 'private, max-age=3600' } = {}) {
  let st;
  try { st = await fsp.stat(abs); } catch { res.writeHead(404); return res.end('Not Found'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('Not Found'); }
  const type = MIME[extOf(abs)] || 'application/octet-stream';
  const total = st.size;
  const etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
  const baseHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'Last-Modified': st.mtime.toUTCString(),
    'ETag': etag,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, baseHeaders); return res.end(); }

  let start = 0, end = total - 1, status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    if (m[1] === '') {            // bytes=-N：最后 N 字节
      const n = Number(m[2]);
      start = Math.max(0, total - n);
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), total - 1);
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    status = 206;
    baseHeaders['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  baseHeaders['Content-Length'] = total === 0 ? 0 : (end - start + 1);
  res.writeHead(status, baseHeaders);
  if (req.method === 'HEAD' || total === 0) return res.end();
  const stream = fs.createReadStream(abs, { start, end });
  stream.on('error', () => { try { res.destroy(); } catch {} });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ---------- ffmpeg 封面 ----------
const thumbInflight = new Map();   // cacheKey -> Promise
let thumbRunning = 0;
const thumbQueue = [];
const THUMB_PARALLEL = 2;
function withThumbSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      thumbRunning++;
      fn().then(resolve, reject).finally(() => {
        thumbRunning--;
        const next = thumbQueue.shift();
        if (next) next();
      });
    };
    if (thumbRunning < THUMB_PARALLEL) run(); else thumbQueue.push(run);
  });
}
function runFfmpeg(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += d.toString('utf8'); });
    p.on('error', () => { clearTimeout(timer); resolve({ code: -1, stderr }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}
function parseDuration(stderr) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
// 与前端一致：取 min(15% 时长, 3s) 处的一帧；不知道时长时先试 3s，太短的片子退到 0s
async function makeThumb(abs, st) {
  const key = crypto.createHash('sha1').update(`${abs}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex');
  const jpg = path.join(THUMB_DIR, key + '.jpg');
  const meta = path.join(THUMB_DIR, key + '.json');
  try {
    await fsp.access(jpg);
    let duration = null;
    try { duration = JSON.parse(await fsp.readFile(meta, 'utf8')).duration; } catch {}
    return { jpg, duration };
  } catch {}
  if (thumbInflight.has(key)) return thumbInflight.get(key);
  const job = withThumbSlot(async () => {
    await fsp.mkdir(THUMB_DIR, { recursive: true });
    const tmp = jpg + '.tmp.jpg';
    const vf = 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180';
    const argsFor = (ss) => ['-hide_banner', '-nostdin', '-loglevel', 'info', '-ss', String(ss), '-i', abs,
      '-frames:v', '1', '-vf', vf, '-q:v', '5', '-f', 'image2', '-y', tmp];
    let r = await runFfmpeg(argsFor(3));
    let duration = parseDuration(r.stderr);
    let ok = r.code === 0 && await fsp.stat(tmp).then(s => s.size > 0).catch(() => false);
    if (!ok) {
      const ss = duration != null ? Math.max(0, Math.min(duration * 0.15, 3)) : 0;
      r = await runFfmpeg(argsFor(ss));
      if (duration == null) duration = parseDuration(r.stderr);
      ok = r.code === 0 && await fsp.stat(tmp).then(s => s.size > 0).catch(() => false);
    }
    if (!ok) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw new Error('ffmpeg failed'); }
    await fsp.rename(tmp, jpg);
    await fsp.writeFile(meta, JSON.stringify({ duration })).catch(() => {});
    return { jpg, duration };
  }).finally(() => thumbInflight.delete(key));
  thumbInflight.set(key, job);
  return job;
}

// ---------- 路由 ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/' || p === '/index.html') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveFile(req, res, INDEX_HTML, { cacheControl: 'no-store' });
  }
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

  if (p === '/api/share/info') {
    const authed = isAuthed(req);
    return sendJson(res, 200, {
      app: 'suishi-share',
      version: 1,
      host: os.hostname(),
      auth: !!TOKEN,
      authed,
      thumbs: ffmpegOk,
      folders: authed ? folders.map(f => ({ id: f.id, name: f.name, path: f.root })) : [],
    });
  }
  if (p === '/api/share/login') {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
    const given = String(body.token || '');
    const ok = !TOKEN || (given.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN)));
    if (!ok) return sendJson(res, 401, { error: '口令不正确' });
    const cookie = `${COOKIE_NAME}=${cookieValueForToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;
    return sendJson(res, 200, { ok: true }, TOKEN ? { 'Set-Cookie': cookie } : {});
  }

  // 下面的都需要口令
  if (!isAuthed(req)) return sendJson(res, 401, { error: '需要口令' });

  if (p === '/api/share/list') {
    const folder = folders.find(f => f.id === url.searchParams.get('folder'));
    if (!folder) return sendJson(res, 404, { error: '目录不存在' });
    const recursive = url.searchParams.get('recursive') === '1';
    const files = await listFolder(folder, recursive);
    return sendJson(res, 200, { folder: { id: folder.id, name: folder.name }, files });
  }

  if (p.startsWith('/media/')) {
    const r = await resolveMediaPath(p, '/media/');
    if (!r) { res.writeHead(404); return res.end('Not Found'); }
    const name = path.basename(r.abs);
    if (!isMediaName(name) && !name.toLowerCase().endsWith(SIDECAR_SUFFIX)) { res.writeHead(404); return res.end('Not Found'); }
    return serveFile(req, res, r.abs);
  }

  if (p.startsWith('/thumb/')) {
    if (!ffmpegOk) { res.writeHead(404); return res.end('thumbs disabled'); }
    const r = await resolveMediaPath(p, '/thumb/');
    if (!r || !VIDEO_EXT.includes(extOf(r.abs))) { res.writeHead(404); return res.end('Not Found'); }
    let st;
    try { st = await fsp.stat(r.abs); } catch { res.writeHead(404); return res.end('Not Found'); }
    try {
      const t = await makeThumb(r.abs, st);
      const buf = await fsp.readFile(t.jpg);
      const headers = { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' };
      if (t.duration != null) headers['X-Duration'] = String(t.duration);
      res.writeHead(200, headers);
      return res.end(buf);
    } catch {
      res.writeHead(500); return res.end('thumb failed');
    }
  }

  res.writeHead(404); res.end('Not Found');
}

// ---------- 启动 ----------
ffmpegOk = await probeFfmpeg();
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) { res.writeHead(500); res.end('Internal Error'); }
    else res.destroy();
  });
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用，换一个：node server.mjs --port 9000 ...`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }
  console.log('随拾 · 局域网分享服务已启动');
  console.log('共享目录：');
  for (const f of folders) console.log(`  📁 ${f.name}  →  ${f.root}`);
  console.log(`封面：${ffmpegOk ? 'ffmpeg 服务端生成' : (THUMBS_WANTED ? '未找到 ffmpeg，由平板端浏览器自行抽帧（较慢）' : '已关闭服务端生成')}`);
  console.log(`口令：${TOKEN ? '已启用' : '未设置（同一局域网内任何设备都可访问；可用 --token 加口令）'}`);
  console.log('平板 / 手机在同一 Wi-Fi 下打开：');
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/`);
  if (!ips.length) console.log(`  http://<本机IP>:${PORT}/`);
  console.log(`本机：http://localhost:${PORT}/   （Ctrl+C 停止）`);
});
