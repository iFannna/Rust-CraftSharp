/** 存储设置：展示壁纸缓存目录并支持无感迁移 */

import { useEffect, useState } from "react";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { reapplyStaticWallpaper } from "@/lib/wallpaperRestore";
import { Button, Note, Row, SectionSubhead } from "@/settings/components/controls";
import { migrateStorage, openStorage, pickFolder, resetStorage, storagePath } from "@/settings/wallpaper/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip";

export function StorageControls({ resetSignal = 0 }: { resetSignal?: number }) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void storagePath()
      .then((value) => active && setPath(value))
      .catch((reason) => active && setError(String(reason)));
    return () => {
      active = false;
    };
  }, []);

  const run = async (move: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      setPath(await move());
      await reapplyStaticWallpaper();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!resetSignal || !isTauri()) return;
    void run(resetStorage);
  }, [resetSignal]);

  const change = async () => {
    const picked = await pickFolder(t("system.storagePickTitle")).catch(() => null);
    if (picked) await run(() => migrateStorage(picked));
  };

  const openFolder = () => {
    if (!path) return;
    void openStorage().catch((reason) => setError(String(reason)));
  };

  return (
    <>
      <SectionSubhead>{t("system.storage")}</SectionSubhead>
      <Row
        label={t("system.wallpaperPathLabel")}
        description={
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="block max-w-full break-all text-left transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none disabled:no-underline"
                onClick={openFolder}
                disabled={!path}
                aria-label={t("system.openFolder")}
              >
                {path || t("common.notSet")}
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("system.openFolder")}</TooltipContent>
          </Tooltip>
        }
        disabled={busy}
      >
        <Button onClick={change} disabled={busy || !isTauri()}>
          {busy ? t("system.migrating") : t("system.changePath")}
        </Button>
      </Row>
      {error ? <Note tone="warning">{error}</Note> : null}
    </>
  );
}
