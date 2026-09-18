import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const scriptCode = (htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i) || [])[1] || '';

/** 从内联脚本里按函数名抠出一段源码（花括号配对），在隔离上下文里跑。 */
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

function loadFunctions(names, extraContext = {}) {
  const ctx = vm.createContext({ console, ...extraContext });
  for (const n of names) vm.runInContext(extractFunction(n), ctx);
  return ctx;
}

// ---------- 1. DOM / CSS 结构 ----------
test('HTML 包含下载页与拾光笺联动所需的 DOM 元素', () => {
  for (const id of ['dl-entry', 'dl-status-dot', 'dl-count-badge', 'download-view', 'dl-offline', 'dl-online',
                    'dl-bind-tip', 'dl-url', 'btn-dl-probe', 'dl-probe-card', 'dl-jobs', 'dl-header', 'dl-conn',
                    'btn-dl-retry', 'btn-dl-settings', 'modal-glean', 'modal-source', 'modal-source-line', 'feed-glean']) {
    assert.match(htmlContent, new RegExp(`id=["']${id}["']`), `应该存在 #${id}`);
  }
  assert.match(htmlContent, /#main-wrap\.view-download #download-view\s*\{\s*display:\s*block/, '下载视图应通过 .view-download 切换显示');
  assert.match(htmlContent, /\.source-badge\s*\{/, '应有卡片来源徽标样式');
  assert.match(htmlContent, /\.dl-progress\s*\{/, '应有下载进度条样式');
  assert.match(htmlContent, /<span id="version-label">v1\.3<\/span>/, '版本号应升到 v1.3');
});

// ---------- 2. 语法完整性 ----------
test('index.html 内联 JavaScript 语法校验 (含下载页)', () => {
  assert.ok(scriptCode, '必须存在 <script> 标签');
  assert.doesNotThrow(() => new vm.Script(scriptCode, { filename: 'inline-index.js' }));
});

// ---------- 3. 纯函数 ----------
test('siteOf / basenameOf / stemOf / escapeHtml 行为', () => {
  const ctx = loadFunctions(['siteOf', 'basenameOf', 'stemOf', 'escapeHtml']);
  assert.equal(ctx.siteOf('BiliBili').cls, 'bilibili');
  assert.equal(ctx.siteOf('Douyin').label, '抖音');
  assert.equal(ctx.siteOf('TikTok').cls, 'douyin');
  assert.equal(ctx.siteOf('Youtube').cls, 'youtube');
  assert.equal(ctx.siteOf(undefined).cls, 'other');
  assert.equal(ctx.basenameOf('E:\\download\\随拾下载\\BiliBili\\某UP\\标题 [BV1x].mp4'), '标题 [BV1x].mp4');
  assert.equal(ctx.basenameOf('/a/b/c.mp4'), 'c.mp4');
  assert.equal(ctx.basenameOf(null), '');
  assert.equal(ctx.stemOf('标题 v1.5 [BV1x].mp4'), '标题 v1.5 [BV1x]');
  assert.equal(ctx.stemOf('noext'), 'noext');
  assert.equal(ctx.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

// ---------- 4. walk()：同一趟遍历里把 .suishi.json 挂到同名视频上 ----------
function fakeDir(entries) {
  return {
    kind: 'directory',
    async *values() { for (const e of entries) yield e; },
  };
}
function fakeFile(name) { return { kind: 'file', name }; }

test('walk() 把 sidecar 按同名挂到视频上，并递归子目录', async () => {
  const VIDEO_EXT = ['mp4', 'webm', 'mov'];
  const ctx = loadFunctions(['walk', 'stemOf'], {
    SIDECAR_SUFFIX: '.suishi.json',
    isVideoFile: (n) => VIDEO_EXT.includes(n.split('.').pop().toLowerCase()),
  });
  const sub = fakeDir([fakeFile('b [BV2].mp4'), fakeFile('b [BV2].suishi.json'), fakeFile('readme.txt')]);
  sub.name = 'sub';
  const root = fakeDir([
    fakeFile('a.v1.5 [BV1].suishi.json'),   // sidecar 在视频前面出现也要能配上
    fakeFile('a.v1.5 [BV1].mp4'),
    fakeFile('c.mov'),                      // 没有 sidecar
    fakeFile('c.mov.part'),                 // 半成品，不是视频
    sub,
  ]);
  const out = [];
  for await (const item of ctx.walk(root, '', true)) out.push(item);
  const byName = Object.fromEntries(out.map(o => [o.handle.name, o]));
  assert.deepEqual(Object.keys(byName).sort(), ['a.v1.5 [BV1].mp4', 'b [BV2].mp4', 'c.mov']);
  assert.equal(byName['a.v1.5 [BV1].mp4'].sidecarHandle.name, 'a.v1.5 [BV1].suishi.json');
  assert.equal(byName['c.mov'].sidecarHandle, null);
  assert.equal(byName['b [BV2].mp4'].sidecarHandle.name, 'b [BV2].suishi.json');
  assert.equal(byName['b [BV2].mp4'].path, 'sub');
  assert.equal(byName['b [BV2].mp4'].parentHandle, sub);

  // 不递归时子目录不进
  const flat = [];
  for await (const item of ctx.walk(root, '', false)) flat.push(item.handle.name);
  assert.deepEqual(flat.sort(), ['a.v1.5 [BV1].mp4', 'c.mov']);
});

// ---------- 5. 快捷键与联动挂点 ----------
test('播放器与 Feed 接入了拾光笺按钮、G 快捷键与 sidecar 级联删除', () => {
  assert.match(scriptCode, /e\.key\.toLowerCase\(\) === 'g'[\s\S]{0,80}gleanActionForCurrent\(\)/, 'G 键应触发拾光笺动作');
  assert.equal((scriptCode.match(/gleanActionForCurrent\(\);/g) || []).length >= 2, true, 'Feed 与 Modal 两处都应接 G 键');
  assert.match(scriptCode, /updateModalSource\(v\)/, 'openModal 应刷新来源信息');
  assert.match(scriptCode, /updateFeedSource\(/, 'activateFeedIndex 应刷新来源信息');
  assert.match(scriptCode, /removeEntry\(v\.sidecarHandle\.name\)/, '删除视频时应级联删除 sidecar');
  assert.match(scriptCode, /idbGet\('downloadFolderId'\)/, '下载目录绑定应从 IDB 恢复');
  assert.match(scriptCode, /\/api\/downloads\/events\?after=/, '应订阅拾光笺聚合事件流');
  assert.match(scriptCode, /^\s*const GLEAN_DEFAULT_BASE = 'http:\/\/127\.0\.0\.1:7860';/m, '默认拾光笺地址应为本机 7860');
  // 只接受本机地址：不允许把随拾指向外网服务
  assert.match(scriptCode, /localhost\|127\\\.0\\\.0\\\.1/, '连接设置应校验为本机地址');
});

// ---------- 6. 视图路由与目录切换返回 ----------
test('在下载页点击已添加文件夹或调用 switchFolder 时切回 library 视图', () => {
  assert.match(
    scriptCode,
    /item\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*currentView\s*!==\s*['"]library['"]\s*\)\s*\{[\s\S]*?showView\(['"]library['"]\)/,
    'renderSidebar 点击目录项时若在下载页应切回 library'
  );
  assert.match(
    scriptCode,
    /async\s+function\s+switchFolder\([\s\S]*?if\s*\(\s*currentView\s*!==\s*['"]library['"]\s*\)\s*\{\s*showView\(['"]library['"]\);?\s*\}/,
    'switchFolder 函数内部应在 currentView !== library 时自动切换回 library'
  );
  assert.match(
    scriptCode,
    /async\s+function\s+addNewFolder\([\s\S]*?if\s*\(\s*currentView\s*!==\s*['"]library['"]\s*\)\s*\{\s*showView\(['"]library['"]\);?\s*\}/,
    'addNewFolder 添加新目录后应切回 library 视图'
  );
});

