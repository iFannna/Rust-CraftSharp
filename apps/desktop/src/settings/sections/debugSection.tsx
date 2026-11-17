import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { toggleEntityPreview } from "@/lib/windowControls";
import { Button, Row, SectionHead } from "@/settings/components/controls";

export function DebugSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);

  return (
    <>
      <SectionHead title={t("debug.title")} />
      <Row label={t("debug.previewLabel")} description={t("debug.previewDesc")}>
        <Button onClick={() => void toggleEntityPreview()}>{t("debug.openPreview")}</Button>
      </Row>
    </>
  );
}
