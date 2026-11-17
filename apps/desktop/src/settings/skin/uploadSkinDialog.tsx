import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { tOf } from "@/i18n";
import { useAppConfig } from "@/config/useAppConfig";
import { Button as SettingsButton } from "@/settings/components/controls";
import { SkinModal } from "@/settings/skin/skinModal";
import {
  importSkin,
  nameError,
  readSkinFile,
  SkinFileError,
  type SkinEntry,
  type SkinFile,
  type SkinType
} from "@/settings/skin/skinLibrary";
import { cn } from "@/ui/lib/utils";

interface UploadSkinDialogProps {
  initialType: SkinType;
  names: Record<SkinType, string[]>;
  bake: (type: SkinType, url: string) => Promise<string>;
  onClose: () => void;
  onImported: (entry: SkinEntry, type: SkinType) => void;
}

export function UploadSkinDialog({ initialType, names, bake, onClose, onImported }: UploadSkinDialogProps) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [name, setName] = useState("");
  const [type, setType] = useState<SkinType>(initialType);
  const [file, setFile] = useState<SkinFile | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileUrlRef = useRef<string | null>(null);

  const releaseFileUrl = (url: string | null) => {
    if (!url) return;
    void import("@/settings/skin/skinScene")
      .then(({ forgetTexture }) => forgetTexture(url))
      .catch(() => undefined);
    URL.revokeObjectURL(url);
  };

  useEffect(
    () => () => {
      releaseFileUrl(fileUrlRef.current);
      fileUrlRef.current = null;
    },
    []
  );

  const nameIssue = name.trim() ? nameError(name) : null;
  const nameMessage =
    nameIssue === "long"
      ? t("skin.nameTooLong")
      : nameIssue === "chars"
        ? t("skin.nameInvalidChars")
        : null;

  const bakePreview = (nextType: SkinType, nextFile: SkinFile) => {
    setPreview(null);
    void bake(nextType, nextFile.url)
      .then(setPreview)
      .catch(() => setPreview(null));
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setFileError(null);
    setError(null);
    try {
      const next = await readSkinFile(picked);
      releaseFileUrl(fileUrlRef.current);
      fileUrlRef.current = next.url;
      setFile(next);
      bakePreview(type, next);
    } catch (reason) {
      if (reason instanceof SkinFileError) {
        if (reason.code === "tooLarge") setFileError(t("skin.fileTooLarge"));
        else if (reason.code === "notPng") setFileError(t("skin.fileNotPng"));
        else if (reason.width === 64 && reason.height === 32) setFileError(t("skin.fileLegacy"));
        else
          setFileError(
            t("skin.fileWrongSize", { width: reason.width, height: reason.height })
          );
      } else {
        setFileError(t("skin.fileNotPng"));
      }
    }
  };

  const changeType = (next: SkinType) => {
    if (next === type) return;
    setType(next);
    if (file) bakePreview(next, file);
  };

  const confirm = async () => {
    const trimmed = name.trim();
    const issue = nameError(trimmed);
    if (issue) {
      setError(
        issue === "empty"
          ? t("skin.nameRequired")
          : issue === "long"
            ? t("skin.nameTooLong")
            : t("skin.nameInvalidChars")
      );
      return;
    }
    if (!file) {
      setError(t("skin.noFile"));
      return;
    }
    if (names[type].some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setError(t("skin.nameConflict", { name: trimmed }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await importSkin(trimmed, type, file.base64);
      releaseFileUrl(file.url);
      fileUrlRef.current = null;
      onImported(entry, type);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <SkinModal
      title={t("skin.uploadTitle")}
      closeLabel={t("common.cancel")}
      onClose={onClose}
      footer={
        <>
          <SettingsButton onClick={onClose}>{t("common.cancel")}</SettingsButton>
          <SettingsButton primary disabled={busy} onClick={() => void confirm()}>
            {t("common.confirm")}
          </SettingsButton>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4">
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">{t("skin.uploadName")}</span>
            <Input
              autoFocus
              value={name}
              maxLength={40}
              placeholder={t("skin.uploadNamePlaceholder")}
              aria-label={t("skin.uploadName")}
              onChange={(event) => setName(event.target.value)}
            />
            {nameMessage ? <span className="block text-xs text-destructive">{nameMessage}</span> : null}
          </label>

          <div className="space-y-2">
            <span className="block text-sm font-medium">{t("skin.uploadType")}</span>
            <div className="flex gap-2">
              {(["wide", "slim"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "h-9 rounded-md px-3 text-sm transition-colors",
                    value === type
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  aria-pressed={value === type}
                  onClick={() => changeType(value)}
                >
                  {value === "wide" ? t("skin.tabSteve") : t("skin.tabAlex")}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium">{t("skin.uploadFile")}</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                {t("skin.selectFile")}
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {file ? file.name : t("skin.fileNone")}
              </span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(event) => void pickFile(event)}
            />
            {fileError ? <span className="block text-xs text-destructive">{fileError}</span> : null}
          </div>

          {error ? <div className="text-xs leading-snug text-destructive">{error}</div> : null}
        </div>

        <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted/30">
          {preview ? (
            <img
              src={preview}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : null}
        </div>
      </div>
    </SkinModal>
  );
}
