# 设置面板 i18n 实施计划

## 0. 进度

- 已完成：`src/i18n/` 语言注册表、中英文案、翻译函数与 `useI18n`
- 已完成：设置面板全部组件改为词条，重复下拉选项收敛到 `src/settings/options.ts`
- 已完成：语言切换联动窗口标题、`html lang`，移除“英文界面后续版本提供”提示
- 已完成：`tsc --noEmit`、`vite build`、无头浏览器中英切换实测
- 待用户验收：真实桌面端窗口标题、字体与英文换行观感

## 1. 目标

- 设置面板支持简体中文与英文，切换后立即生效
- 已有文案与旧 WPF 项目 `Strings.zh-CN.xaml`、`Strings.en-US.xaml` 逐字一致
- 新功能文案补中英两版，不引入翻译服务
- 以后增加语言只补文案文件，不改组件

## 2. 结构

```text
src/i18n/
  index.ts            语言注册表、LanguageCode、tOf 与插值
  useI18n.ts          订阅配置语言的 React hook
  locales/
    zh-CN.ts          键类型基准
    en-US.ts          按 Messages 类型校验，缺键或多键直接报错
src/settings/options.ts  下拉选项与 i18n key 的集中映射
```

## 3. 约定

- `zh-CN.ts` 决定全部 key；`en-US.ts` 用 `Messages` 标注，编译期保证键集一致
- 文案按域分组：`nav`、`system`、`appearance`、`about`、`hotkeys`、`hud`、`inventory`、`bossBar`、`color`、`iconStyle`
- 旧 WPF key 改名后保持原文：例如 `HudOptionShowStatusBar` → `hud.showStatusBar`
- 新功能文案沿用界面现有中文，英文按同一语气补写
- 插值只支持 `{name}`，用于版本号、快捷键冲突列表、带元素名的 aria-label

## 4. 增加语言的步骤

1. 在 `src/i18n/locales/` 新增一份 `Messages` 类型文案，如 `ja-JP.ts`
2. 在 `src/i18n/index.ts` 的 `LANGUAGES` 增加 `{ value: "ja-JP", label: "日本語" }`
3. 在同一文件的 `DICTIONARIES` 注册文案
4. `LanguageCode` 由 `LANGUAGES` 推导，`src/config/appConfig.ts` 与语言下拉自动生效

## 5. 验证

- `npm run build`：类型检查与打包通过
- 无头 Chrome 预览实测：默认中文；点击语言下拉切到 English 后，文档标题、`html lang`、导航、设置项与 aria-label 全部切换
- 未验证项：Tauri 窗口原生标题的最终显示依赖运行时权限，已加 `core:window:allow-set-title`
