import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// 局域网分享服务：起一个真实进程，打真实 HTTP 请求（--no-thumbs，不依赖 ffmpeg）

const SERVER = path.resolve('server.mjs');
const PORT = 18970 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'pw-1234';

let root, child, folderId;

function startServer(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += d.toString(); if (out.includes('已启动')) resolve(p); };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error('server start timeout: ' + out)), 8000);
  });
}

test.before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'suishi-share-'));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'a.mp4'), Buffer.alloc(1000, 1));
  fs.writeFileSync(path.join(root, 'a.suishi.json'), JSON.stringify({ site: 'bilibili', title: '标题' }));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(root, 'sub', 'b.jpg'), Buffer.alloc(500, 2));
  fs.writeFileSync(path.join(root, '.hidden', 'c.mp4'), Buffer.alloc(10, 3));
  child = await startServer(['--port', String(PORT), '--token', TOKEN, '--no-thumbs', root]);
});

test.after(() => {
  if (child) child.kill();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});

let cookie = '';
const get = (p, headers = {}) => fetch(BASE + p, { headers: { cookie, ...headers } });

test('info：未登录时只暴露 auth 状态，不给目录列表', async () => {
  const info = await (await get('/api/share/info')).json();
  assert.equal(info.app, 'suishi-share');
  assert.equal(info.auth, true);
  assert.equal(info.authed, false);
  assert.deepEqual(info.folders, []);
  assert.equal(info.thumbs, false);
});

test('未登录访问清单与媒体 → 401', async () => {
  assert.equal((await get('/api/share/list?folder=x')).status, 401);
  assert.equal((await get('/media/x/a.mp4')).status, 401);
});

test('login：错口令 401，对口令下发 HttpOnly Cookie', async () => {
  const bad = await fetch(BASE + '/api/share/login', { method: 'POST', body: JSON.stringify({ token: 'nope' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(BASE + '/api/share/login', { method: 'POST', body: JSON.stringify({ token: TOKEN }) });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /suishi_share=[0-9a-f]{64};.*HttpOnly/);
  cookie = setCookie.split(';')[0];
  const info = await (await get('/api/share/info')).json();
  assert.equal(info.authed, true);
  assert.equal(info.folders.length, 1);
  assert.match(info.folders[0].id, /^r_[0-9a-f]{10}$/);
  folderId = info.folders[0].id;
});

test('list：只收媒体文件，带 sidecar 标记，跳过隐藏目录；recursive=0 不进子目录', async () => {
  const rec = await (await get(`/api/share/list?folder=${folderId}&recursive=1`)).json();
  const names = rec.files.map(f => `${f.path}/${f.name}`).sort();
  assert.deepEqual(names, ['/a.mp4', 'sub/b.jpg']);
  const a = rec.files.find(f => f.name === 'a.mp4');
  assert.equal(a.sidecar, true);
  assert.equal(a.size, 1000);
  assert.ok(a.mtime > 0);
  assert.equal(rec.files.find(f => f.name === 'b.jpg').sidecar, false);

  const flat = await (await get(`/api/share/list?folder=${folderId}&recursive=0`)).json();
  assert.deepEqual(flat.files.map(f => f.name), ['a.mp4']);
  assert.equal((await get('/api/share/list?folder=nope')).status, 404);
});

test('media：完整响应、Range 206、尾部 Range、非法 Range 416、HEAD、ETag 304', async () => {
  const full = await get(`/media/${folderId}/a.mp4`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal((await full.arrayBuffer()).byteLength, 1000);

  const part = await get(`/media/${folderId}/a.mp4`, { Range: 'bytes=10-19' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.equal((await part.arrayBuffer()).byteLength, 10);

  const tail = await get(`/media/${folderId}/a.mp4`, { Range: 'bytes=-5' });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), 'bytes 995-999/1000');

  const open = await get(`/media/${folderId}/a.mp4`, { Range: 'bytes=990-' });
  assert.equal(open.headers.get('content-range'), 'bytes 990-999/1000');

  assert.equal((await get(`/media/${folderId}/a.mp4`, { Range: 'bytes=2000-' })).status, 416);
  assert.equal((await get(`/media/${folderId}/a.mp4`, { Range: 'bytes=abc' })).status, 416);

  const head = await fetch(BASE + `/media/${folderId}/a.mp4`, { method: 'HEAD', headers: { cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '1000');

  const etag = full.headers.get('etag');
  assert.equal((await get(`/media/${folderId}/a.mp4`, { 'If-None-Match': etag })).status, 304);
});

test('media：子目录文件、sidecar 可读，非媒体文件与越界路径 404', async () => {
  assert.equal((await get(`/media/${folderId}/sub/b.jpg`)).headers.get('content-type'), 'image/jpeg');
  const sc = await (await get(`/media/${folderId}/a.suishi.json`)).json();
  assert.equal(sc.title, '标题');
  assert.equal((await get(`/media/${folderId}/notes.txt`)).status, 404);
  assert.equal((await get(`/media/${folderId}/.hidden/c.mp4`)).status, 200, '隐藏目录不列出，但显式路径仍在根目录内，允许');
  assert.equal((await get(`/media/${folderId}/%2e%2e/server.mjs`)).status, 404);
  assert.equal((await get(`/media/${folderId}/sub/..%2F..%2Fserver.mjs`)).status, 404);
  assert.equal((await get(`/media/r_0000000000/a.mp4`)).status, 404);
  assert.equal((await get(`/thumb/${folderId}/a.mp4`)).status, 404, '--no-thumbs 下封面接口关闭');
});

test('根路径返回 index.html 且不缓存', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(await r.text(), /suishi-share/);
});
