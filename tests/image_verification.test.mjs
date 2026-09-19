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
function extractConst(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`).exec(scriptCode);
  assert.ok(m, `内联脚本里应该有常量 ${name}`);
  return `const ${name} = ${m[1]};`;
}
// vm 里造出来的对象原型属于另一个 realm，deepEqual(strict) 会判不等，先拍平再比
const plain = (o) => (o && typeof o === 'object' ? { ...o } : o);
function loadFunctions(names, extraContext = {}) {
  const ctx = vm.createContext({ console, DataView, Uint8Array, ArrayBuffer, Math, String, ...extraContext });
  vm.runInContext(extractConst('VIDEO_EXT') + extractConst('IMAGE_EXT') + extractConst('NATIVE_PLAYABLE') + extractConst('NATIVE_VIEWABLE'), ctx);
  for (const n of names) vm.runInContext(extractFunction(n), ctx);
  return ctx;
}

// ---------- 1. DOM / CSS 结构 ----------
test('HTML 包含看图功能（Sprint A）所需的 DOM 元素与样式', () => {
  for (const id of ['media-seg', 'media-n-all', 'media-n-video', 'media-n-image',
                    'modal-image-stage', 'modal-image', 'modal-info-btn', 'image-tools', 'image-zoom-label',
                    'image-strip', 'image-panel', 'rename-title']) {
    assert.match(htmlContent, new RegExp(`id=["']${id}["']`), `应该存在 #${id}`);
  }
  assert.match(htmlContent, /\.media-seg\s*\{/, '应有媒体类型分段器样式');
  assert.match(htmlContent, /\.ext-badge\.image\s*\{/, '图片角标应有独立配色');
  assert.match(htmlContent, /\.card-open-btn\s*\{/, '图片卡片应有 🔍 打开按钮样式');
  assert.match(htmlContent, /#modal\.is-image \.image-stage\s*\{\s*display:\s*block/, '图片舞台应随 .is-image 显示');
  assert.match(htmlContent, /#modal\.is-image video\s*\{\s*display:\s*none/, '图片模式下 <video> 应隐藏');
  assert.match(htmlContent, /indexedDB\.open\(['"]suishi-video-db['"],\s*4\)/, '看图功能不需要升级 IDB 版本');
});

// ---------- 2. 语法完整性 ----------
test('index.html 内联 JavaScript 语法验证 (看图功能接入后)', () => {
  assert.ok(scriptCode, '必须存在 <script> 标签');
  assert.doesNotThrow(() => new vm.Script(scriptCode, { filename: 'inline-index.js' }));
});

// ---------- 3. 格式识别 ----------
test('kindOf / isMediaFile / isNativeMedia 正确区分视频、图片与不可解码格式', () => {
  const ctx = loadFunctions(['kindOf', 'isMediaFile', 'isImage', 'isNativeMedia']);
  assert.equal(ctx.kindOf('a.MP4'), 'video');
  assert.equal(ctx.kindOf('b.JPG'), 'image');
  assert.equal(ctx.kindOf('c.heic'), 'image');
  assert.equal(ctx.kindOf('d.suishi.json'), null, 'sidecar 不是媒体');
  assert.equal(ctx.kindOf('readme'), null);
  assert.equal(ctx.isMediaFile('x.webp'), true);
  assert.equal(ctx.isMediaFile('x.txt'), false);
  assert.equal(ctx.isNativeMedia({ kind: 'image', ext: 'jpg' }), true);
  assert.equal(ctx.isNativeMedia({ kind: 'image', ext: 'heic' }), false);
  assert.equal(ctx.isNativeMedia({ kind: 'video', ext: 'mkv' }), false);
  assert.equal(ctx.isNativeMedia({ kind: 'video', ext: 'mp4' }), true);
  assert.equal(ctx.isNativeMedia(null), false);
});

// ---------- 4. 文件头尺寸解析 ----------
function jpegWithSOF(w, h, exifOrientation) {
  const bytes = [0xFF, 0xD8];
  if (exifOrientation) {
    // APP1 'Exif\0\0' + 小端 TIFF 头 + 1 个 IFD 条目 (Orientation 0x0112)
    const tiff = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
                  0x01, 0x00,
                  0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, exifOrientation, 0x00, 0x00, 0x00,
                  0x00, 0x00, 0x00, 0x00];
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const len = payload.length + 2;
    bytes.push(0xFF, 0xE1, len >> 8, len & 0xFF, ...payload);
  }
  // 一段 COM 噪声，确保解析器会跳过无关段
  bytes.push(0xFF, 0xFE, 0x00, 0x04, 0x41, 0x42);
  // SOF0：长度 17，精度 8，高，宽，3 分量
  bytes.push(0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 0xFF, w >> 8, w & 0xFF, 0x03, 0,0,0, 0,0,0, 0,0,0);
  bytes.push(0xFF, 0xDA);
  return new Uint8Array(bytes).buffer;
}
function pngIHDR(w, h) {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b.buffer;
}
test('parseImageHeader 只读文件头即可得到 JPEG / PNG / GIF / WebP 的像素尺寸', () => {
  const ctx = loadFunctions(['parseImageHeader']);
  assert.deepEqual(plain(ctx.parseImageHeader(jpegWithSOF(4032, 3024))), { w: 4032, h: 3024 });
  assert.deepEqual(plain(ctx.parseImageHeader(jpegWithSOF(4032, 3024, 1))), { w: 4032, h: 3024 }, 'Orientation=1 不对调');
  assert.deepEqual(plain(ctx.parseImageHeader(jpegWithSOF(4032, 3024, 6))), { w: 3024, h: 4032 }, 'Orientation=6 应对调宽高');
  assert.deepEqual(plain(ctx.parseImageHeader(pngIHDR(1170, 2532))), { w: 1170, h: 2532 });
  const gif = new Uint8Array(32); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xE0, 0x01, 0x40, 0x01]);
  assert.deepEqual(plain(ctx.parseImageHeader(gif.buffer)), { w: 480, h: 320 });
  const webp = new Uint8Array(40);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);   // RIFF....WEBPVP8X
  webp.set([0xFF, 0x03, 0x00, 0x2F, 0x04, 0x00], 24);   // w-1 = 1023, h-1 = 1071
  assert.deepEqual(plain(ctx.parseImageHeader(webp.buffer)), { w: 1024, h: 1072 });
  assert.equal(ctx.parseImageHeader(new Uint8Array(10).buffer), null, '太短的文件返回 null');
  assert.equal(ctx.parseImageHeader(new Uint8Array(64).buffer), null, '未知格式返回 null');
});

// ---------- 5. 统计文案 ----------
test('countByKind / mediaSummary 生成「N 视频 · M 图片」文案', () => {
  const ctx = loadFunctions(['isImage', 'countByKind', 'mediaSummary']);
  const list = [{ kind: 'video' }, { kind: 'image' }, { kind: 'image' }];
  assert.deepEqual(plain(ctx.countByKind(list)), { video: 1, image: 2 });
  assert.equal(ctx.mediaSummary(list), '1 视频 · 2 图片');
  assert.equal(ctx.mediaSummary([{ kind: 'video' }]), '1 视频');
  assert.equal(ctx.mediaSummary([]), '0 个文件');
});

// ---------- 6. 关键接线 ----------
test('扫描、卡片、播放器与 Feed 都按 kind 分流', () => {
  assert.match(scriptCode, /if \(isMediaFile\(entry\.name\)\) files\.push\(entry\);/, 'walk() 应按视频+图片过滤');
  assert.match(scriptCode, /kind: kindOf\(fh\.name\)/, '扫描条目应带 kind');
  assert.match(scriptCode, /createImageBitmap\(file, \{ resizeWidth: 320/, '图片缩略图应走 createImageBitmap 缩放');
  assert.match(scriptCode, /imageOrientation: 'from-image'/, '缩略图应按 EXIF 方向转正');
  assert.match(scriptCode, /const IMAGE_DECODE_LIMIT = 4;/, '图片解码应有并发闸门');
  assert.match(scriptCode, /const videosOnly = filtered\.filter\(v => !isImage\(v\)\);/, 'Feed 暂只接视频');
  assert.match(scriptCode, /while \(next >= 0 && next < filtered\.length && !isNativeMedia\(filtered\[next\]\)\) next \+= delta;/, '翻页应跳过不可解码格式');
  assert.match(scriptCode, /mediaMode:\$\{/, '媒体模式应按目录持久化');
});
