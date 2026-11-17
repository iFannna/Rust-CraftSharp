# 皮肤页与物品栏皮肤区域

## 目标

按老项目 `windows/settings/panels/skin/SkinPanel.xaml` 的结构重做设置面板「皮肤」页，视觉走现有 shadcn 中性风；物品栏的玩家预览接同一套皮肤数据。

## 页面

- 顶部卡片：Steve、Alex、上传材质三个分段按钮，右侧搜索框。
- 左下卡片：卡片网格。上传皮肤在前，内置皮肤在后，都按名称排序；每张卡片是同一皮肤的背面与正面并排渲染图，左背右正，下附名称；选中用 primary 描边。
- 右下卡片：正交相机皮肤预览，左键拖拽旋转，滚轮缩放，静态待机姿态，不改配置。
- 头像卡片即设为当前皮肤；标签切换只换预览，不写配置。
- 搜索按名称过滤当前标签。
- Steve = wide，Alex = slim；上传的皮肤按类型进入对应标签。
- 右键菜单：设置为当前皮肤；上传皮肤另有重命名、移除；当前皮肤的「设置为当前」隐藏，内置皮肤只有设置项。
- 移除当前皮肤后回退内置 Alex wide，与老项目一致。
- 上传成功后立即设为当前皮肤并切到对应标签。

## 缩略图

- 一次性离屏渲染：左侧背面、右侧正面，各偏转 40°；相机在正面偏上 35°，正交相机宽 42，静态默认站姿不叠加待机动画，300×300 导出 data URL，按皮肤缓存。
- 卡片只放 img，不挂实时 WebGL；切换标签补烘缺失项，上传后只补新皮肤。
- 三维模块按需加载，其他设置页首开不加载 three；只取玩家模型与 idle 动画，不经过全量实体注册表。

## 存储

- 上传皮肤存 `app_config_dir()/skins/{wide|slim}/<名称>.png`，名称即文件名，类型即目录。
- 当前皮肤沿用 `player.skinPath`、`player.skinType`、`player.skinName`，不新增字段，旧配置可读。
- Rust 命令：`list_skins`、`import_skin`、`rename_skin`、`remove_skin`。
- 导入校验：名称非空、不超过 32 字符、只允许字母数字下划线横杠空格；PNG 签名；宽高必须 64x64，64x32 明确拒绝；base64 上限；同名拒绝。
- 重命名只改文件名；删除失败给提示。

## 文件

```
settings/sections/skinSection.tsx
settings/skin/skinGrid.tsx
settings/skin/skinPreview.tsx
settings/skin/skinModal.tsx
settings/skin/uploadSkinDialog.tsx
settings/skin/skinDialogs.tsx
settings/skin/skinLibrary.ts
settings/skin/skinScene.ts
src-tauri/src/skins.rs
```

## 范围外

- 3D 预览窗口保持原样，不受皮肤页影响。
- 调试页导航保留，皮肤三行迁走后只留「打开 3D 预览」。
- 托盘菜单移除「3D 预览」，前端动作表同步删除。
- 物品栏的离屏渲染、合成、头部跟随契约不改，只验证新皮肤路径能即时生效。

## 进度

- [x] Rust 皮肤库与单测
- [x] 3D 场景模块
- [x] 皮肤页与弹窗
- [x] 导航、文案、调试页
- [x] 构建与验证

## 验证记录

- `cargo test`：20 通过，含皮肤 8 项。
- `npm run build`：tsc 与 vite 通过，three 在按需块中，设置首屏不预载。
- 浏览器结构探针：导航含「皮肤」；Steve/Alex 各 9 张缩略图 300x300 非空；搜索、点选、切标签回退、右键菜单、上传弹窗校验与 Esc 均正常。
- 1080x720 网格三列 157px，右侧预览 278x550；720x480 两列 123px，页面不产生外层滚动。
- 预览场景独立探针：276x548 渲染出 30986 个不透明像素。
- 缩略图实图检查：左背面、右正面，正面可见头部、头顶与左手，与参考图角度一致。
- 待真机验收：右侧预览拖拽与滚轮手感、上传落盘后物品栏即时刷新、移除当前皮肤回退 Alex wide。

## 物品栏玩家预览修复

- 根因一：`entity-view` 离屏窗口没有加进 capabilities，事件监听被 ACL 拒绝，收不到 `entity-setup`。
- 根因二：启动期下发事件早于离屏页注册监听，`entity_meta` 去重后不会再补发。
- 修复：capability 补上 `entity-view`；离屏页贴图加载完再注册监听并调用 `entity_view_ready`，原生侧重置指纹后补发 setup 与 active。
- 浏览器探针：`entity-view` 页面就绪，模型 12 骨骼，同步渲染出 56264 个不透明像素。
- 根因三：tao 只采用落在显示器内的初始坐标，配置里的 -32000 被丢弃，透明离屏窗口落到屏幕左上角，接上帧后显示成模型虚影。
- 修复：`entity-view` 配置改为隐藏，创建后显式移到 -32000 再显示；对运行中的窗口调用 SetWindowPos 验证，虚影消失且窗口仍在屏外。
