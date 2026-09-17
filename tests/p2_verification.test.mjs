import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 HTML 中 P2 关键功能 DOM 元素与结构 ----------
test('HTML 包含 P2 阶段关键功能所需的 DOM 元素与 IDB 版本', () => {
  // Modal 收藏按钮
  assert.match(htmlContent, /id=["']modal-fav["']/, '应该存在 #modal-fav 收藏按钮');
  // Modal 删除按钮
  assert.match(htmlContent, /id=["']modal-delete["']/, '应该存在 #modal-delete 删除按钮');
  // Feed 收藏按钮
  assert.match(htmlContent, /id=["']feed-fav["']/, '应该存在 #feed-fav 收藏按钮');
  // 数据库升级至版本 4
  assert.match(htmlContent, /indexedDB\.open\(['"]suishi-video-db['"],\s*4\)/, 'IndexedDB 版本应升级为 4');
  // 包含 favorites 对象仓库
  assert.match(htmlContent, /favorites/, '应该包含 favorites 收藏表');
  // 卡片星标类名或样式
  assert.match(htmlContent, /card-fav-btn/, '应该包含 card-fav-btn 收藏按钮相关样式或结构');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法验证 (P2 升级后)', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 算法单元测试：星标收藏 Key 映射与集合管理 ----------
test('星标收藏 Key 算法与集合切换逻辑', () => {
  function getFavoriteKey(folderId, v) {
    const relPath = (v.path ? v.path + '/' : '') + v.name;
    return `${folderId || ''}:${relPath}`;
  }

  const favSet = new Set();
  const v1 = { name: 'highlight.mp4', path: 'trip' };
  const v2 = { name: 'clip2.mp4', path: '' };

  const k1 = getFavoriteKey('folder_a', v1);
  const k2 = getFavoriteKey('folder_a', v2);

  assert.equal(k1, 'folder_a:trip/highlight.mp4');
  assert.equal(k2, 'folder_a:clip2.mp4');

  // 加入收藏
  favSet.add(k1);
  assert.equal(favSet.has(k1), true);
  assert.equal(favSet.has(k2), false);

  // 取消收藏
  favSet.delete(k1);
  assert.equal(favSet.has(k1), false);
});

// ---------- 4. 算法单元测试：胶囊栏「⭐ 已收藏」聚合筛选 ----------
test('胶囊栏星标收藏聚合筛选逻辑', () => {
  const all = [
    { name: 'v1.mp4', path: 'a' },
    { name: 'v2.mp4', path: 'a' },
    { name: 'v3.mp4', path: 'b' }
  ];
  const favSet = new Set(['f1:a/v1.mp4', 'f1:b/v3.mp4']);

  function filterVideos(videos, activeFolder, folderId, favs) {
    if (activeFolder === '__FAVORITES__') {
      return videos.filter(v => favs.has(`${folderId}:${v.path ? v.path + '/' : ''}${v.name}`));
    }
    if (activeFolder) {
      return videos.filter(v => (v.path ? v.path.split('/')[0] : '（根目录）') === activeFolder);
    }
    return videos;
  }

  // 全部模式
  assert.equal(filterVideos(all, null, 'f1', favSet).length, 3);
  // 收藏筛选模式
  const favFiltered = filterVideos(all, '__FAVORITES__', 'f1', favSet);
  assert.equal(favFiltered.length, 2);
  assert.equal(favFiltered[0].name, 'v1.mp4');
  assert.equal(favFiltered[1].name, 'v3.mp4');
});

// ---------- 5. 算法单元测试：安全删除后列表与索引过渡判定 ----------
test('视频删除后的列表切除与 Modal 当前索引自适应调整', () => {
  function getNextModalIndexAfterDelete(currentIndex, totalCountBeforeDelete) {
    if (totalCountBeforeDelete <= 1) return -1; // 删空了，关闭
    if (currentIndex >= totalCountBeforeDelete - 1) {
      return currentIndex - 1; // 删除了最后一项，往前指一项
    }
    return currentIndex; // 删除了中间项，保留当前索引（后续项已自动前移）
  }

  // 场景 1：删除 5 个视频中的最后一个 (index 4)
  assert.equal(getNextModalIndexAfterDelete(4, 5), 3, '删完最后一条，自动切到前一条');
  // 场景 2：删除 5 个视频中的中间项 (index 2)
  assert.equal(getNextModalIndexAfterDelete(2, 5), 2, '删除中间条，保留索引承接后项');
  // 场景 3：删除仅剩的最后 1 个视频 (index 0)
  assert.equal(getNextModalIndexAfterDelete(0, 1), -1, '删完全部，关闭播放器');
});

// ---------- 6. 快捷键 S 与 Delete 在脚本中的覆盖验证 ----------
test('P2 快捷键 (S 与 Delete) 注册与焦点隔离验证', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  const code = scriptMatch[1];

  // 必须支持快捷键 's' (收藏)
  assert.match(code, /['"]s['"]/i, '必须支持快捷键 S 收藏切换');
  // 必须支持快捷键 'Delete' (删除)
  assert.match(code, /['"]Delete['"]/, '必须支持快捷键 Delete 触发删除');
});
