# 随拾 (SuiShi) · 「🖼 看图」功能 设计与开发报告

> 状态：Sprint A 已落地（扫描 / 分段器 / 图片卡片 / 缩略图管线 / 查看器 / 跨类型翻页 / 拦截 / 星标·重命名·删除打通）；Sprint B（Feed 幻灯、幻灯放映、瀑布流、EXIF、按拍摄时间排序、超大图降级）与 Sprint C 待做。前端可点击原型见 [prototypes/image-browser.html](prototypes/image-browser.html)（在线版：https://claude.ai/artifact/4SpPknJEiUwBBjB4ATiGo9 ，右下角「导览」可跳到 5 个场景，勾选「显示设计标注」看设计说明）。
> 目标：让随拾的抽屉不只装视频，也装照片、截图、表情包——同一套目录、同一套网格、同一套星标 / 重命名 / 删除，再加一个像样的看图器。

---

## 0. 结论先行

| 问题 | 回答 |
| :--- | :--- |
| 能实现吗 | **能，而且纯前端就够**。图片比视频省事得多：`<img>` 直接解码，缩略图用 `createImageBitmap` 一行缩放，不需要离屏 `<video>` 抽帧那一套。 |
| 改动大吗 | **中等**。核心是把 `index.html` 里「视频」这个单一媒体假设放宽为「视频 + 图片」两种 `kind`，其余（目录、扫描、IDB、收藏、重命名、删除、分块渲染）几乎全部复用。新增代码约 900～1100 行（含 CSS），修改现有代码约 60 处。 |
| 会不会把随拾做成相册 | **不会**。定位仍是"抽屉"：默认「全部」混排、按目录分组、按文件名 / 时间 / 大小排序。不做人脸、地点、相簿、编辑；瀑布流只是「仅图片」模式下的一个可选布局。 |
| 与 ROADMAP 红线 | 完全不碰：零依赖、单文件、无后端、无网络。EXIF 解析手写约 120 行（只读 JPEG APP1），不引第三方库。 |
| 怎么分期 | **Sprint A（扫描 + 网格 + 查看器）→ B（Feed 幻灯 + 瀑布流 + EXIF）→ C（收尾 / 测试 / 文档）**，合计 4～5 个工作日。A 做完即可用。 |

---

## 1. 需求拆解

**用户故事**

1. 手机相册备份、旅行照片、聊天截图和 Vlog 素材本来就混在同一个目录里，我希望在随拾里一次看到它们，而不是只看到视频、照片"消失"了。
2. 点开一张图能放大看细节、拖着看、左右翻，翻到视频时自然切成播放器；看完能顺手 ⭐、改名或删掉。
3. 「刷一刷」时照片也能流进来，像看故事一样每张停几秒自动往下，不想让它走就点一下。
4. 遇到 HEIC / RAW / PSD 这种浏览器打不开的格式，别给我黑屏，告诉我怎么回事。

**v1（Sprint A + B）范围（做）**

- 扫描时识别图片格式，与视频并列进入媒体库
- 顶栏「全部 / 🎬 视频 / 🖼 图片」媒体类型分段器，按目录记忆
- 图片卡片：缩略图（IDB 持久缓存）、格式角标、像素尺寸角标、GIF 动图角标、星标
- 图片查看器：与现有 `#modal` 共用外壳；缩放 / 平移 / 旋转 / 适应 / 1:1 / 幻灯放映 / 缩略图条 / 信息面板
- 混合列表中上一张 / 下一张跨媒体类型穿梭
- Feed 模式支持图片幻灯片（定时停留，可暂停）
- 「仅图片」模式下的瀑布流布局
- JPEG EXIF（拍摄时间、相机、镜头、ISO、快门、方向）与「按拍摄时间」排序
- 不可解码格式的拦截提示（复用 MKV 弹窗）
- 星标 / 重命名 / 删除 / 刷新 / 搜索 / 拼音检索对图片全部生效

**v1 明确不做（留到后续或永不做）**

- 任何图片编辑（裁剪、滤镜、标注）
- 人脸 / 场景 / 地点聚合，GPS 读取与地图
- 相簿 / 标签系统（目录分组 + ⭐ 已足够）
- HEIC / RAW 解码（浏览器不支持，做也只能引入几 MB 的 WASM，触红线）
- 动态 GIF / APNG 在网格里自动播放（内存与 CPU 不划算；查看器里原样播放）
- 视频侧的任何行为变化

---

## 2. 现状分析：代码里「视频」假设的分布

`index.html`（6015 行）通篇假设"文件 = 视频"。逐点盘点，标出改动方式：

| 位置 | 现状 | 改动 |
| :--- | :--- | :--- |
| `VIDEO_EXT` / `NATIVE_PLAYABLE`（L2368-2369） | 只有视频扩展名 | 新增 `IMAGE_EXT`、`NATIVE_VIEWABLE`，并加 `kindOf(name)` |
| `isVideoFile()`（L3549） | `walk()` 扫描用它过滤 | 改为 `isMediaFile()`，`walk()` 不变 |
| `allVideos` / `filtered`（L2558-2559） | 元素结构 `{handle,name,path,ext,size,mtime}` | **加 `kind: 'video'|'image'`**；变量名保留（改名会触及上百处，收益低） |
| `loadActiveFolder()`（L3615-3690） | 扫描文案"已找到 N 个视频" | 文案改成"N 个视频 · M 张图片"；`cur.count` 拆为 `cur.videoCount` / `cur.imageCount` |
| `rescanActiveFolder()`（L3692+） | 同上 | 同上 |
| `render()`（L4313-4372） | 搜索 → 目录过滤 → 分组 → 排序 | 在目录过滤前**插入媒体类型过滤**；`stats` 文案改为"N 视频 · M 图片 · 大小" |
| `buildCard()`（L4374-4503） | 时长角标、▶ 进入 Feed、点击 `openModal` | 按 `kind` 分支：图片用像素尺寸角标、🔍 打开查看器、GIF 角标；不可解码走拦截弹窗 |
| `ensureThumbnail()`（L4519-4593） | 离屏 `<video>` 抽帧 320×180 | 按 `kind` 分流：图片走 `createImageBitmap` 管线，写入同一 `thumbnails` 表 |
| `getThumbnailCacheKey()`（L2636） | `folderId:relPath:size:mtime` | 不变（键已足够唯一），缓存值多存 `{w,h}` |
| `openModal()`（L4885-4920） | 直接给 `<video>` 喂 objectURL | 按 `kind` 切换：视频走原逻辑；图片隐藏 `<video>`、显示 `<img>` 舞台 + 工具条 |
| `closeModal()` / `navigate()`（L4938-4958） | 只处理 video | 增加图片舞台清理（revoke、重置 transform、停幻灯） |
| 键盘处理（L5009+） | Modal 内 Space/←→/↑↓/[ ] 等 | 图片模式下改为缩放 / 旋转 / 幻灯键位（见 §4.3） |
| `buildFeedSlide()` / `openFeed()`（L4613 / L4810） | 每个 slide 一个 `<video>` | 图片 slide 用 `<img>` + 停留计时；`activateFeedIndex` 分流 |
| `safeDeleteVideo()`（L3812） | 级联清理收藏 / 缩略图 / 进度 | 逻辑通用，只改函数名注释与文案 |
| `openRenameDialog()`（L3924）+ 弹窗 HTML（L2313） | 标题"重命名视频" | 标题按 `kind` 动态："重命名图片 / 视频" |
| `createFolderItemElement()`（L3279）、tooltip（L2967） | "N 个视频" | "N 视频 · M 图片"，图片用鼠尾草绿圆点 |
| `renderNextChunk()`（L4279） | 分组计数"N 个视频" | "N 视频 · M 图片" |
| `sortGroup()`（L3791） | name / date / size | 新增 `taken`（EXIF 拍摄时间，缺失时回退 mtime） |
| 收藏键 / 进度键（L2684 / L2794） | 基于相对路径 | 不变；断点续播对图片自然不触发 |
| README / ROADMAP / 测试 | 全部围绕视频 | 增加 §、新增 `tests/image_verification.test.mjs` |

**结论**：没有需要重构的"硬骨头"，主要是在 6～7 个函数入口按 `kind` 分流，其余是文案。

---

## 3. 总体设计

### 3.1 格式表

```js
const IMAGE_EXT       = ['jpg','jpeg','png','gif','webp','avif','bmp','svg','ico',
                         'heic','heif','tif','tiff','psd','raw','cr2','cr3','nef','arw','dng'];
const NATIVE_VIEWABLE = ['jpg','jpeg','png','gif','webp','avif','bmp','svg','ico'];  // Chromium 可直接解码
```

- `svg` 用 `<img>` 加载，脚本不会执行，安全；但 `createImageBitmap` 对 SVG 需要显式尺寸，缩略图走 `<img>` 绘制到 canvas 的回退路径。
- `heic/heif` 是手机相册最常见的"打不开"，必须友好拦截而非静默失败。
- `.ico/.bmp` 基本不会出现，保留只为不漏。

### 3.2 数据模型

```js
// allVideos 元素（变量名保留）
{ handle, parentHandle, sidecarHandle, name, path, ext, size, mtime,
  kind: 'video' | 'image',      // 新增
  _thumbPromise, _duration,      // 视频已有
  _w, _h, _exif }                // 图片：像素尺寸、EXIF（懒读，缩略图管线顺带填充）
```

- `thumbnails` 表值：`{ dataUrl, duration?, w?, h?, taken?, cachedAt }`。IDB 版本**不需要升**（无新表、无索引）。
- `kv` 表新增 `mediaMode:<folderId>` → `'all'|'video'|'image'`，以及 `imageLayout:<folderId>` → `'grid'|'masonry'`。
- `savedFolders[i]` 新增 `videoCount` / `imageCount`（旧 `count` 保留为二者之和，兼容已有持久化数据）。

### 3.3 扫描管线

`walk()` 只改过滤函数；`loadActiveFolder()` 的 push 处加 `kind: kindOf(fh.name)`。扫描性能不变——图片和视频一样只读 `getFile()` 拿 size/mtime，不读内容。

### 3.4 媒体类型分段器

顶栏搜索框右侧新增 `全部 N · 🎬 视频 N · 🖼 图片 N` 三段。它和搜索框同级，因为语义相同：都是对**当前抽屉**的过滤，不改变目录、不改变分组。

- 目录只含一种媒体时，分段器仍显示但另两段置灰（避免布局跳动）。
- 选择结果按目录存 `kv`，切回目录时恢复。
- 胶囊栏（`#folder-bar`）与分组计数跟随当前模式重算。
- 「🔀 刷视频」按钮文案跟随：全部→「刷一刷」、视频→「刷视频」、图片→「刷图片」。

### 3.5 卡片

一套 `.card`，两种语义，位置完全对齐：

| 位置 | 视频 | 图片 |
| :--- | :--- | :--- |
| 左上角标 | `MP4`（深灰） | `🖼 JPG`（鼠尾草绿 `--secondary-accent`） |
| 左上角标（不可解码） | `MKV · 需外部播放`（红） | `HEIC · 需外部查看`（红） |
| 右上 | ☆ 星标（hover） | ☆ 星标（hover）；GIF 另加黄色 `GIF 动图` |
| 右下角标 | 时长 `1:24` | 像素尺寸 `4032×3024` |
| 左下 hover | ▶ 从这里进入 Feed | 🔍 从这里开始看图 |
| 缩略图 | 16:9 抽帧，cover | 16:9 cover（瀑布流模式下按原比例） |

hover 边框色：视频焦糖、图片鼠尾草绿。

### 3.6 缩略图管线（图片分支）

```js
async function ensureImageThumbnail(v) {
  // 1. IDB 命中 → 直接返回（同现有）
  // 2. 未命中：
  const file = await v.handle.getFile();
  let bmp;
  try {
    bmp = await createImageBitmap(file, { resizeWidth: 320, resizeQuality: 'medium',
                                          imageOrientation: 'from-image' });   // 自动按 EXIF 方向转正
  } catch { /* SVG / 损坏文件 → 回退 <img> + canvas，仍失败则 null */ }
  // 用 bmp.width/height 与 file 推出原始尺寸：另开一次 createImageBitmap(file) 太贵，
  // 改为从文件头解析 w/h（JPEG SOF / PNG IHDR / WebP VP8X / GIF header，共约 60 行）。
  // 3. canvas 320×180 cover 绘制 → JPEG 0.7 → 写 IDB（附 w, h, taken）
}
```

- **并发闸门**：图片解码比视频 metadata 更容易堆积（一屏 60 张同时进入视口）。引入 4 路信号量，超出排队；滚出视口的排队项延后。视频分支沿用旧逻辑不受影响。
- **尺寸解析**只读文件前 64KB（`file.slice(0, 65536)`），JPEG 找 SOF0/SOF2，PNG 读 IHDR，GIF 读逻辑屏幕，WebP 读 VP8/VP8L/VP8X。这一步同时顺手把 EXIF APP1 解出来（§3.9）。
- `bmp.close()` 释放位图内存。

### 3.7 查看器（与 `#modal` 共用外壳）

不新建第二个弹窗。`#modal` 内并列放 `<video id="modal-video">` 和 `<div id="modal-image-stage"><img></div>`，按 `kind` 显示其一；顶栏按钮（⭐ ✏️ 🗑️ ⛶ ✕ 与 🔗/📝）原样保留，新增「ℹ 信息」。

图片舞台：

- **载入**：`URL.createObjectURL(file)` → `<img decoding="async">`；`img.decode()` 完成后再显示，避免大图闪白。切换时 revoke 上一张。
- **适应策略**：默认「适应窗口」；高宽比 > 2.5 的竖长截图默认「适应宽度」并允许纵向拖动。
- **缩放**：滚轮以光标为中心缩放（步进 1.15），范围 `[fit×0.5, 8×]`；工具条 −/＋ 以画面中心缩放；双击在「适应」与 2× 之间切换。
- **平移**：放大后 Pointer 事件拖拽，`setPointerCapture`，松手不回弹。
- **旋转**：`R` / ↻ 顺时针 90°，只影响本次查看，不写文件。
- **幻灯**：`Space` / ▶ 幻灯，默认每张 4 秒，顶部 3px 焦糖进度条；到最后一张自动停止。遇到视频时不定时，播完 `ended` 事件再走下一张。
- **缩略图条**：底部展示当前位置 ±8 张，点击跳转，当前项焦糖描边；复用 `ensureThumbnail` 缓存，无额外解码。
- **信息面板**：右侧 280px，`I` 切换；文件（名 / 路径 / 类型 / 尺寸+MP / 大小 / 修改时间）+ EXIF（相机 / 镜头 / ISO / 快门 / 拍摄时间）。无 EXIF 时给出解释性文案。
- **预载**：当前图显示后，预取上一张与下一张的 `File`（不解码），翻页只差一次 `decode()`。
- **超大图保护**：像素数 > 40 MP 时（如 8000×5000 全景）不直接给 `<img>` 原图，改为 `createImageBitmap(file, { resizeWidth: 4096 })` 绘到 canvas 展示，1:1 时提示"已按 4096px 缩放显示"。

### 3.8 Feed 幻灯片

`buildFeedSlide()` 按 `kind` 分支。图片 slide：

- 前景 `<img>` contain；背景用同一张缩略图 `blur(40px) brightness(.45)` 铺满，避免竖图两侧死黑（与视频 slide 的纯黑背景形成温和区分）。
- 顶部 3px 白色停留进度条（`--dwell: 5s`）；进入视口时 `activateFeedIndex` 启动计时器，到时 `scrollIntoView` 下一张。
- 点击暂停 / 继续（复用 `.paused` + `pause-icon` 样式）；用户手动滚动立刻 `clearTimeout`。
- HUD 的 🔇 在图片上置灰；🔄 随机顺序照常生效。
- 视频 slide 行为零改动。

### 3.9 EXIF（手写，仅 JPEG）

只解析 APP1 段中 IFD0 / ExifIFD 的 8 个 tag：`Make`、`Model`、`Orientation`、`DateTimeOriginal`、`ExposureTime`、`FNumber`、`ISOSpeedRatings`、`FocalLength`。不解析 GPS IFD（隐私，且无用途）。约 120 行，处理大端 / 小端与偏移越界。PNG / WebP 的 EXIF 块极少见，v1 不做。

排序新增「按拍摄时间」：`taken ?? mtime`。缩略图缓存里已经存了 `taken`，排序无需再读文件；首次进入目录时对未缓存项按 mtime 排，随缩略图生成逐步"就位"（与现有分组渲染兼容，不打断用户）。

### 3.10 瀑布流（仅图片模式）

`.section-grid.masonry { column-width: 210px; column-gap: 16px }` + `.card { break-inside: avoid }`，纯 CSS 多列，不写 JS 布局。代价是列内顺序"先竖后横"，与阅读顺序略不同——这是"仅图片"模式下可接受的取舍，「全部」混排模式不提供瀑布流以保证顺序感。分块渲染（`CHUNK_SIZE = 60`）在多列布局下照常追加。

### 3.11 不可解码格式拦截

复用 `#non-playable-modal`，文案参数化：标题「无法在浏览器中直接查看」、正文「当前图片为 **HEIC** 格式，Chromium 内置解码器不支持。建议用系统「照片」或 XnView 打开，或先转成 JPG。」，「📋 复制相对路径」不变。

---

## 4. 交互规范

### 4.1 顶栏

```
[🔍 搜索…] [全部 23 | 🎬 视频 6 | 🖼 图片 17] [▦ 瀑布流]* [排序 ▾][↑] [☑ 包含子目录] [🔀 刷一刷] [☐ 随机顺序]   [23 / 23 · 6 视频 · 17 图片 · 2.8 GB]
```
`*` 仅图片模式显示。

### 4.2 状态机补充

```
Grid ──click 图片卡片──▶ Modal(image) ──←/→──▶ Modal(video|image)
  │                           │ Space
  │                           ▼
  │                      Slideshow ──到末尾/Esc──▶ Modal(image)
  └──🔀──▶ Feed(video|image slides) ──Esc──▶ Grid
```

### 4.3 快捷键（图片查看器）

| 键 | 动作 |
| :--- | :--- |
| `←` / `→`、`PageUp` / `PageDown` | 上一张 / 下一张（跨媒体类型） |
| `+` / `=`、`-` | 放大 / 缩小 |
| `0` | 适应窗口 |
| `1` | 原始像素 1:1 |
| `R` | 顺时针旋转 90° |
| `I` | 信息面板 |
| `Space` | 幻灯放映 / 暂停 |
| `S` / `F2` / `Delete` / `F` / `Esc` | 收藏 / 重命名 / 删除 / 全屏 / 关闭（与视频一致） |
| 滚轮 / 双击 / 拖拽 | 缩放 / 适应↔2× / 平移 |

视频查看器键位不变；`[` `]` 倍速、`↑↓` 音量仅对视频生效。

### 4.4 Feed（图片 slide）

| 操作 | 动作 |
| :--- | :--- |
| 自动 | 停留 5 s 后滑到下一张 |
| 单击 | 暂停 / 继续停留计时 |
| 滚轮 / 拖动 | 立即取消计时，按用户意图切换 |
| `S` / `F2` / `F` / `Esc` | 同视频 |

---

## 5. 视觉规范

- 媒体类型色：视频 = `--accent #E07A5F`（焦糖），图片 = `--secondary-accent #6B8E7C`（鼠尾草绿，已有 token，此前未大量使用）。只用于角标、分段器高亮、侧栏计数圆点、hover 边框——不引入第三张脸。
- 查看器与 Feed 沿用 `rgba(25,20,18,.92)` 暖黑 + 毛玻璃；工具条为半透明胶囊，与现有 `.modal-controls` 同形。
- 缩略图条、信息面板文字 12.5px，数字 `tabular-nums`。
- 空状态文案由"未发现受支持的视频文件"改为"未发现受支持的视频或图片文件"。

---

## 6. 性能与内存

| 风险 | 对策 |
| :--- | :--- |
| 1000+ 张照片进入视口时集中解码 | 4 路并发闸门 + IDB 缓存；缩略图一律 `resizeWidth: 320` 走 bitmap 缩放，不解码全尺寸 |
| 单张 20～50 MB 的 PNG 截图 / 全景 | > 40 MP 走 4096px 位图降级；`<img>` 用完立即 revoke |
| Feed 里 `<img>` 累积 | 沿用视频 slide 的滑动窗口卸载（当前 ±2 张保留 `src`，其余置空） |
| EXIF / 尺寸解析读文件 | 只 `slice(0, 64KB)`，与缩略图共用一次读取 |
| 瀑布流 reflow | CSS 多列由浏览器布局；分块追加时只在段尾插入 |
| `createImageBitmap` 在旧版 Chromium 不支持 `imageOrientation` | try/catch 回退无选项调用；方向由 EXIF `Orientation` 手动补 `rotate()` |

---

## 7. 边界与错误处理

- **同名 sidecar**：拾光笺只为视频写 `.suishi.json`；图片不查 sidecar（`walk()` 里的映射不受影响）。
- **损坏 / 截断图片**：`createImageBitmap` 抛错 → 卡片保留占位图并显示 `⚠ 无法解码` 角标；查看器显示"这张图无法解码"而非空白。
- **GIF**：缩略图取首帧（bitmap 天然如此）；查看器与 Feed 原样播放；不做逐帧控制。
- **SVG**：`<img>` 沙箱加载，不执行脚本；缩略图走 `<img>` → canvas 回退（需 `naturalWidth` 非 0）。
- **删除 / 重命名**：逻辑完全复用；重命名保留扩展名大小写（`IMG_2041.JPG` 不改成 `.jpg`）。
- **重命名后缓存键失效**：与视频现状一致，重名后重新生成缩略图（可接受）。
- **模式记忆与目录切换**：目录若无图片则强制回到「全部」，避免用户面对空网格。
- **收藏胶囊**：「⭐ 已收藏」计数按当前媒体模式过滤。
- **Feed 起点**：从图片卡片 🔍 进入的是查看器，不是 Feed；Feed 仅由「🔀」按钮或视频卡片 ▶ 进入（避免用户以为点照片会自动开始播放）。

---

## 8. 合规与隐私

不变：无网络、无上传。新增的 EXIF 解析**明确不读 GPS**，信息面板不展示位置。缩略图缓存里也不存 EXIF 原始字节，只存解析后的 5 个字段。

---

## 9. 分期与工作量

| Sprint | 内容 | 预估 |
| :--- | :--- | :--- |
| **A · 基础可用** | 格式表 + `kind`；扫描；分段器 + 文案；图片卡片；`createImageBitmap` 缩略图管线 + 并发闸门；查看器（缩放 / 平移 / 旋转 / 适应 / 1:1 / 缩略图条 / 信息面板-文件部分）；跨类型翻页；拦截弹窗；星标 / 重命名 / 删除打通 | 2 天 |
| **B · 体验补全** | Feed 图片幻灯；查看器幻灯放映；瀑布流；文件头尺寸解析；JPEG EXIF；「按拍摄时间」排序；超大图降级 | 1.5 天 |
| **C · 收尾** | `tests/image_verification.test.mjs`；README §4.9、ROADMAP 更新、快捷键表；侧栏计数 / tooltip / 空状态文案；`version-label` → v1.4 | 0.5～1 天 |

每个 Sprint 结束各一次提交；A 完成后即可日常使用。

---

## 10. 验收清单

- [ ] 混有 jpg/png/webp/gif/heic/mp4/mkv 的目录：全部被扫到，计数正确，分段器数字正确
- [ ] 「图片」模式下网格只剩图片，胶囊栏、分组计数、stats 同步；切目录后模式被记住
- [ ] 1000 张照片目录：首屏 < 1 s 出现占位卡，滚动过程无卡顿，风扇不狂转；二次进入缩略图秒开
- [ ] 竖图 / 全景 / 长截图 / 方形 各自默认适应策略正确；滚轮缩放中心在光标处；拖拽不抖
- [ ] 查看器 ←/→ 跨过视频时切到播放器且能播放，再 → 回到图片
- [ ] EXIF 方向为 6/8 的手机照片，缩略图与查看器均显示正立
- [ ] 幻灯放映到最后一张自动停止；Feed 图片 5 s 自动下滑，点击暂停，手动滚动取消
- [ ] HEIC / PSD 点击弹出拦截提示，复制路径可用
- [ ] 对图片 ⭐ / F2 / Delete 均生效，删除后卡片、收藏、缩略图缓存级联清理
- [ ] 视频侧所有既有测试通过（`npm test`），行为无回归
- [ ] 无外发网络请求（DevTools Network 为空）

---

## 11. 测试计划（`tests/image_verification.test.mjs`）

沿用现有测试风格（读 `index.html` 源码做结构与语法断言，用 `vm` 提取纯函数跑单元测试）：

1. 结构：存在 `IMAGE_EXT` / `NATIVE_VIEWABLE` / `#mode-seg` / `#modal-image-stage` / `#btn-layout`；IDB 版本号不变。
2. `kindOf()`：大小写扩展名、无扩展名、`.suishi.json` sidecar 不被当成媒体。
3. 文件头尺寸解析：构造最小 JPEG SOF0 / PNG IHDR / GIF / WebP 字节数组，断言 w/h。
4. EXIF 解析：构造大端与小端两份 APP1，断言 8 个 tag；越界偏移不抛错返回空。
5. `sortGroup('taken')`：有无 `taken` 混合时回退 mtime 的稳定性。
6. 缩放数学：`zoomAt` 以光标为不动点（前后光标下的图像坐标相等）。
7. 语法：脚本整体可被 `new vm.Script()` 编译。

---

## 12. 与原型的对应

原型（`prototypes/image-browser.html`）用程序生成的占位图模拟 23 个文件，覆盖：混合网格、仅图片 + 瀑布流、查看器（含缩放 / 旋转 / 幻灯 / 信息面板 / 缩略图条）、Feed 图片幻灯、HEIC 拦截。原型里的 7 个标注点对应本文 §3.4、§3.5、§3.7、§3.8。原型未模拟：真实文件读取、IDB 缓存、并发闸门、超大图降级——这些是纯逻辑层，在正式实现中落地。
