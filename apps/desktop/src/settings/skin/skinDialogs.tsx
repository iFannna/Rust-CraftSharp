import { useState } from "react";
import { Input } from "@/ui/components/input";
import { tOf } from "@/i18n";
import { useAppConfig } from "@/config/useAppConfig";
import { Button } from "@/settings/components/controls";
import { SkinModal } from "@/settings/skin/skinModal";
import {
  nameError,
  removeSkin,
  renameSkin,
  type SkinEntry,
  type SkinSource
} from "@/settings/skin/skinLibrary";

interface RenameSkinDialogProps {
  source: Extract<SkinSource, { kind: "custom" }>;
  names: string[];
  onClose: () => void;
  onRenamed: (entry: SkinEntry) => void;
}

export function RenameSkinDialog({ source, names, onClose, onRenamed }: RenameSkinDialogProps) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [name, setName] = useState(source.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    const trimmed = name.trim();
    if (trimmed === source.name) {
      onClose();
      return;
    }
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
    if (names.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setError(t("skin.renameDuplicate", { name: trimmed }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await renameSkin(source.type, source.name, trimmed);
      onRenamed(entry);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <SkinModal
      title={t("skin.renameTitle")}
      closeLabel={t("common.cancel")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button primary disabled={busy} onClick={() => void confirm()}>
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">{t("skin.renameNewLabel")}</span>
        <Input
          autoFocus
          value={name}
          maxLength={40}
          aria-label={t("skin.renameNewLabel")}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error ? <div className="mt-3 text-xs leading-snug text-destructive">{error}</div> : null}
    </SkinModal>
  );
}

interface RemoveSkinDialogProps {
  source: Extract<SkinSource, { kind: "custom" }>;
  onClose: () => void;
  onRemoved: () => void;
}

export function RemoveSkinDialog({ source, onClose, onRemoved }: RemoveSkinDialogProps) {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeSkin(source.type, source.name);
      onRemoved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <SkinModal
      title={t("skin.removeTitle")}
      closeLabel={t("common.cancel")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button primary variant="danger" disabled={busy} onClick={() => void confirm()}>
            {t("skin.removeConfirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("skin.removeHint", { name: source.name })}
      </p>
      {error ? <div className="mt-3 text-xs leading-snug text-destructive">{error}</div> : null}
    </SkinModal>
  );
}
