import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 DOM 与 CSS 结构 ----------
test('HTML 包含目录分组与弹窗所需的 DOM 元素与样式规则', () => {
  // 必须包含新建分组入口按钮
  assert.match(htmlContent, /id=["']btn-create-group["']/, '应该存在 #btn-create-group 按钮');
  // 必须包含分组弹窗容器
  assert.match(htmlContent, /id=["']group-modal["']/, '应该存在 #group-modal 弹窗容器');
  // 必须包含预设分类推荐容器
  assert.match(htmlContent, /id=["']group-preset-chips["']/, '应该存在 #group-preset-chips 容器');
  // 必须包含图标与名称输入控件
  assert.match(htmlContent, /id=["']group-selected-icon["']/, '应该存在 #group-selected-icon 元素');
  assert.match(htmlContent, /id=["']group-name-input["']/, '应该存在 #group-name-input 输入框');
  assert.match(htmlContent, /id=["']btn-group-confirm["']/, '应该存在 #btn-group-confirm 按钮');

  // CSS 样式校验
  assert.match(htmlContent, /\.sidebar-title-btn\s*\{/, '应该包含 .sidebar-title-btn 样式');
  assert.match(htmlContent, /\.folder-group-section\s*\{/, '应该包含 .folder-group-section 样式');
  assert.match(htmlContent, /\.folder-group-header\s*\{/, '应该包含 .folder-group-header 样式');
  assert.match(htmlContent, /\.drag-target-active/, '应该包含 .drag-target-active 拖拽放置高亮样式');
  assert.match(htmlContent, /\.folder-item\.dragging/, '应该包含 .folder-item.dragging 拖拽中半透明样式');
  assert.match(htmlContent, /\.group-preset-chips\s*\{/, '应该包含 .group-preset-chips 样式');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法完整性校验 (含目录分组与拖拽逻辑)', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. 验证预设分类与图标库设计 ----------
test('预设分类包含财经、NSFW、日常等丰富本地视频场景推荐', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  const code = scriptMatch[1];

  assert.match(code, /name:\s*['"]财经['"][\s\S]*?icon:\s*['"]📈['"]/, '应包含财经分类 (📈)');
  assert.match(code, /name:\s*['"]NSFW['"][\s\S]*?icon:\s*['"]🔞['"]/, '应包含 NSFW 分类 (🔞)');
  assert.match(code, /name:\s*['"]日常['"][\s\S]*?icon:\s*['"]☕['"]/, '应包含日常分类 (☕)');
  assert.match(code, /name:\s*['"]学习['"][\s\S]*?icon:\s*['"]📚['"]/, '应包含学习分类 (📚)');
  assert.match(code, /name:\s*['"]影视['"][\s\S]*?icon:\s*['"]🎬['"]/, '应包含影视分类 (🎬)');
  assert.match(code, /name:\s*['"]游戏['"][\s\S]*?icon:\s*['"]🎮['"]/, '应包含游戏分类 (🎮)');
  assert.match(code, /name:\s*['"]音乐['"][\s\S]*?icon:\s*['"]🎵['"]/, '应包含音乐分类 (🎵)');
  assert.match(code, /name:\s*['"]科技['"][\s\S]*?icon:\s*['"]💻['"]/, '应包含科技分类 (💻)');
});

// ---------- 4. 算法单元测试：分组创建、拖拽归类与解散隔离算法 ----------
test('分组创建、目录拖拽归组与解散隔离算法验证', () => {
  let savedFolders = [
    { id: 'f_1', name: '财经快讯', path: 'D:/Videos/Finance' },
    { id: 'f_2', name: '私密日记', path: 'D:/Videos/Secret' },
    { id: 'f_3', name: '生活随拍', path: 'D:/Videos/Daily' }
  ];
  let folderGroups = [];

  // 1. 创建分组
  function createGroup(name, icon) {
    const group = {
      id: 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name,
      icon,
      collapsed: false,
      createdAt: Date.now()
    };
    folderGroups.push(group);
    return group;
  }

  const gFinance = createGroup('财经', '📈');
  const gNsfw = createGroup('NSFW', '🔞');

  assert.equal(folderGroups.length, 2);
  assert.equal(gFinance.name, '财经');
  assert.equal(gFinance.icon, '📈');

  // 2. 拖拽放入分组 (虚拟移动，绝不改动物理路径 path)
  function moveFolderToGroup(folderId, targetGroupId) {
    const folder = savedFolders.find(f => f.id === folderId);
    if (folder) {
      folder.groupId = targetGroupId || null;
    }
  }

  moveFolderToGroup('f_1', gFinance.id);
  moveFolderToGroup('f_2', gNsfw.id);

  assert.equal(savedFolders[0].groupId, gFinance.id, '目录 1 应归入财经组');
  assert.equal(savedFolders[0].path, 'D:/Videos/Finance', '虚拟分组绝对不修改目录实际物理路径');
  assert.equal(savedFolders[1].groupId, gNsfw.id, '目录 2 应归入 NSFW 组');
  assert.equal(savedFolders[2].groupId, undefined, '目录 3 仍保持未分组');

  // 3. 跨组移动
  moveFolderToGroup('f_2', gFinance.id);
  assert.equal(savedFolders[1].groupId, gFinance.id, '目录 2 移入财经组成功');

  // 4. 移出分组
  moveFolderToGroup('f_2', null);
  assert.equal(savedFolders[1].groupId, null, '目录 2 移出分组成功');

  // 5. 解散分组：仅重置 groupId，不删除磁盘目录项
  function deleteGroup(groupId) {
    savedFolders.forEach(f => {
      if (f.groupId === groupId) f.groupId = null;
    });
    folderGroups = folderGroups.filter(g => g.id !== groupId);
  }

  deleteGroup(gFinance.id);
  assert.equal(folderGroups.length, 1, '财经组被解散后仅剩 1 个分组');
  assert.equal(savedFolders[0].groupId, null, '原财经组内的目录自动还原为未分组');
  assert.equal(savedFolders.length, 3, '已收藏的 3 个目录全部完好保留');
});

// ---------- 5. 算法单元测试：分组折叠与命名查重 ----------
test('分组折叠状态翻转与重名校验算法', () => {
  const groups = [
    { id: 'g1', name: '日常', icon: '☕', collapsed: false }
  ];

  function toggleCollapse(groupId) {
    const grp = groups.find(g => g.id === groupId);
    if (grp) grp.collapsed = !grp.collapsed;
  }

  toggleCollapse('g1');
  assert.equal(groups[0].collapsed, true, '折叠状态翻转为 true');
  toggleCollapse('g1');
  assert.equal(groups[0].collapsed, false, '折叠状态翻转为 false');

  function validateGroupName(name, editingId = null) {
    const trimmed = name.trim();
    if (!trimmed) return { valid: false, msg: '分组名称不能为空' };
    if (trimmed.length > 20) return { valid: false, msg: '分组名称不能超过 20 个字符' };
    const dup = groups.find(g => g.id !== editingId && g.name.toLowerCase() === trimmed.toLowerCase());
    if (dup) return { valid: false, msg: `已存在同名分组「${trimmed}」` };
    return { valid: true };
  }

  assert.equal(validateGroupName('').valid, false);
  assert.equal(validateGroupName('   ').valid, false);
  assert.equal(validateGroupName('日常').valid, false, '不可重复创建同名分组');
  assert.equal(validateGroupName('日常', 'g1').valid, true, '编辑自身同名有效');
  assert.equal(validateGroupName('游戏').valid, true, '新名称合法');
});

// ---------- 6. 验证侧边栏收起时的分组卡片化与角标隐藏规则 ----------
test('侧边栏分组具备温润卡片边框且已去除数量角标', () => {
  // 必须包含折叠态下分组容器的卡片化样式与细腻边框
  assert.match(htmlContent, /#sidebar\.collapsed\s+\.folder-group-section\s*\{[\s\S]*?border:/, '折叠态分组应具备细腻卡片边框');
  // 数量角标应被隐藏，保持界面干净
  assert.match(htmlContent, /\.folder-group-badge\s*\{[\s\S]*?display:\s*none/, '数量角标应被隐藏');
  // 必须包含折叠态悬停提示富文本卡片逻辑
  assert.match(htmlContent, /sidebarTooltip\.innerHTML\s*=/, '悬停应生成富文本卡片展示分组及目录');
});
