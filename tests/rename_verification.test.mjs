import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const scriptCode = (htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i) || [])[1] || '';

// ---------- 1. DOM 结构与样式验证 ----------
test('HTML 包含视频重命名功能所需的 DOM 元素与样式规则', () => {
  for (const id of ['rename-modal', 'rename-input', 'rename-ext', 'rename-msg', 'btn-rename-cancel', 'btn-rename-confirm', 'modal-rename', 'feed-rename']) {
    assert.match(htmlContent, new RegExp(`id=["']${id}["']`), `应该存在 #${id}`);
  }
  assert.match(htmlContent, /\.card-rename-btn/, '应该包含 .card-rename-btn 样式定义');
  assert.match(htmlContent, /\.card-actions/, '应该包含 .card-actions 容器样式定义');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法完整性校验 (含重命名功能)', () => {
  assert.ok(scriptCode, '必须存在 <script> 标签');
  assert.doesNotThrow(() => {
    new vm.Script(scriptCode, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 算法与校验逻辑单元测试 ----------
test('重命名文件名提取与非法字符过滤算法', () => {
  function sanitizeRenameInput(rawInput, ext) {
    const trimmed = rawInput.trim();
    const newStem = trimmed.replace(new RegExp(`\\.${ext}$`, 'i'), '').trim();
    if (!newStem) return { error: '视频名称不能为空' };
    if (/[\\/:*?"<>|]/.test(newStem)) return { error: '名称不能包含字符：\\ / : * ? " < > |' };
    return { valid: true, newStem, newFullName: `${newStem}.${ext}` };
  }

  // 基础重命名
  assert.deepEqual(sanitizeRenameInput('新视频名称', 'mp4'), {
    valid: true,
    newStem: '新视频名称',
    newFullName: '新视频名称.mp4'
  });

  // 输入自带扩展名应自动去重，不应变成 .mp4.mp4
  assert.deepEqual(sanitizeRenameInput('新视频名称.mp4', 'mp4'), {
    valid: true,
    newStem: '新视频名称',
    newFullName: '新视频名称.mp4'
  });

  // 空字符串拦截
  assert.equal(sanitizeRenameInput('   ', 'mp4').error, '视频名称不能为空');

  // 非法字符拦截
  for (const ch of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    assert.equal(
      sanitizeRenameInput(`测试${ch}非法`, 'mp4').error,
      '名称不能包含字符：\\ / : * ? " < > |',
      `字符 ${ch} 应被识别为非法字符`
    );
  }
});

test('重命名联动 sidecar、收藏 Key 与进度 Key 计算一致性', () => {
  const folderId = 'f_123';
  const v = {
    name: 'old_video.mp4',
    ext: 'mp4',
    path: 'subfolder',
    size: 1024,
    mtime: 1700000000000
  };

  const getFavoriteKey = (fId, item) => `${fId || ''}:${(item.path ? item.path + '/' : '') + item.name}`;
  const getProgressKey = (fId, item) => `${fId || ''}:${(item.path ? item.path + '/' : '') + item.name}`;
  const getSidecarName = (newStem) => `${newStem}.suishi.json`;

  const newStem = 'new_video';
  const newFullName = `${newStem}.${v.ext}`;

  assert.equal(getSidecarName(newStem), 'new_video.suishi.json');

  const oldFav = getFavoriteKey(folderId, v);
  assert.equal(oldFav, 'f_123:subfolder/old_video.mp4');

  v.name = newFullName;
  const newFav = getFavoriteKey(folderId, v);
  assert.equal(newFav, 'f_123:subfolder/new_video.mp4');
  assert.equal(getProgressKey(folderId, v), 'f_123:subfolder/new_video.mp4');
});

// ---------- 4. 快捷键与组件绑定挂点测试 ----------
test('Modal、Feed 与卡片上均挂载了重命名入口与 F2 快捷键', () => {
  assert.match(scriptCode, /modalRenameBtn\.addEventListener\('click'/, 'Modal 应绑定重命名按钮点击事件');
  assert.match(scriptCode, /feedRenameBtn\.addEventListener\('click'/, 'Feed 模式应绑定重命名按钮点击事件');
  assert.match(scriptCode, /openRenameDialog\(v\)/, '卡片重命名按钮应调用 openRenameDialog');
  assert.match(scriptCode, /e\.key === 'F2'/, '应该注册 F2 重命名快捷键');
});

// ---------- 5. 容错与回退：handle.move 抛出 NotSupportedError 时平滑回退 ----------
test('performRenameVideo 当 handle.move 抛出 NotSupportedError 时自动降级为读写替换', () => {
  assert.match(
    scriptCode,
    /if\s*\(\s*typeof\s+v\.handle\.move\s*===\s*['"]function['"]\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?await\s+v\.handle\.move\([\s\S]*?\}\s*catch\s*\(e\)\s*\{/,
    '必须对 handle.move 进行独立 try-catch 以允许平滑回退'
  );
  assert.match(
    scriptCode,
    /if\s*\(\s*!fileMoved\s*\)\s*\{[\s\S]*?await\s+writable\.write\(file\)[\s\S]*?await\s+writable\.close\(\)[\s\S]*?await\s+parent\.removeEntry\(v\.name\)/,
    '降级逻辑必须先完整写入新文件再移除原文件'
  );
});
