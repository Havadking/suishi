import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 DOM 与 CSS 结构 ----------
test('HTML 与 CSS 包含播放器窗口全屏所需的 DOM 元素与样式规范', () => {
  // 1. 窗口全屏按钮
  assert.match(
    htmlContent,
    /id=["']modal-window-fullscreen["'][\s\S]*?>\s*🗖 窗口全屏\s*<\/button>/,
    '播放器控制栏中应该存在 #modal-window-fullscreen 按钮'
  );

  // 2. CSS 样式规范
  assert.match(htmlContent, /#modal\.is-window-fullscreen\s*\{/, '应该包含 #modal.is-window-fullscreen 容器样式');
  assert.match(htmlContent, /#modal\.is-window-fullscreen video\s*\{/, '应该包含窗口全屏下的 video 视口填满样式');
  assert.match(htmlContent, /width:\s*100vw;[\s\S]*?height:\s*100vh;/, 'video 必须占满 100vw 和 100vh');
  assert.match(htmlContent, /object-fit:\s*contain;/, 'video 必须保持 contain 宽高比不变形');
  assert.match(htmlContent, /#modal\.is-window-fullscreen\.controls-hidden/, '应该包含 controls-hidden 空闲隐去样式');
  assert.match(htmlContent, /#modal \.modal-controls button#modal-window-fullscreen\.is-active/, '应包含窗口全屏按钮激活高亮样式');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法完整性校验 (含窗口全屏功能)', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 核心算法与状态切换逻辑单元测试 ----------
test('窗口全屏状态切换、文案与阶梯退出算法验证', () => {
  let isWindowFullscreen = false;
  const mockClassList = new Set(['show']);
  const mockBtn = {
    textContent: '🗖 窗口全屏',
    title: '窗口全屏 / 网页全屏 (T)',
    isActive: false,
    classList: {
      toggle(cls, val) {
        if (cls === 'is-active') mockBtn.isActive = !!val;
      }
    }
  };

  function setWindowFullscreen(enable) {
    isWindowFullscreen = !!enable;
    if (isWindowFullscreen) {
      mockClassList.add('is-window-fullscreen');
    } else {
      mockClassList.delete('is-window-fullscreen');
      mockClassList.delete('controls-hidden');
    }
    mockBtn.textContent = isWindowFullscreen ? '🗗 还原' : '🗖 窗口全屏';
    mockBtn.classList.toggle('is-active', isWindowFullscreen);
    mockBtn.title = isWindowFullscreen ? '退出窗口全屏 (T / Esc)' : '窗口全屏 / 网页全屏 (T)';
  }

  function toggleWindowFullscreen() {
    setWindowFullscreen(!isWindowFullscreen);
  }

  // 1. 初始状态
  assert.equal(isWindowFullscreen, false);
  assert.equal(mockBtn.textContent, '🗖 窗口全屏');
  assert.equal(mockBtn.isActive, false);

  // 2. 触发窗口全屏
  toggleWindowFullscreen();
  assert.equal(isWindowFullscreen, true);
  assert.equal(mockClassList.has('is-window-fullscreen'), true);
  assert.equal(mockBtn.textContent, '🗗 还原');
  assert.equal(mockBtn.isActive, true);

  // 3. 再次触发还原
  toggleWindowFullscreen();
  assert.equal(isWindowFullscreen, false);
  assert.equal(mockClassList.has('is-window-fullscreen'), false);
  assert.equal(mockBtn.textContent, '🗖 窗口全屏');
  assert.equal(mockBtn.isActive, false);

  // 4. Esc 阶梯退出测试
  setWindowFullscreen(true);
  assert.equal(isWindowFullscreen, true);

  let modalClosed = false;
  function handleEscapeKey() {
    if (isWindowFullscreen) {
      setWindowFullscreen(false);
      return;
    }
    modalClosed = true;
  }

  // 第一次按 Esc：退出窗口全屏，不关闭 modal
  handleEscapeKey();
  assert.equal(isWindowFullscreen, false, '第一次 Esc 应仅退出窗口全屏');
  assert.equal(modalClosed, false, '第一次 Esc 不应关闭播放器');

  // 第二次按 Esc：关闭 modal
  handleEscapeKey();
  assert.equal(modalClosed, true, '第二次 Esc 应关闭播放器');
});

// ---------- 4. 快捷键与事件绑定校验 ----------
test('index.html 注册了 T 快捷键、Esc 优先退出与双击全屏监听', () => {
  // T 快捷键
  assert.match(htmlContent, /else\s+if\s*\(e\.key\.toLowerCase\(\)\s*===\s*['"]t['"]\)\s*\{\s*e\.preventDefault\(\);\s*toggleWindowFullscreen\(\);/, 'Modal 播放器下按 T 应触发 toggleWindowFullscreen');

  // Esc 阶梯退出
  assert.match(htmlContent, /if\s*\(isWindowFullscreen\)\s*\{\s*e\.preventDefault\(\);\s*setWindowFullscreen\(false\);\s*return;\s*\}\s*closeModal\(\);/, 'Modal 模式下 Esc 应优先退出窗口全屏');

  // 双击视频
  assert.match(htmlContent, /modalVideo\.addEventListener\(['"]dblclick['"],\s*\(e\)\s*=>\s*\{[\s\S]*?toggleWindowFullscreen\(\);?\s*\}\);/, '双击视频应切换窗口全屏');

  // 鼠标移动与空闲防抖
  assert.match(htmlContent, /modal\.addEventListener\(['"]mousemove['"],\s*\(?\)?\s*=>\s*\{[\s\S]*?scheduleWindowFsIdle\(\);?[\s\S]*?\}\);/, '鼠标移动应重置窗口全屏控件淡出计时器');
});
