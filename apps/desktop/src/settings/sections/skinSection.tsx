import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConfig } from "@/config/appConfig";
import { useAppConfig } from "@/config/useAppConfig";
import { tOf } from "@/i18n";
import { isTauri } from "@/lib/runtime";
import { Card, Note } from "@/settings/components/controls";
import { SkinGrid, SkinMenu, SkinToolbar, type SkinMenuItem } from "@/settings/skin/skinGrid";
import { SkinPreviewPanel } from "@/settings/skin/skinPreview";
import { RenameSkinDialog, RemoveSkinDialog } from "@/settings/skin/skinDialogs";
import { UploadSkinDialog } from "@/settings/skin/uploadSkinDialog";
import {
  applySkinSource,
  builtinSources,
  currentSource,
  displayName,
  forgetSkinUrl,
  listSkins,
  sourceKey,
  sourceUrl,
  tabSource,
  type SkinEntry,
  type SkinSource,
  type SkinType
} from "@/settings/skin/skinLibrary";
import type { SkinThumbs } from "@/settings/skin/skinScene";

type DialogState =
  | { kind: "upload" }
  | { kind: "rename"; source: Extract<SkinSource, { kind: "custom" }> }
  | { kind: "remove"; source: Extract<SkinSource, { kind: "custom" }> }
  | null;

export function SkinSection() {
  const config = useAppConfig();
  const t = tOf(config.system.language);
  const player = config.player;
  const [type, setType] = useState<SkinType>(() => currentSource(player).type);
  const [query, setQuery] = useState("");
  const [customs, setCustoms] = useState<Record<SkinType, SkinEntry[]>>({ wide: [], slim: [] });
  const [preview, setPreview] = useState<SkinSource>(() => currentSource(player));
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [baking, setBaking] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ source: SkinSource; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const thumbsRef = useRef<Record<string, string>>({});
  const bakerRef = useRef<SkinThumbs | null>(null);
  const lastPlayerRef = useRef(JSON.stringify(player));

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const [wide, slim] = await Promise.all([listSkins("wide"), listSkins("slim")]);
      setCustoms({ wide, slim });
      setListError(null);
    } catch (reason) {
      setListError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const json = JSON.stringify(player);
    if (json === lastPlayerRef.current) return;
    lastPlayerRef.current = json;
    const source = currentSource(player);
    setType(source.type);
    setPreview(source);
  }, [player]);

  const sources = useMemo(() => {
    const custom = customs[type].map(
      (entry): SkinSource => ({ kind: "custom", type, name: entry.name, path: entry.path })
    );
    return [...custom, ...builtinSources(type)];
  }, [customs, type]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter((source) => displayName(source).toLowerCase().includes(needle));
  }, [sources, query]);

  const selectedKey = sourceKey(preview);
  const currentKey = sourceKey(currentSource(player));
  const names = useMemo(
    () => ({
      wide: customs.wide.map((entry) => entry.name),
      slim: customs.slim.map((entry) => entry.name)
    }),
    [customs]
  );

  // 卡片缩略图按标签补烘，结果进内存缓存
  useEffect(() => {
    const missing = sources.filter((source) => !thumbsRef.current[sourceKey(source)]);
    if (!missing.length) {
      setBaking(false);
      return;
    }
    let cancelled = false;
    setBaking(true);
    void (async () => {
      const { SkinThumbs } = await import("@/settings/skin/skinScene");
      if (cancelled) return;
      bakerRef.current ??= new SkinThumbs();
      const baker = bakerRef.current;
      for (const source of missing) {
        if (cancelled) return;
        const key = sourceKey(source);
        if (thumbsRef.current[key]) continue;
        try {
          const url = await sourceUrl(source);
          const image = await baker.bake(source.type, url);
          if (cancelled) return;
          thumbsRef.current = { ...thumbsRef.current, [key]: image };
          setThumbs(thumbsRef.current);
        } catch {
          // 单张失败保留占位，不影响其他卡片
        }
      }
      if (!cancelled) setBaking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  useEffect(
    () => () => {
      bakerRef.current?.dispose();
      bakerRef.current = null;
    },
    []
  );

  const bake = useCallback(async (nextType: SkinType, url: string) => {
    if (!bakerRef.current) {
      const { SkinThumbs } = await import("@/settings/skin/skinScene");
      bakerRef.current ??= new SkinThumbs();
    }
    return bakerRef.current.bake(nextType, url);
  }, []);

  const select = (source: SkinSource) => {
    applySkinSource(source);
    setType(source.type);
    setPreview(source);
  };

  const menuItemsFor = (source: SkinSource): SkinMenuItem[] => {
    const items: SkinMenuItem[] = [];
    if (sourceKey(source) !== currentKey) {
      items.push({ label: t("skin.setCurrent"), onSelect: () => select(source) });
    }
    if (source.kind === "custom") {
      items.push({
        label: t("skin.rename"),
        onSelect: () => setDialog({ kind: "rename", source })
      });
      items.push({
        label: t("skin.remove"),
        danger: true,
        onSelect: () => setDialog({ kind: "remove", source })
      });
    }
    return items;
  };

  const handleImported = (entry: SkinEntry, nextType: SkinType) => {
    setDialog(null);
    const source: SkinSource = { kind: "custom", type: nextType, name: entry.name, path: entry.path };
    delete thumbsRef.current[sourceKey(source)];
    setThumbs({ ...thumbsRef.current });
    forgetSkinUrl(entry.path);
    void refresh();
    select(source);
  };

  const handleRenamed = (old: Extract<SkinSource, { kind: "custom" }>, entry: SkinEntry) => {
    setDialog(null);
    const next: SkinSource = { kind: "custom", type: old.type, name: entry.name, path: entry.path };
    delete thumbsRef.current[sourceKey(old)];
    setThumbs({ ...thumbsRef.current });
    forgetSkinUrl(old.path);
    void refresh();
    if (getConfig().player.skinPath === old.path) {
      select(next);
    } else if (sourceKey(preview) === sourceKey(old)) {
      setPreview(next);
    }
  };

  const handleRemoved = (source: Extract<SkinSource, { kind: "custom" }>) => {
    setDialog(null);
    delete thumbsRef.current[sourceKey(source)];
    setThumbs({ ...thumbsRef.current });
    forgetSkinUrl(source.path);
    void refresh();
    if (getConfig().player.skinPath === source.path) {
      // 与老项目一致：移除当前皮肤后回退内置 Alex wide
      const fallback: SkinSource = { kind: "builtin", type: "wide", name: "alex" };
      select(fallback);
    } else if (sourceKey(preview) === sourceKey(source)) {
      setPreview(tabSource(type));
    }
  };

  const showLoading = baking && !sources.some((source) => thumbs[sourceKey(source)]);
  const menuItems = menu ? menuItemsFor(menu.source) : [];
  const renameDialog = dialog?.kind === "rename" ? dialog : null;
  const removeDialog = dialog?.kind === "remove" ? dialog : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SkinToolbar
        type={type}
        onChange={(next) => {
          if (next === type) return;
          setType(next);
          setPreview(tabSource(next));
        }}
        onUpload={() => setDialog({ kind: "upload" })}
        search={query}
        onSearch={setQuery}
        labels={{
          steve: t("skin.tabSteve"),
          alex: t("skin.tabAlex"),
          upload: t("skin.tabUpload"),
          search: t("skin.search")
        }}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)] gap-3">
        <Card className="relative flex min-h-0 flex-col overflow-hidden">
          {listError ? (
            <div className="px-3 pt-3">
              <Note tone="warning">{listError}</Note>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <SkinGrid
              sources={filtered}
              thumbs={thumbs}
              selectedKey={selectedKey}
              emptyLabel={t("skin.empty")}
              onSelect={select}
              onMenu={(source, x, y) => {
                if (menuItemsFor(source).length) setMenu({ source, x, y });
              }}
            />
          </div>
          {showLoading ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-card/70 text-sm text-muted-foreground">
              {t("skin.loading")}
            </div>
          ) : null}
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <SkinPreviewPanel source={preview} />
        </Card>
      </div>

      {menu && menuItems.length ? (
        <SkinMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}

      {dialog?.kind === "upload" ? (
        <UploadSkinDialog
          initialType={type}
          names={names}
          bake={bake}
          onClose={() => setDialog(null)}
          onImported={handleImported}
        />
      ) : null}

      {renameDialog ? (
        <RenameSkinDialog
          source={renameDialog.source}
          names={names[renameDialog.source.type]}
          onClose={() => setDialog(null)}
          onRenamed={(entry) => handleRenamed(renameDialog.source, entry)}
        />
      ) : null}

      {removeDialog ? (
        <RemoveSkinDialog
          source={removeDialog.source}
          onClose={() => setDialog(null)}
          onRemoved={() => handleRemoved(removeDialog.source)}
        />
      ) : null}
    </div>
  );
}
