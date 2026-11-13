import { useState } from "react";
import { resetConfig } from "../../config/appConfig";
import { Button, Card, Note, SectionHead } from "../components/controls";

const ABOUT_ROWS: { label: string; value: string }[] = [
  { label: "作者", value: "iFannna" },
  { label: "许可证", value: "MIT License" },
  { label: "项目地址", value: "GitHub" },
  { label: "版权", value: "© 2025 iFannna" }
];

export function AboutSection() {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleReset = () => {
    resetConfig();
    setConfirming(false);
    setMessage("已恢复全部默认设置。窗口显隐不会立即全部联动，重新打开对应窗口后生效。");
  };

  return (
    <>
      <SectionHead title="关于" />
      <Card className="about-card">
        <div className="about-product">Craft#</div>
        <div className="about-version">版本 0.1.0</div>
        <p className="about-desc">
          一款 Minecraft 主题风格的桌面管理工具，集成 HUD 状态栏、物品栏与准星。当前版本从 .NET 8 +
          WPF 迁移到 Tauri 2。
        </p>
        <div className="about-divider" />
        <div className="about-info">
          {ABOUT_ROWS.map((row) => (
            <div key={row.label} className="about-info-row">
              <span className="about-info-label">{row.label}</span>
              <span className="about-info-value">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="about-divider" />
        <p className="about-meta">Tauri 2 · Rust · React 19 · TypeScript · Vite 6</p>
      </Card>
      <Card className="action-card">
        {confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>取消</Button>
            <Button variant="danger" primary onClick={handleReset}>
              确认恢复全部默认设置
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)}>恢复默认设置</Button>
        )}
      </Card>
      {confirming ? (
        <Note tone="warning">这会清空所有自定义设置，包括热键、样式与格子数据关联的配置。确认后立即生效。</Note>
      ) : null}
      {message ? <Note tone="success">{message}</Note> : null}
    </>
  );
}
