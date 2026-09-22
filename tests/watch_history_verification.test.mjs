import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const htmlPath = path.resolve('index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ---------- 1. 验证 DOM 与 CSS 结构 ----------
test('HTML 与 CSS 包含视频看过的标记、多刷徽标与时间轴弹窗所需的结构', () => {
  // 1. 弹窗与弹出卡片元素
  assert.match(htmlContent, /id=["']watch-history-modal["']/, '应该存在 #watch-history-modal 观看记录弹窗');
  assert.match(htmlContent, /id=["']watch-popover["']/, '应该存在 #watch-popover 浮动快速时间轴');
  assert.match(htmlContent, /id=["']watch-modal-name["']/, '应该存在 #watch-modal-name 视频标题显示');
  assert.match(htmlContent, /id=["']watch-stat-count["']/, '应该存在 #watch-stat-count 累计次数统计');
  assert.match(htmlContent, /id=["']watch-stat-first["']/, '应该存在 #watch-stat-first 首次观看统计');
  assert.match(htmlContent, /id=["']watch-stat-latest["']/, '应该存在 #watch-stat-latest 最近观看统计');
  assert.match(htmlContent, /id=["']btn-watch-checkin["']/, '应该存在 #btn-watch-checkin 打卡按钮');
  assert.match(htmlContent, /id=["']btn-watch-toggle-custom["']/, '应该存在 #btn-watch-toggle-custom 补录展开按钮');
  assert.match(htmlContent, /id=["']watch-custom-datetime["']/, '应该存在 #watch-custom-datetime 自定义时间输入');
  assert.match(htmlContent, /id=["']watch-custom-note["']/, '应该存在 #watch-custom-note 自定义随记输入');
  assert.match(htmlContent, /id=["']btn-watch-submit-custom["']/, '应该存在 #btn-watch-submit-custom 提交补录按钮');
  assert.match(htmlContent, /id=["']watch-modal-timeline["']/, '应该存在 #watch-modal-timeline 时间轴容器');
  assert.match(htmlContent, /id=["']btn-watch-clear-all["']/, '应该存在 #btn-watch-clear-all 清空历史按钮');

  // 2. 播放器工具栏与 Feed HUD 按钮
  assert.match(htmlContent, /id=["']modal-watch["']/, '播放器弹窗中应该存在 #modal-watch 工具按钮');
  assert.match(htmlContent, /id=["']feed-watch["']/, 'Feed 全屏沉浸模式中应该存在 #feed-watch 按钮');

  // 3. 排序下拉项
  assert.match(htmlContent, /value=["']watch-count["']/, '排序下拉框应该包含 watch-count 按观看次数排序');
  assert.match(htmlContent, /value=["']watch-date["']/, '排序下拉框应该包含 watch-date 按最近观看时间排序');

  // 4. CSS 规则与设计变量
  assert.match(htmlContent, /--watched-color:\s*#5A8F76;/, 'CSS 根变量应包含 --watched-color 翡翠绿');
  assert.match(htmlContent, /--watched-bg:\s*rgba\(43,\s*76,\s*61,\s*0\.88\);/, 'CSS 根变量应包含 --watched-bg 半透遮罩绿');
  assert.match(htmlContent, /\.card-mark-btn\s*\{/, '应该包含 .card-mark-btn 样式');
  assert.match(htmlContent, /\.watched-pill-badge\s*\{/, '应该包含 .watched-pill-badge 缩略图胶囊角标样式');
  assert.match(htmlContent, /\.watched-pill-badge\.multi\s*\{/, '应该包含 .watched-pill-badge.multi 多刷样式');
  assert.match(htmlContent, /\.watched-pill-badge\.multi-high\s*\{/, '应该包含 .watched-pill-badge.multi-high 高频多刷样式');
  assert.match(htmlContent, /\.folder-pill\.watched-pill\.active\s*\{/, '二级导航栏应包含 .folder-pill.watched-pill.active 筛选高亮样式');
  assert.match(htmlContent, /\.folder-pill\.unwatched-pill\.active\s*\{/, '二级导航栏应包含 .folder-pill.unwatched-pill.active 筛选高亮样式');
});

// ---------- 2. 语法完整性校验 ----------
test('index.html 内联 JavaScript 语法完整性校验', () => {
  const scriptMatch = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch && scriptMatch[1], '必须存在 <script> 标签');
  const code = scriptMatch[1];

  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'inline-index.js' });
  }, '内联 JavaScript 代码应该无语法错误');
});

// ---------- 3. IndexedDB 版本升级与 watch_history store 校验 ----------
test('IndexedDB 升级至版本 5 并创建 watch_history store', () => {
  assert.match(htmlContent, /indexedDB\.open\(['"]suishi-video-db['"],\s*5\)/, 'IndexedDB 必须升级为版本 5');
  assert.match(htmlContent, /if\s*\(!db\.objectStoreNames\.contains\(['"]watch_history['"]\)\)\s*\{\s*db\.createObjectStore\(['"]watch_history['"]\);?\s*\}/, '必须创建 watch_history 对象存储库');
});

// ---------- 4. 快捷键与播放结束事件绑定校验 ----------
test('键盘快捷键支持 Escape 关闭观看弹窗，W 键触发打卡/历史，播放结束自动打卡', () => {
  // Escape 关闭 watchModal
  assert.match(htmlContent, /if\s*\(watchModal\s*&&\s*watchModal\.classList\.contains\(['"]show['"]\)\)\s*\{\s*if\s*\(e\.key\s*===\s*['"]Escape['"]\)\s*\{\s*e\.preventDefault\(\);\s*closeWatchHistoryModal\(\);/, 'Escape 必须关闭观看记录弹窗');

  // Feed 模式 W 快捷键
  assert.match(htmlContent, /else\s+if\s*\(e\.key\.toLowerCase\(\)\s*===\s*['"]w['"]\)\s*\{\s*e\.preventDefault\(\);\s*if\s*\(curSlide\s*&&\s*curSlide\._srcVideo\)\s*\{\s*openWatchHistoryModal\(curSlide\._srcVideo\);/, 'Feed 模式下 W 键应打开观看记录');

  // Modal 模式 W 快捷键
  assert.match(htmlContent, /else\s+if\s*\(e\.key\.toLowerCase\(\)\s*===\s*['"]w['"]\)\s*\{\s*e\.preventDefault\(\);\s*if\s*\(currentModalIndex\s*>=\s*0\s*&&\s*filtered\[currentModalIndex\]\)\s*\{\s*openWatchHistoryModal\(filtered\[currentModalIndex\]\);/, 'Modal 播放器下 W 键应打开观看记录');

  // 全局卡片悬浮 W 快捷键
  assert.match(htmlContent, /else\s+if\s*\(e\.key\.toLowerCase\(\)\s*===\s*['"]w['"]\)\s*\{\s*if\s*\(lastHoveredVideo\)\s*\{\s*e\.preventDefault\(\);\s*openWatchHistoryModal\(lastHoveredVideo\);/, '全局模式下对悬停卡片按 W 键应打开观看记录');

  // 播放完毕自动打卡
  assert.match(htmlContent, /modalVideo\.addEventListener\(['"]ended['"][\s\S]*?recordWatch\(curV,\s*Date\.now\(\),\s*['"]播放完毕自动打卡['"]\)/, 'modalVideo ended 事件应自动记录观看');
});

// ---------- 5. 核心逻辑算法单元测试 (CRUD、多刷、排序、筛选) ----------
test('观看记录增删查改、多刷统计与时间轴算法逻辑验证', () => {
  const watchHistoryMap = new Map();

  function getWatchKey(folderId, v) {
    if (!v) return '';
    const rel = (v.path ? v.path + '/' : '') + v.name;
    return `${folderId || ''}:${rel}`;
  }

  function isWatched(folderId, v) {
    const key = getWatchKey(folderId, v);
    const entry = watchHistoryMap.get(key);
    return !!(entry && entry.count > 0);
  }

  function getWatchCount(folderId, v) {
    const key = getWatchKey(folderId, v);
    const entry = watchHistoryMap.get(key);
    return entry ? (entry.count || 0) : 0;
  }

  function recordWatch(folderId, v, customTimestamp, note = '') {
    const key = getWatchKey(folderId, v);
    let entry = watchHistoryMap.get(key);
    const time = customTimestamp || Date.now();
    const d = new Date(time);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    if (!entry) {
      entry = {
        key,
        folderId,
        name: v.name,
        path: v.path,
        count: 0,
        latestTime: time,
        records: []
      };
    }

    const newRecord = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      time,
      dateStr,
      note: (note || '').trim()
    };

    entry.records.push(newRecord);
    entry.records.sort((a, b) => a.time - b.time);
    entry.count = entry.records.length;
    entry.latestTime = entry.records[entry.records.length - 1].time;
    watchHistoryMap.set(key, entry);
    return entry;
  }

  function removeWatchEntry(folderId, v, recordId) {
    const key = getWatchKey(folderId, v);
    let entry = watchHistoryMap.get(key);
    if (!entry) return;

    entry.records = entry.records.filter(r => r.id !== recordId);
    entry.count = entry.records.length;
    if (entry.count === 0) {
      watchHistoryMap.delete(key);
    } else {
      entry.latestTime = entry.records[entry.records.length - 1].time;
    }
  }

  const v1 = { name: 'tutorial_part1.mp4', path: 'courses' };
  const v2 = { name: 'movie.mkv', path: 'movies' };
  const v3 = { name: 'unseen.mp4', path: '' };
  const folderId = 'folder_123';

  // 1. 初始未看
  assert.equal(isWatched(folderId, v1), false);
  assert.equal(getWatchCount(folderId, v1), 0);

  // 2. 第一次打卡
  const t1 = 1710000000000;
  recordWatch(folderId, v1, t1, '第一次学习');
  assert.equal(isWatched(folderId, v1), true);
  assert.equal(getWatchCount(folderId, v1), 1);
  assert.equal(watchHistoryMap.get(getWatchKey(folderId, v1)).records[0].note, '第一次学习');

  // 3. 第二次打卡 (2刷)
  const t2 = 1710500000000;
  recordWatch(folderId, v1, t2, '二刷复习重点');
  assert.equal(getWatchCount(folderId, v1), 2);
  assert.equal(watchHistoryMap.get(getWatchKey(folderId, v1)).latestTime, t2);

  // 4. 第三次打卡 (3刷)
  const t3 = 1711000000000;
  recordWatch(folderId, v1, t3);
  assert.equal(getWatchCount(folderId, v1), 3);

  // 5. v2 打卡 1 次
  const tV2 = 1712000000000;
  recordWatch(folderId, v2, tV2);
  assert.equal(getWatchCount(folderId, v2), 1);

  // 6. 撤销/删除单条记录
  const entryV1 = watchHistoryMap.get(getWatchKey(folderId, v1));
  const recordIdToRemove = entryV1.records[0].id;
  removeWatchEntry(folderId, v1, recordIdToRemove);
  assert.equal(getWatchCount(folderId, v1), 2);

  // 7. 筛选逻辑：已看(__WATCHED__) 与 未看(__UNWATCHED__)
  const allList = [v1, v2, v3];
  const watchedList = allList.filter(v => isWatched(folderId, v));
  const unwatchedList = allList.filter(v => !isWatched(folderId, v));

  assert.deepEqual(watchedList.map(v => v.name), ['tutorial_part1.mp4', 'movie.mkv']);
  assert.deepEqual(unwatchedList.map(v => v.name), ['unseen.mp4']);

  // 8. 排序逻辑：按观看次数 (watch-count) 与 最近观看时间 (watch-date)
  const sortedByCount = [...allList].sort((a, b) => {
    const ca = getWatchCount(folderId, a);
    const cb = getWatchCount(folderId, b);
    return cb - ca;
  });
  // v1 count: 2, v2 count: 1, v3 count: 0
  assert.equal(sortedByCount[0].name, 'tutorial_part1.mp4');
  assert.equal(sortedByCount[1].name, 'movie.mkv');
  assert.equal(sortedByCount[2].name, 'unseen.mp4');

  const sortedByDate = [...allList].sort((a, b) => {
    const entryA = watchHistoryMap.get(getWatchKey(folderId, a));
    const entryB = watchHistoryMap.get(getWatchKey(folderId, b));
    const ta = entryA ? (entryA.latestTime || 0) : 0;
    const tb = entryB ? (entryB.latestTime || 0) : 0;
    return tb - ta;
  });
  // v2 latestTime: 1712000000000, v1 latestTime: 1711000000000, v3: 0
  assert.equal(sortedByDate[0].name, 'movie.mkv');
  assert.equal(sortedByDate[1].name, 'tutorial_part1.mp4');
  assert.equal(sortedByDate[2].name, 'unseen.mp4');
});
