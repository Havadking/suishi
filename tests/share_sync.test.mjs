import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';

// 电脑端侧栏目录 → 服务端共享目录 的同步：
//  1) 服务端 /api/share/sync 按指纹在磁盘上定位、写 share.json、随电脑端移除而移除、拒绝非本机请求
//  2) 前端 folderFingerprint / syncShareFolders 用 mock 句柄跑一遍

const PORT = 19500 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

let workdir, root, child;

function startServer(cwd, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(cwd, 'server.mjs'), '--port', String(PORT), '--no-thumbs'],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    const onData = (d) => { out += d.toString(); if (out.includes('已启动')) resolve(p); };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error('server start timeout: ' + out)), 8000);
  });
}

test.before(async () => {
  // server.mjs 会写自己目录下的 share.json，所以复制一份到临时目录跑
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'suishi-sync-srv-'));
  fs.copyFileSync(path.resolve('server.mjs'), path.join(workdir, 'server.mjs'));
  fs.writeFileSync(path.join(workdir, 'index.html'), '<html>suishi-share</html>');

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'suishi-sync-'));
  // 两个同名目录，只有 deep/Videos 的指纹对得上
  fs.mkdirSync(path.join(root, 'decoy', 'Videos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'decoy', 'Videos', 'a.mp4'), Buffer.alloc(5));
  fs.mkdirSync(path.join(root, 'deep', 'er', 'Videos', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'deep', 'er', 'Videos', 'a.mp4'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(root, 'deep', 'er', 'Videos', 'b.jpg'), Buffer.alloc(20));
  child = await startServer(workdir, { SUISHI_SEARCH_ROOTS: root });
});

test.after(() => {
  if (child) child.kill();
  for (const d of [root, workdir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

const post = (body) => fetch(BASE + '/api/share/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const readShare = () => JSON.parse(fs.readFileSync(path.join(workdir, 'share.json'), 'utf8'));

test('sync：按目录名 + 指纹定位到正确的那个同名目录，并写入 share.json', async () => {
  const r = await post({ folders: [{
    id: 'f_1', name: 'Videos', customName: '我的视频', readable: true,
    sample: [{ name: 'a.mp4', kind: 'file', size: 1000 }, { name: 'b.jpg', kind: 'file', size: 20 }, { name: 'sub', kind: 'directory' }],
  }] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.resolved.length, 1);
  assert.equal(d.resolved[0].id, 'f_1');
  assert.equal(path.resolve(d.resolved[0].path), path.resolve(root, 'deep', 'er', 'Videos'));
  assert.deepEqual(d.missing, []);
  assert.equal(d.folders.length, 1);
  assert.equal(d.folders[0].name, '我的视频');
  assert.match(d.folders[0].id, /^r_[0-9a-f]{10}$/);

  const share = readShare();
  assert.equal(share.folders.length, 1);
  assert.equal(share.folders[0].pcId, 'f_1');
  assert.equal(share.folders[0].name, '我的视频');

  const info = await (await fetch(BASE + '/api/share/info')).json();
  assert.equal(info.folders.length, 1);
  assert.equal(info.folders[0].name, '我的视频');
});

test('sync：指纹对不上的目录报 missing；未授权（没有指纹）的目录若已记录则保留', async () => {
  const r = await post({ folders: [
    { id: 'f_1', name: 'Videos', readable: false, sample: [] },                                       // 还没重新授权
    { id: 'f_2', name: 'Videos', readable: true, sample: [{ name: 'zzz.mp4', kind: 'file', size: 1 }] },  // 哪都对不上
    { id: 'f_3', name: 'Nope', readable: false, sample: [] },                                         // 没记录也没指纹
  ] });
  const d = await r.json();
  assert.deepEqual(d.resolved.map(x => x.id), ['f_1']);
  assert.deepEqual(d.missing.sort(), ['f_2', 'f_3']);
  assert.equal(readShare().folders.length, 1);
});

test('sync：电脑端移除目录后服务端也移除；同步列表为空则清空', async () => {
  const d = await (await post({ folders: [] })).json();
  assert.deepEqual(d.folders, []);
  assert.deepEqual(readShare().folders, []);
  const info = await (await fetch(BASE + '/api/share/info')).json();
  assert.deepEqual(info.folders, []);
});

test('sync：非 POST 405；指纹条目里带路径分隔符的直接判不匹配', async () => {
  assert.equal((await fetch(BASE + '/api/share/sync')).status, 405);
  const d = await (await post({ folders: [{ id: 'f_9', name: 'Videos', readable: true, sample: [{ name: '../a.mp4', kind: 'file', size: 1000 }] }] })).json();
  assert.deepEqual(d.missing, ['f_9']);
});

// ---------- 前端 ----------
const htmlContent = fs.readFileSync(path.resolve('index.html'), 'utf8');
const scriptCode = (htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i) || [])[1] || '';
function extractFunction(name) {
  const re = new RegExp(`(async\\s+)?function\\*?\\s+${name}\\s*\\(`);
  const m = re.exec(scriptCode);
  assert.ok(m, `内联脚本里应该有函数 ${name}`);
  let i = scriptCode.indexOf('{', m.index);
  let depth = 0;
  for (; i < scriptCode.length; i++) {
    const ch = scriptCode[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return scriptCode.slice(m.index, i + 1);
}

function mockHandle(entries, perm = 'granted') {
  return {
    queryPermission: async () => perm,
    values: async function* () { for (const e of entries) yield e; },
  };
}
const fileEntry = (name, size) => ({ kind: 'file', name, getFile: async () => ({ size }) });
const dirEntry = (name) => ({ kind: 'directory', name });

test('folderFingerprint：已授权目录发名字 + 顶层条目（最多 24 条），未授权只发名字', async () => {
  const ctx = vm.createContext({ console, Promise, Array, String, JSON });
  vm.runInContext(extractFunction('folderFingerprint'), ctx);
  const many = Array.from({ length: 40 }, (_, i) => fileEntry(`v${i}.mp4`, i));
  const fp = await ctx.folderFingerprint({ id: 'f_1', name: 'Videos', customName: '别名', handle: mockHandle([dirEntry('sub'), ...many]) });
  assert.equal(fp.id, 'f_1');
  assert.equal(fp.name, 'Videos');
  assert.equal(fp.customName, '别名');
  assert.equal(fp.readable, true);
  assert.equal(fp.sample.length, 24);
  // vm 里造的对象原型属于另一个 realm，先拍平再比
  assert.deepEqual({ ...fp.sample[0] }, { name: 'sub', kind: 'directory' });
  assert.deepEqual({ ...fp.sample[1] }, { name: 'v0.mp4', kind: 'file', size: 0 });

  const fp2 = await ctx.folderFingerprint({ id: 'f_2', name: 'Locked', handle: mockHandle([fileEntry('x.mp4', 1)], 'prompt') });
  assert.equal(fp2.readable, false);
  assert.equal(fp2.sample.length, 0);

  const fp3 = await ctx.folderFingerprint({ id: 'r_1', name: 'Remote', remote: true });
  assert.equal(fp3.readable, false);
});

test('syncShareFolders：只在 localShareServer 下发请求，只对已授权却没定位到的目录提示', async () => {
  const calls = [];
  const statuses = [];
  const ctx = vm.createContext({
    console, Promise, Array, String, JSON,
    localShareServer: true,
    savedFolders: [
      { id: 'f_1', name: 'A', handle: mockHandle([fileEntry('a.mp4', 1)]) },
      { id: 'f_2', name: 'B', customName: '乙', handle: mockHandle([fileEntry('b.mp4', 2)]) },
      { id: 'f_3', name: 'C', handle: mockHandle([], 'prompt') },
      { id: 'r_9', name: 'Remote', remote: true },
    ],
    fetch: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ resolved: [{ id: 'f_1', path: 'X' }], missing: ['f_2', 'f_3'], folders: [] }) };
    },
    transientStatus: (msg) => statuses.push(msg),
  });
  vm.runInContext(extractFunction('folderFingerprint') + extractFunction('syncShareFolders'), ctx);
  await ctx.syncShareFolders();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/share/sync');
  assert.deepEqual(calls[0].body.folders.map(f => f.id), ['f_1', 'f_2', 'f_3'], '远程目录不参与同步');
  assert.equal(calls[0].body.folders[2].readable, false);
  assert.equal(statuses.length, 1);
  assert.match(statuses[0], /「乙」/);
  assert.doesNotMatch(statuses[0], /C/, '未授权的目录不提示');

  ctx.localShareServer = false;
  await ctx.syncShareFolders();
  assert.equal(calls.length, 1, '非 server.mjs 托管时不发请求');
});

test('detectRemoteShare：localhost / file:// 一律本地模式，不请求接口', async () => {
  const src = extractFunction('detectRemoteShare');
  for (const loc of [{ protocol: 'http:', hostname: 'localhost' }, { protocol: 'http:', hostname: '127.0.0.1' }, { protocol: 'file:', hostname: '' }]) {
    let fetched = false;
    const ctx = vm.createContext({ location: loc, fetch: async () => { fetched = true; return { ok: false }; } });
    vm.runInContext(src, ctx);
    assert.equal(await ctx.detectRemoteShare(), null);
    assert.equal(fetched, false, `${loc.protocol}//${loc.hostname} 不应请求 /api/share/info`);
  }
  const ctx = vm.createContext({ location: { protocol: 'http:', hostname: '192.168.1.5' },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ app: 'suishi-share', folders: [] }) }) });
  vm.runInContext(src, ctx);
  assert.equal((await ctx.detectRemoteShare()).app, 'suishi-share');
});
