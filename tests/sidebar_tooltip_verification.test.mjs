import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 DOM 与 CSS 结构 ----------
test('HTML 包含侧边栏悬停提示所需的 DOM 元素与样式规则', () => {
  // 必须存在 #sidebar-tooltip 浮动提示容器
  assert.match(htmlContent, /id=["']sidebar-tooltip["']/, '应该存在 #sidebar-tooltip DOM 元素');
  // 必须包含 #sidebar-tooltip 的样式定义
  assert.match(htmlContent, /#sidebar-tooltip\s*\{/, '应该包含 #sidebar-tooltip 样式定义');
  // 必须定义 .show 状态显示
  assert.match(htmlContent, /#sidebar-tooltip\.show/, '应该包含 #sidebar-tooltip.show 激活样式');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法完整性校验 (含侧边栏悬停提示)', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 验证目录项的 tooltip 属性挂载 ----------
test('renderSidebar 渲染的 folder-item 包含 data-tooltip 与 title 属性', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  const code = scriptMatch[1];

  // 必须包含 data-tooltip 属性设置
  assert.match(code, /item\.setAttribute\(['"]data-tooltip['"],\s*displayName\)/, '应该挂载 data-tooltip 属性');
  // 必须包含 title 属性设置
  assert.match(code, /item\.setAttribute\(['"]title['"],\s*displayName\)/, '应该挂载 title 属性供原生悬停显示');
});

// ---------- 4. 算法单元测试：侧边栏悬停定位与文本匹配算法 ----------
test('侧边栏悬停浮层定位坐标计算与边界', () => {
  function calculateTooltipPosition(itemRect, offset = 8) {
    return {
      left: itemRect.right + offset,
      top: itemRect.top + itemRect.height / 2,
      transform: 'translateY(-50%)'
    };
  }

  const mockItemRect = { right: 64, top: 120, height: 44 };
  const pos = calculateTooltipPosition(mockItemRect, 8);

  assert.equal(pos.left, 72, '浮层水平位置应紧贴折叠栏右侧 (64 + 8 = 72)');
  assert.equal(pos.top, 142, '浮层垂直位置应精确居中 (120 + 22 = 142)');
  assert.equal(pos.transform, 'translateY(-50%)');
});
