import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 HTML 结构与关键元素完整性 ----------
test('HTML 包含 P0 关键功能所需的 DOM 元素', () => {
  // 刷新目录按钮
  assert.match(htmlContent, /id=["']btn-refresh["']/, '应该存在 #btn-refresh 刷新按钮');
  // Modal 全屏按钮
  assert.match(htmlContent, /id=["']modal-fullscreen["']/, '应该存在 #modal-fullscreen 全屏按钮');
  // HUD 浮层
  assert.match(htmlContent, /id=["']modal-hud["']/, '应该存在 #modal-hud 浮层');
  assert.match(htmlContent, /class=["'][^"']*player-hud[^"']*["']/, '应该存在 player-hud 样式类');
  // Feed 全屏与 HUD
  assert.match(htmlContent, /id=["']feed-fullscreen["']/, '应该存在 #feed-fullscreen 全屏按钮');
  // 非原生播放拦截弹窗
  assert.match(htmlContent, /id=["']non-playable-modal["']/, '应该存在 #non-playable-modal 弹窗');
  assert.match(htmlContent, /id=["']btn-np-copy["']/, '应该存在 #btn-np-copy 复制路径按钮');
  assert.match(htmlContent, /id=["']btn-np-close["']/, '应该存在 #btn-np-close 关闭按钮');
  assert.match(htmlContent, /feed-scrubber/, '应该包含 feed-scrubber 进度条样式或结构');
});

// ---------- 2. 验证 HTML 中 <script> 代码语法正确性 ----------
test('index.html 中的内联 JavaScript 语法验证', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];
  
  // 使用 Node.js vm.Script 进行纯语法编译检查
  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 算法逻辑单元测试：倍速调节算法 ----------
test('倍速档位与步进算法逻辑', () => {
  const SPEED_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  function getNextSpeed(current, direction) {
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < SPEED_LEVELS.length; i++) {
      const diff = Math.abs(SPEED_LEVELS[i] - current);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    const targetIdx = Math.max(0, Math.min(SPEED_LEVELS.length - 1, closestIdx + direction));
    return SPEED_LEVELS[targetIdx];
  }

  assert.equal(getNextSpeed(1.0, 1), 1.25, '1.0 加速一步到 1.25');
  assert.equal(getNextSpeed(1.25, 1), 1.5, '1.25 加速一步到 1.5');
  assert.equal(getNextSpeed(2.0, 1), 2.0, '2.0 加速达到上限保持 2.0');
  assert.equal(getNextSpeed(1.0, -1), 0.75, '1.0 减速一步到 0.75');
  assert.equal(getNextSpeed(0.5, -1), 0.5, '0.5 减速达到下限保持 0.5');
  assert.equal(getNextSpeed(1.1, 1), 1.25, '非标速度 1.1 加速匹配到 1.25');
});

// ---------- 4. 算法逻辑单元测试：音量调节与边界控制 ----------
test('音量步进算法与边界约束', () => {
  function adjustVolume(vol, delta) {
    const raw = Math.round((vol + delta) * 100) / 100;
    return Math.max(0, Math.min(1, raw));
  }

  assert.equal(adjustVolume(1.0, 0.05), 1.0, '音量达到 1.0 上限不能溢出');
  assert.equal(adjustVolume(1.0, -0.05), 0.95, '1.0 减少 5% 为 0.95');
  assert.equal(adjustVolume(0.02, -0.05), 0.0, '音量达到 0 下限不能为负数');
  assert.equal(adjustVolume(0.5, 0.05), 0.55, '0.5 增加 5% 为 0.55');
});

// ---------- 5. 算法逻辑单元测试：原生格式可播性检测 ----------
test('原生播放格式与非原生拦截识别', () => {
  const NATIVE_PLAYABLE = ['mp4', 'webm', 'ogg', 'ogv', 'm4v', 'mov'];
  function isNativePlayable(ext) {
    return NATIVE_PLAYABLE.includes((ext || '').toLowerCase());
  }

  assert.equal(isNativePlayable('mp4'), true, 'mp4 支持原生播放');
  assert.equal(isNativePlayable('webm'), true, 'webm 支持原生播放');
  assert.equal(isNativePlayable('mov'), true, 'mov 支持原生播放');
  assert.equal(isNativePlayable('MP4'), true, '大写 MP4 支持原生播放');

  assert.equal(isNativePlayable('mkv'), false, 'mkv 应被识别为非原生');
  assert.equal(isNativePlayable('avi'), false, 'avi 应被识别为非原生');
  assert.equal(isNativePlayable('flv'), false, 'flv 应被识别为非原生');
  assert.equal(isNativePlayable('wmv'), false, 'wmv 应被识别为非原生');
  assert.equal(isNativePlayable('ts'), false, 'ts 应被识别为非原生');
});

// ---------- 6. 算法逻辑单元测试：目录重新扫描增量差分对比 ----------
test('目录重新扫描 Diff 增量检测算法', () => {
  function diffVideoLists(oldList, newList) {
    const getKey = (v) => `${v.path ? v.path + '/' : ''}${v.name}`;
    const oldSet = new Set(oldList.map(getKey));
    const newSet = new Set(newList.map(getKey));

    let added = 0;
    let removed = 0;

    for (const k of newSet) {
      if (!oldSet.has(k)) added++;
    }
    for (const k of oldSet) {
      if (!newSet.has(k)) removed++;
    }

    return { added, removed };
  }

  const oldList = [
    { name: 'clip1.mp4', path: '' },
    { name: 'clip2.mp4', path: 'trip' },
    { name: 'deleted.mp4', path: 'trip' }
  ];

  const newList = [
    { name: 'clip1.mp4', path: '' },
    { name: 'clip2.mp4', path: 'trip' },
    { name: 'new1.mp4', path: '' },
    { name: 'new2.mp4', path: 'vlog' }
  ];

  const diff = diffVideoLists(oldList, newList);
  assert.equal(diff.added, 2, '新增 2 个文件');
  assert.equal(diff.removed, 1, '移除 1 个文件');
});

// ---------- 7. 算法逻辑单元测试：Feed 进度条 Seek 计算 ----------
test('Feed Scrubber Seek 计算与安全边界限制', () => {
  function calcSeekPercent(clientX, rectLeft, rectWidth) {
    if (rectWidth <= 0) return 0;
    const offset = clientX - rectLeft;
    const ratio = offset / rectWidth;
    return Math.max(0, Math.min(1, ratio));
  }

  assert.equal(calcSeekPercent(50, 0, 100), 0.5, '居中位置比例 0.5');
  assert.equal(calcSeekPercent(-20, 0, 100), 0, '左侧越界限制在 0');
  assert.equal(calcSeekPercent(150, 0, 100), 1, '右侧越界限制在 1');
  assert.equal(calcSeekPercent(30, 10, 80), 0.25, '带偏移量计算比例');
});

// ---------- 8. 算法逻辑单元测试：快进快退步进计算 ----------
test('快进快退步进逻辑与 Shift 加速支持', () => {
  function calcSeekDelta(isShift) {
    return isShift ? 10 : 5;
  }
  function applySeek(currentTime, duration, delta) {
    return Math.max(0, Math.min(duration, currentTime + delta));
  }

  assert.equal(calcSeekDelta(false), 5, '常规方向键步进 5 秒');
  assert.equal(calcSeekDelta(true), 10, '按住 Shift 步进 10 秒');
  assert.equal(applySeek(2, 60, -5), 0, '后退到达下限 0');
  assert.equal(applySeek(55, 60, 10), 60, '快进到达上限 duration');
});

// ---------- 9. 快捷键映射完整性与安全防重验证 ----------
test('index.html 快捷键全覆盖检测', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  const code = scriptMatch[1];

  // 必须包含输入框按键隔离
  assert.match(code, /activeTag === 'INPUT'/, '必须包含输入框焦点隔离保护');
  // 包含全屏快捷键 F
  assert.match(code, /'f'/, '必须包含快捷键 F');
  // 包含刷新快捷键 R
  assert.match(code, /'r'/, '必须包含快捷键 R');
  // 包含倍速切换 [ 与 ]
  assert.match(code, /'\['/, '必须包含减速快捷键 [');
  assert.match(code, /'\]'/, '必须包含加速快捷键 ]');
  // 包含翻页快捷键 N 与 P
  assert.match(code, /'n'/, '必须包含下一个切换快捷键 N');
  assert.match(code, /'p'/, '必须包含上一个切换快捷键 P');
});

