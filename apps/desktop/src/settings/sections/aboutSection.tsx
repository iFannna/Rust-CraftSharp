import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf, type MessageKey } from "@/i18n";
import { openDialogWindow } from "@/lib/dialogWindow";
import { isTauri } from "@/lib/runtime";
import { WINDOW_LABEL } from "@/lib/windowLabels";
import { Button, Card, SectionHead } from "@/settings/components/controls";

const AUTHOR_URL = "https://github.com/iFannna";
const PROJECT_URL = "https://github.com/iFannna/Rust-CraftSharp";
const FEEDBACK_URL = "https://github.com/iFannna/Rust-CraftSharp/issues";
const TERMS_URL = "https://github.com/iFannna/CraftSharp/blob/main/docs/TERMS.md";
const PRIVACY_URL = "https://github.com/iFannna/CraftSharp/blob/main/docs/PRIVACY.md";
const RELEASES_API = "https://api.github.com/repos/iFannna/Rust-CraftSharp/releases/latest";

const ABOUT_ROWS: { labelKey: MessageKey; value: string; url?: string }[] = [
  { labelKey: "about.author", value: "iFannna", url: AUTHOR_URL },
  { labelKey: "about.license", value: "MIT License" },
  { labelKey: "about.projectUrl", value: "GitHub", url: PROJECT_URL },
  { labelKey: "about.copyright", value: "© 2025 iFannna" }
];

const VERSION = "26.11.19";

function openExternal(url: string): void {
  if (isTauri()) {
    void invoke("open_path", { path: url }).catch(() => undefined);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function parseVersion(value: string): number[] | null {
  const match = /^(\d+(?:\.\d+)*)$/.exec(value.trim().replace(/^v/i, ""));
  return match ? match[1].split(".").map(Number) : null;
}

function isNewerVersion(latest: number[], current: number[]): boolean {
  const length = Math.max(latest.length, current.length);
  for (let index = 0; index < length; index += 1) {
    const left = latest[index] ?? 0;
    const right = current[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

interface ReleaseInfo {
  version: string;
  url: string;
  body: string;
}

/** 取 GitHub 最新 release，解析失败或已是最新时返回 null */
async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown };
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    const latest = parseVersion(tag);
    const current = parseVersion(VERSION);
    if (!latest || !current || !isNewerVersion(latest, current)) return null;
    return {
      version: tag.trim().replace(/^v/i, ""),
      url: typeof data.html_url === "string" ? data.html_url : PROJECT_URL,
      body: typeof data.body === "string" ? data.body.trim() : ""
    };
  } catch {
    return null;
  }
}

export function AboutSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [checking, setChecking] = useState(false);

  const showUpdateResult = async (release: ReleaseInfo | null) => {
    if (release) {
      const download = await openDialogWindow<boolean>({
        label: WINDOW_LABEL.confirm,
        title: "Craft#",
        page: "confirm",
        params: {
          kind: "alert",
          title: "Craft#",
          text: `v${release.version}\n\n${release.body || t("about.noChangelog")}`,
          confirmLabel: t("about.download"),
          cancelLabel: t("about.skip")
        },
        width: 460,
        height: 320,
        anchor: WINDOW_LABEL.settings
      });
      if (download === true) openExternal(release.url);
      return;
    }

    await openDialogWindow<boolean>({
      label: WINDOW_LABEL.confirm,
      title: t("about.checkUpdate"),
      page: "confirm",
      params: { kind: "alert", title: t("about.checkUpdate"), text: t("about.latest") },
      width: 400,
      height: 180,
      anchor: WINDOW_LABEL.settings
    });
  };

  const handleCheckUpdate = async () => {
    if (checking) return;
    setChecking(true);
    const release = await fetchLatestRelease();
    setChecking(false);
    await showUpdateResult(release);
  };

  return (
    <>
      <SectionHead title={t("about.title")} />
      <Card className="mb-2 p-6">
        <div className="text-2xl font-bold tracking-tight">Craft#</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {t("about.version", { version: VERSION })}
        </div>
        <p className="my-6 text-sm leading-relaxed text-muted-foreground">{t("about.desc")}</p>
        <div className="h-px bg-border" />
        <div className="my-5 flex flex-col gap-3.5">
          {ABOUT_ROWS.map((row) => (
            <div key={row.labelKey} className="flex items-center justify-between gap-6 text-sm">
              <span className="text-muted-foreground">{t(row.labelKey)}</span>
              {row.url ? (
                <button
                  type="button"
                  className="cursor-pointer text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => openExternal(row.url!)}
                >
                  {row.value}
                </button>
              ) : (
                <span>{row.value}</span>
              )}
            </div>
          ))}
        </div>
        <div className="h-px bg-border" />
        <div className="mt-5 flex justify-center gap-4">
          <Button className="w-[120px]" disabled={checking} onClick={() => void handleCheckUpdate()}>
            {checking ? t("about.checkingUpdate") : t("about.checkUpdate")}
          </Button>
          <Button className="w-[120px]" onClick={() => openExternal(FEEDBACK_URL)}>
            {t("about.feedback")}
          </Button>
        </div>
      </Card>
      <div className="mb-2 mt-4 flex justify-center gap-4 text-xs">
        <button
          type="button"
          className="cursor-pointer text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          onClick={() => openExternal(TERMS_URL)}
        >
          {t("about.terms")}
        </button>
        <button
          type="button"
          className="cursor-pointer text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          onClick={() => openExternal(PRIVACY_URL)}
        >
          {t("about.privacy")}
        </button>
      </div>
    </>
  );
}
