//! 壁纸布局：同步、按屏独立、跨屏拼接的统一入口。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::store::Transform;
use super::{desktop, dynamic, store};
use dynamic::Saved;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorPlan {
    pub monitor: String,
    pub entry: Entry,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanPlan {
    pub entry: Entry,
    #[serde(default)]
    pub transform: Transform,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub mode: String,
    #[serde(default)]
    pub sync: Option<Entry>,
    #[serde(default)]
    pub monitors: Vec<MonitorPlan>,
    #[serde(default)]
    pub span: Option<SpanPlan>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub applied: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn apply(app: &AppHandle, plan: Plan) -> Result<ApplyResult, String> {
    let monitors = desktop::monitors(app);
    if monitors.is_empty() {
        return Err("没有检测到显示器".into());
    }

    match plan.mode.as_str() {
        "sync" => apply_sync(app, plan.sync, &monitors),
        "independent" => apply_independent(app, plan.monitors),
        "span" => apply_span(app, plan.span, &monitors),
        _ => Err("壁纸模式无效".into()),
    }
}

fn apply_sync(
    app: &AppHandle,
    entry: Option<Entry>,
    monitors: &[desktop::MonitorInfo],
) -> Result<ApplyResult, String> {
    let entry = entry.ok_or_else(|| "缺少同步壁纸".to_string())?;
    let mut result = ApplyResult::default();

    if entry.kind == "dynamic" {
        let video = store::prepare_video(app, &entry.id)?;
        let targets: Vec<(String, PathBuf)> = monitors
            .iter()
            .map(|monitor| (monitor.device_path.clone(), video.clone()))
            .collect();
        dynamic::apply_monitors(&targets)?;
        let saved: Vec<Saved> = monitors
            .iter()
            .map(|monitor| Saved {
                id: entry.id.clone(),
                device: Some(monitor.device_path.clone()),
                transform: None,
                span: false,
            })
            .collect();
        dynamic::remember(app, &saved);
        result
            .applied
            .extend(targets.into_iter().map(|(device, _)| device));
        return Ok(result);
    }

    let path = store::prepare(app, &entry.id)?;
    desktop::apply(&path)?;
    dynamic::stop_all();
    dynamic::forget(app);
    store::sweep(app, std::slice::from_ref(&path));
    result
        .applied
        .extend(monitors.iter().map(|m| m.device_path.clone()));
    Ok(result)
}

fn apply_independent(app: &AppHandle, entries: Vec<MonitorPlan>) -> Result<ApplyResult, String> {
    if entries.is_empty() {
        return Err("请至少选择一个显示器".into());
    }
    let mut result = ApplyResult::default();
    let mut keeps = Vec::new();
    let mut dynamics = Vec::new();
    let mut statics = Vec::new();
    let mut saved = Vec::new();

    for item in entries {
        match item.entry.kind.as_str() {
            "dynamic" => match store::prepare_video(app, &item.entry.id) {
                Ok(video) => {
                    keeps.push(video.clone());
                    saved.push(Saved {
                        id: item.entry.id.clone(),
                        device: Some(item.monitor.clone()),
                        transform: None,
                        span: false,
                    });
                    dynamics.push((item.monitor, video));
                }
                Err(error) => result.warnings.push(format!("{}：{error}", item.monitor)),
            },
            _ => match store::prepare(app, &item.entry.id) {
                Ok(path) => {
                    keeps.push(path.clone());
                    match desktop::set_for(&item.monitor, &path) {
                        Ok(()) => result.applied.push(item.monitor.clone()),
                        Err(error) => result.warnings.push(error),
                    }
                    statics.push(item.monitor);
                }
                Err(error) => result.warnings.push(format!("{}：{error}", item.monitor)),
            },
        }
    }

    // 已切换为静态的显示器先铺静态图，再淡出该屏的动态实例
    dynamic::stop_devices(&statics);
    let mut dynamic_started = false;
    if !dynamics.is_empty() {
        if let Err(error) = dynamic::apply_monitors(&dynamics) {
            result.warnings.push(error);
        } else {
            dynamic::remember(app, &saved);
            result
                .applied
                .extend(dynamics.into_iter().map(|(device, _)| device));
            dynamic_started = true;
        }
    } else {
        dynamic::forget(app);
    }
    if result.applied.is_empty() && !dynamic_started {
        return Err(result
            .warnings
            .first()
            .cloned()
            .unwrap_or_else(|| "没有可应用的显示器".into()));
    }
    // 动态壁纸运行时会盖住系统壁纸，系统仍引用原静态文件作为退出后的回退
    if !dynamic_started {
        store::sweep(app, &keeps);
    }
    Ok(result)
}

fn apply_span(
    app: &AppHandle,
    span: Option<SpanPlan>,
    monitors: &[desktop::MonitorInfo],
) -> Result<ApplyResult, String> {
    let span = span.ok_or_else(|| "缺少拼接壁纸".to_string())?;
    let mut result = ApplyResult::default();

    if span.entry.kind == "dynamic" {
        let video = store::prepare_video(app, &span.entry.id)?;
        dynamic::apply_span(&video, span.transform)?;
        let saved: Vec<Saved> = monitors
            .iter()
            .map(|monitor| Saved {
                id: span.entry.id.clone(),
                device: Some(monitor.device_path.clone()),
                transform: Some(span.transform),
                span: true,
            })
            .collect();
        dynamic::remember(app, &saved);
        result
            .applied
            .extend(monitors.iter().map(|m| m.device_path.clone()));
        return Ok(result);
    }

    let source = store::prepare(app, &span.entry.id)?;
    // GNOME 这类桌面不能逐屏设置，直接交给系统做跨屏拼接
    if !desktop::per_monitor() {
        desktop::apply_span(&source)?;
        dynamic::stop_all();
        dynamic::forget(app);
        store::sweep(app, std::slice::from_ref(&source));
        result
            .applied
            .extend(monitors.iter().map(|m| m.device_path.clone()));
        return Ok(result);
    }

    let crops = store::span_crops(app, &span.entry.id, monitors, span.transform)?;
    let mut keeps: Vec<PathBuf> = crops.iter().map(|(_, path)| path.clone()).collect();
    keeps.push(source);
    for (device, path) in &crops {
        match desktop::set_for(device, path) {
            Ok(()) => result.applied.push(device.clone()),
            Err(error) => result.warnings.push(error),
        }
    }
    dynamic::stop_all();
    dynamic::forget(app);
    store::sweep(app, &keeps);
    Ok(result)
}
