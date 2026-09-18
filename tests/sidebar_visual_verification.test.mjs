import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 DOM 与 HTML 结构 ----------
test('HTML 包含侧边栏三大模块清晰分界线与折叠态 Logo DOM 元素', () => {
  // 必须存在 .sidebar-divider 分割线
  assert.match(htmlContent, /class=["']sidebar-divider["']/, '应该存在 .sidebar-divider 分割线');
  
  // 验证分割线位置关系：位于添加目录和下载入口之间、下载入口和已收藏目录之间
  const addWrapIdx = htmlContent.indexOf('class="sidebar-add-wrap"');
  const dlWrapIdx = htmlContent.indexOf('class="sidebar-dl-wrap"');
  const navTitleIdx = htmlContent.indexOf('class="sidebar-nav-title"');
  
  assert.ok(addWrapIdx > 0, '应该存在 .sidebar-add-wrap');
  assert.ok(dlWrapIdx > addWrapIdx, '下载入口应在添加目录之后');
  assert.ok(navTitleIdx > dlWrapIdx, '已收藏目录标题应在下载入口之后');

  const divider1Idx = htmlContent.indexOf('class="sidebar-divider"', addWrapIdx);
  assert.ok(divider1Idx > addWrapIdx && divider1Idx < dlWrapIdx, '第一条分割线应位于添加目录与下载入口之间');

  const divider2Idx = htmlContent.indexOf('class="sidebar-divider"', dlWrapIdx);
  assert.ok(divider2Idx > dlWrapIdx && divider2Idx < navTitleIdx, '第二条分割线应位于下载入口与已收藏目录之间');

  // 必须包含 #btn-toggle-sidebar 内部的网站 Logo 与折叠图标
  assert.match(htmlContent, /class=["'][^"']*sidebar-toggle-icon[^"']*["']/, '折叠按钮内应包含 .sidebar-toggle-icon');
  assert.match(htmlContent, /class=["'][^"']*sidebar-collapsed-logo[^"']*["']/, '折叠按钮内应包含 .sidebar-collapsed-logo');
  assert.match(htmlContent, /<div class=["']brand-logo sidebar-collapsed-logo["']>📼<\/div>/, 'Logo 容器应承载经典的 📼 品牌标识');
});

// ---------- 2. 验证 CSS 样式规则 ----------
test('CSS 包含分界线与 Logo 显隐切换的完整样式规范', () => {
  // 分界线基础与折叠态样式
  assert.match(htmlContent, /\.sidebar-divider\s*\{[\s\S]*?height:\s*1px;/, '应定义 .sidebar-divider 高度');
  assert.match(htmlContent, /#sidebar\.collapsed\s+\.sidebar-divider\s*\{[\s\S]*?background:\s*var\(--border\);/, '折叠态下分界线应具备清晰可见的边框色彩');

  // 折叠与展开下的 Logo 与图标互斥显示
  assert.match(htmlContent, /\.sidebar-collapsed-logo\s*\{[\s\S]*?display:\s*none;/, '展开态下应默认隐藏收起时的 Logo');
  assert.match(htmlContent, /#sidebar\.collapsed\s+\.sidebar-toggle-icon\s*\{[\s\S]*?display:\s*none\s*!important;/, '折叠态下应隐藏原侧边栏图标');
  assert.match(htmlContent, /#sidebar\.collapsed\s+\.sidebar-collapsed-logo\s*\{[\s\S]*?display:\s*flex\s*!important;/, '折叠态下应激活展示网站 Logo');

  // 折叠态下添加按钮与下载按钮规整卡片化
  assert.match(htmlContent, /#sidebar\.collapsed\s+\.btn-add-folder\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/, '折叠态下添加按钮应为 40x40 规整尺寸');
  assert.match(htmlContent, /#sidebar\.collapsed\s+#dl-entry\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/, '折叠态下下载入口应为 40x40 规整卡片');
});

// ---------- 3. 验证 JavaScript 语法完整性与标题联动 ----------
test('index.html 内联 JavaScript 语法完整性校验 (含折叠提示文案联动)', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');

  assert.match(code, /function updateSidebarToggleTitle\(\)/, '应包含 updateSidebarToggleTitle 标题动态联动函数');
  assert.match(code, /展开侧边栏 \(Ctrl\+B\)/, '折叠时应提示展开侧边栏');
  assert.match(code, /折叠侧边栏 \(Ctrl\+B\)/, '展开时应提示折叠侧边栏');
});
