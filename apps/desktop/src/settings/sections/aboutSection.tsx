import { useState } from "react";
import { resetConfig } from "../../config/appConfig";
import { Button, Card, Note, SectionHead } from "../components/controls";

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
      <SectionHead title="关于" description="版本信息与重置入口。" />
      <Card>
        <div className="row">
          <div className="row-text">
            <div className="about-product">
              <strong>CraftSharp</strong>
              <span className="about-version">版本 0.1.0</span>
            </div>
            <p className="about-desc">
              桌面 HUD 与壁纸工具，把 Minecraft 风格的状态栏、物品栏和准星放到桌面上。当前版本从 .NET 8 + WPF
              迁移到 Tauri 2。
            </p>
            <p className="about-meta">Tauri 2 · Rust · React 19 · TypeScript · Vite 6</p>
          </div>
        </div>
        <div className="button-row">
          {confirming ? (
            <>
              <Button onClick={() => setConfirming(false)}>取消</Button>
              <Button variant="danger" primary onClick={handleReset}>
                确认恢复全部默认设置
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              恢复全部默认设置
            </Button>
          )}
        </div>
      </Card>
      {confirming ? <Note tone="warning">这会清空所有自定义设置，包括热键、样式与格子数据关联的配置。确认后立即生效。</Note> : null}
      {message ? <Note tone="success">{message}</Note> : null}
    </>
  );
}
