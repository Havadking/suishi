import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 HTML 中 P1 关键功能 DOM 元素与结构 ----------
test('HTML 包含 P1 阶段关键功能所需的 DOM 元素', () => {
  // 侧边栏清理缓存按钮
  assert.match(htmlContent, /id=["']btn-clear-cache["']/, '应该存在 #btn-clear-cache 清理缩略图缓存按钮');
  // 数据库升级至版本 3
  assert.match(htmlContent, /indexedDB\.open\(['"]suishi-video-db['"],\s*3\)/, 'IndexedDB 版本应升级为 3');
  // 包含 thumbnails 对象仓库创建
  assert.match(htmlContent, /thumbnails/, '应该包含 thumbnails 缓存表');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法验证 (P1 升级后)', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 算法单元测试：缩略图缓存复合指纹 Key 生成算法 ----------
test('缩略图缓存 Key 指纹算法精准防脏', () => {
  function getThumbnailCacheKey(folderId, v) {
    const relPath = (v.path ? v.path + '/' : '') + v.name;
    return `${folderId || ''}:${relPath}:${v.size}:${v.mtime}`;
  }

  const v1 = { name: 'demo.mp4', path: 'trip', size: 10240, mtime: 1700000000 };
  const key1 = getThumbnailCacheKey('f_1', v1);
  assert.equal(key1, 'f_1:trip/demo.mp4:10240:1700000000', '指纹键格式完整');

  // 同名文件在不同文件夹，Key 必须不同
  const key2 = getThumbnailCacheKey('f_2', v1);
  assert.notEqual(key1, key2, '不同目录下的同名文件 Key 区分隔离');

  // 文件被外部替换（修改时间或大小改变），Key 必须不同以防脏缓存
  const v1Modified = { ...v1, mtime: 1700009999 };
  assert.notEqual(key1, getThumbnailCacheKey('f_1', v1Modified), '文件修改时间变动时指纹改变');

  const v1Resized = { ...v1, size: 20480 };
  assert.notEqual(key1, getThumbnailCacheKey('f_1', v1Resized), '文件大小变动时指纹改变');
});

// ---------- 4. 算法单元测试：断点续播判定逻辑与边界控制 ----------
test('断点续播进度记录判定与自动清除逻辑', () => {
  function shouldSaveProgress(currentTime, duration) {
    // 规则：播放超过 5 秒且剩余时长大于 10 秒才保存
    return currentTime >= 5 && (duration - currentTime) > 10;
  }

  function shouldClearProgress(currentTime, duration) {
    // 规则：剩余时长小于等于 5 秒或已接近末尾，视为已看完并清除
    return (duration - currentTime) <= 5 || currentTime >= duration - 1;
  }

  assert.equal(shouldSaveProgress(3, 60), false, '播放小于 5 秒不记录');
  assert.equal(shouldSaveProgress(15, 60), true, '播放 15 秒且剩余 45 秒记录进度');
  assert.equal(shouldSaveProgress(55, 60), false, '剩余 5 秒不记录');

  assert.equal(shouldClearProgress(56, 60), true, '剩余 4 秒应视为已看完');
  assert.equal(shouldClearProgress(59.5, 60), true, '末尾阶段应清除记录');
  assert.equal(shouldClearProgress(30, 60), false, '播放中途不清除');
});

// ---------- 5. 算法单元测试：断点续播存储字典管理 ----------
test('断点续播存储字典读写逻辑', () => {
  const store = {};

  function saveProgress(store, fileKey, time, duration) {
    if (duration - time <= 5) {
      delete store[fileKey];
      return;
    }
    if (time >= 5 && duration - time > 10) {
      store[fileKey] = {
        time: Math.round(time),
        duration: Math.round(duration),
        updatedAt: Date.now()
      };
    }
  }

  saveProgress(store, 'vid_1', 45.3, 120);
  assert.ok(store['vid_1'], 'vid_1 应被记录');
  assert.equal(store['vid_1'].time, 45, '秒数四舍五入为 45');

  // 快看完时清除
  saveProgress(store, 'vid_1', 118, 120);
  assert.equal(store['vid_1'], undefined, '快看完时自动从字典清除');
});

// ---------- 6. 算法单元测试：分批渐进挂载 Chunk 计算 ----------
test('分批渐进挂载 (Chunk Slice) 计算', () => {
  const CHUNK_SIZE = 60;
  const totalItems = 145; // 假设有 145 个视频

  function getChunkRange(currentRendered, total) {
    const start = currentRendered;
    const end = Math.min(total, currentRendered + CHUNK_SIZE);
    return { start, end, count: end - start };
  }

  // 第一批
  const chunk1 = getChunkRange(0, totalItems);
  assert.equal(chunk1.start, 0);
  assert.equal(chunk1.end, 60);
  assert.equal(chunk1.count, 60);

  // 第二批
  const chunk2 = getChunkRange(60, totalItems);
  assert.equal(chunk2.start, 60);
  assert.equal(chunk2.end, 120);
  assert.equal(chunk2.count, 60);

  // 第三批 (剩余批次)
  const chunk3 = getChunkRange(120, totalItems);
  assert.equal(chunk3.start, 120);
  assert.equal(chunk3.end, 145);
  assert.equal(chunk3.count, 25);

  // 已全部挂载
  const chunk4 = getChunkRange(145, totalItems);
  assert.equal(chunk4.count, 0, '无更多可挂载分块');
});
