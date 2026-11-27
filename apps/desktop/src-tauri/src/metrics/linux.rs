//! Linux 指标：电池读 sysfs，内存与 CPU 读 /proc，GPU 按厂商分别读取。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::metrics::SystemMetrics;

pub(super) fn collect() -> SystemMetrics {
    SystemMetrics {
        battery: battery_level(),
        memory: memory_usage(),
        cpu: cpu_usage(),
        gpu: gpu_usage(),
    }
}

fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok().map(|value| value.trim().to_string())
}

fn read_number(path: &Path) -> Option<f64> {
    read_trimmed(path)?.parse().ok()
}

// ---- 电池 ----

/// 多电池取平均。外设电池的 scope 为 Device，按系统电池跳过。
fn battery_level() -> f64 {
    let Ok(entries) = fs::read_dir("/sys/class/power_supply") else {
        return 0.0;
    };
    let mut total = 0.0;
    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if read_trimmed(&path.join("type")).as_deref() != Some("Battery") {
            continue;
        }
        if read_trimmed(&path.join("present")).as_deref() == Some("0") {
            continue;
        }
        if read_trimmed(&path.join("scope")).is_some_and(|scope| scope != "System") {
            continue;
        }
        let Some(level) = battery_ratio(&path) else { continue };
        total += level;
        count += 1;
    }
    if count == 0 {
        0.0
    } else {
        (total / f64::from(count)).clamp(0.0, 1.0)
    }
}

fn battery_ratio(path: &Path) -> Option<f64> {
    if let Some(percent) = read_number(&path.join("capacity")) {
        // 个别驱动用 255 表示未知电量，按无电池处理
        if (0.0..=100.0).contains(&percent) {
            return Some(percent / 100.0);
        }
    }
    // 少数驱动没有 capacity，用当前与满电容量换算
    for unit in ["energy", "charge"] {
        let Some(now) = read_number(&path.join(format!("{unit}_now"))) else { continue };
        let Some(full) = read_number(&path.join(format!("{unit}_full"))) else { continue };
        if full > 0.0 {
            return Some(now / full);
        }
    }
    None
}

// ---- 内存 ----

fn memory_usage() -> f64 {
    let Ok(info) = fs::read_to_string("/proc/meminfo") else {
        return 0.0;
    };
    let Some((total, available)) = parse_meminfo(&info) else {
        return 0.0;
    };
    ((total - available.min(total)) / total).clamp(0.0, 1.0)
}

fn parse_meminfo(info: &str) -> Option<(f64, f64)> {
    let mut total = None;
    let mut available = None;
    let mut free = 0.0;
    let mut buffers = 0.0;
    let mut cached = 0.0;
    for line in info.lines() {
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.split_whitespace().next();
        let Some(value) = value.and_then(|text| text.parse::<f64>().ok()) else { continue };
        match name {
            "MemTotal" => total = Some(value),
            "MemAvailable" => available = Some(value),
            "MemFree" => free = value,
            "Buffers" => buffers = value,
            "Cached" => cached = value,
            _ => {}
        }
    }
    let total = total?;
    if total <= 0.0 {
        return None;
    }
    Some((total, available.unwrap_or(free + buffers + cached)))
}

// ---- CPU ----

#[derive(Clone, Copy)]
struct CpuTimes {
    busy: u64,
    total: u64,
}

static CPU_TIMES: Mutex<Option<CpuTimes>> = Mutex::new(None);

fn cpu_usage() -> f64 {
    let Some(current) = read_cpu_times() else { return 0.0 };
    let Ok(mut sample) = CPU_TIMES.lock() else { return 0.0 };
    let Some(previous) = sample.replace(current) else { return 0.0 };
    let total = current.total.saturating_sub(previous.total);
    if total == 0 {
        return 0.0;
    }
    let busy = current.busy.saturating_sub(previous.busy);
    (busy as f64 / total as f64).clamp(0.0, 1.0)
}

fn read_cpu_times() -> Option<CpuTimes> {
    let stat = fs::read_to_string("/proc/stat").ok()?;
    parse_cpu_times(&stat)
}

fn parse_cpu_times(stat: &str) -> Option<CpuTimes> {
    let mut fields = stat.lines().next()?.split_whitespace();
    if fields.next()? != "cpu" {
        return None;
    }
    // user nice system idle iowait irq softirq steal，guest 已包含在 user 与 nice 里
    let mut times = [0u64; 8];
    for slot in &mut times {
        *slot = fields.next()?.parse().ok()?;
    }
    let idle = times[3] + times[4];
    let total = times.iter().sum();
    Some(CpuTimes { busy: total - idle, total })
}

// ---- GPU ----

/// 多显卡取最忙的一块。NVIDIA 走 NVML，AMD 走 sysfs，Intel 汇总 fdinfo。
fn gpu_usage() -> f64 {
    let mut usage = nvidia::usage();
    let mut intel_done = false;
    for card in drm_cards() {
        let vendor = read_trimmed(&card.join("device/vendor")).unwrap_or_default();
        match vendor.as_str() {
            "0x1002" => usage = usage.max(amd_usage(&card)),
            "0x8086" if !intel_done => {
                intel_done = true;
                usage = usage.max(intel::usage());
            }
            _ => {}
        }
    }
    usage.clamp(0.0, 1.0)
}

fn drm_cards() -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir("/sys/class/drm") else {
        return Vec::new();
    };
    let mut cards: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| is_card(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect();
    cards.sort();
    cards
}

/// 只保留 card0 这类显卡节点，跳过 card0-DP-1 等连接器。
fn is_card(name: &str) -> bool {
    match name.strip_prefix("card") {
        Some(rest) => !rest.is_empty() && rest.bytes().all(|byte| byte.is_ascii_digit()),
        None => false,
    }
}

fn amd_usage(card: &Path) -> f64 {
    read_number(&card.join("device/gpu_busy_percent"))
        .map(|percent| percent / 100.0)
        .unwrap_or(0.0)
}

/// NVIDIA 没有利用率 sysfs，驱动自带的 NVML 是官方接口，按需动态加载。
mod nvidia {
    use std::ffi::{c_int, c_void};
    use std::sync::OnceLock;

    use libloading::Library;

    #[repr(C)]
    #[derive(Default)]
    struct Utilization {
        gpu: u32,
        memory: u32,
    }

    type Init = unsafe extern "C" fn() -> c_int;
    type Count = unsafe extern "C" fn(*mut u32) -> c_int;
    type Handle = unsafe extern "C" fn(u32, *mut *mut c_void) -> c_int;
    type UtilizationFn = unsafe extern "C" fn(*mut c_void, *mut Utilization) -> c_int;

    struct Nvml {
        _library: Library,
        devices: Vec<*mut c_void>,
        utilization: UtilizationFn,
    }

    // NVML 文档声明线程安全，函数与设备句柄在初始化后只读
    unsafe impl Send for Nvml {}
    unsafe impl Sync for Nvml {}

    static NVML: OnceLock<Option<Nvml>> = OnceLock::new();

    pub fn usage() -> f64 {
        let Some(nvml) = NVML.get_or_init(load).as_ref() else {
            return 0.0;
        };
        let mut highest = 0;
        for &device in &nvml.devices {
            let mut value = Utilization::default();
            if unsafe { (nvml.utilization)(device, &mut value) } == 0 {
                highest = highest.max(value.gpu);
            }
        }
        f64::from(highest) / 100.0
    }

    fn load() -> Option<Nvml> {
        unsafe {
            let library = Library::new("libnvidia-ml.so.1").ok()?;
            let init = *library.get::<Init>(b"nvmlInit_v2\0").ok()?;
            if init() != 0 {
                return None;
            }
            let count = *library.get::<Count>(b"nvmlDeviceGetCount_v2\0").ok()?;
            let handle = *library.get::<Handle>(b"nvmlDeviceGetHandleByIndex_v2\0").ok()?;
            let utilization = *library
                .get::<UtilizationFn>(b"nvmlDeviceGetUtilizationRates\0")
                .ok()?;

            let mut total = 0;
            if count(&mut total) != 0 {
                return None;
            }
            let mut devices = Vec::with_capacity(total as usize);
            for index in 0..total {
                let mut device = std::ptr::null_mut();
                if handle(index, &mut device) == 0 && !device.is_null() {
                    devices.push(device);
                }
            }
            if devices.is_empty() {
                return None;
            }
            Some(Nvml { _library: library, devices, utilization })
        }
    }
}

/// Intel 核显没有利用率 sysfs，汇总 fdinfo 里 i915 与 xe 客户端的引擎忙时。
mod intel {
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::sync::Mutex;
    use std::time::Instant;

    struct Sample {
        at: Instant,
        engines: HashMap<String, u64>,
    }

    static SAMPLE: Mutex<Option<Sample>> = Mutex::new(None);

    pub fn usage() -> f64 {
        let engines = read_busy();
        if engines.is_empty() {
            return 0.0;
        }
        let now = Instant::now();
        let Ok(mut sample) = SAMPLE.lock() else {
            return 0.0;
        };
        let usage = sample
            .as_ref()
            .map(|previous| ratio(previous, &engines, now))
            .unwrap_or(0.0);
        *sample = Some(Sample { at: now, engines });
        usage
    }

    /// 取最忙引擎的忙时占实际间隔的比例，多引擎并行时不会叠出超过 100%。
    fn ratio(previous: &Sample, engines: &HashMap<String, u64>, now: Instant) -> f64 {
        let elapsed = now.saturating_duration_since(previous.at).as_nanos() as f64;
        if elapsed <= 0.0 {
            return 0.0;
        }
        let mut highest = 0.0f64;
        for (engine, total) in engines {
            let Some(before) = previous.engines.get(engine) else { continue };
            let busy = total.saturating_sub(*before) as f64;
            highest = highest.max(busy / elapsed);
        }
        highest.clamp(0.0, 1.0)
    }

    fn read_busy() -> HashMap<String, u64> {
        let mut engines = HashMap::new();
        let mut seen = HashSet::new();
        let Ok(processes) = fs::read_dir("/proc") else {
            return engines;
        };
        for process in processes.flatten() {
            let name = process.file_name();
            if name.to_str().and_then(|value| value.parse::<u32>().ok()).is_none() {
                continue;
            }
            let Ok(fds) = fs::read_dir(process.path().join("fdinfo")) else {
                continue;
            };
            for fd in fds.flatten() {
                let Ok(info) = fs::read_to_string(fd.path()) else { continue };
                let Some((client, busy)) = parse(&info) else { continue };
                if !seen.insert(client) {
                    continue;
                }
                for (engine, value) in busy {
                    *engines.entry(engine).or_insert(0) += value;
                }
            }
        }
        engines
    }

    /// 同一客户端可能由多个 fd 引用，由调用方按 client id 去重。
    pub(super) fn parse(info: &str) -> Option<(u64, Vec<(String, u64)>)> {
        let mut client = None;
        let mut driver = "";
        let mut engines = Vec::new();
        for line in info.lines() {
            if let Some(value) = line.strip_prefix("drm-client-id:") {
                client = value.trim().parse().ok();
            } else if let Some(value) = line.strip_prefix("drm-driver:") {
                driver = value.trim();
            } else if let Some(rest) = line.strip_prefix("drm-engine-") {
                let Some((name, value)) = rest.split_once(':') else { continue };
                if name.starts_with("capacity-") {
                    continue;
                }
                let Some(value) = value.trim().strip_suffix("ns") else { continue };
                let Ok(value) = value.trim().parse() else { continue };
                engines.push((name.to_string(), value));
            }
        }
        if !matches!(driver, "i915" | "xe") {
            return None;
        }
        Some((client?, engines))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_cpu_idle_from_busy() {
        let stat = "cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 9 10\n";
        let times = parse_cpu_times(stat).unwrap();
        assert_eq!(times.total, 1000);
        assert_eq!(times.busy, 150);
    }

    #[test]
    fn meminfo_prefers_available() {
        let info = "MemTotal:       16000000 kB\nMemFree:         4000000 kB\nMemAvailable:    8000000 kB\nBuffers:          500000 kB\nCached:          3000000 kB\n";
        let (total, available) = parse_meminfo(info).unwrap();
        assert_eq!(total, 16_000_000.0);
        assert_eq!(available, 8_000_000.0);
    }

    #[test]
    fn meminfo_falls_back_to_free_cache() {
        let info = "MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\n";
        let (_, available) = parse_meminfo(info).unwrap();
        assert_eq!(available, 400.0);
    }

    #[test]
    fn intel_engines_are_collected() {
        let info = "pos:\t0\ndrm-driver:\ti915\ndrm-client-id:\t7\ndrm-engine-render:\t1200 ns\ndrm-engine-copy:\t0 ns\ndrm-engine-capacity-render:\t1\n";
        let (client, engines) = intel::parse(info).unwrap();
        assert_eq!(client, 7);
        assert_eq!(engines, vec![("render".to_string(), 1200), ("copy".to_string(), 0)]);
    }

    #[test]
    fn other_drivers_are_ignored() {
        let info = "drm-driver:\tamdgpu\ndrm-client-id:\t1\ndrm-engine-gfx:\t10 ns\n";
        assert!(intel::parse(info).is_none());
    }

    #[test]
    fn card_names_skip_connectors() {
        assert!(is_card("card0"));
        assert!(is_card("card12"));
        assert!(!is_card("card0-DP-1"));
        assert!(!is_card("renderD128"));
    }

    #[test]
    fn collected_values_stay_in_range() {
        let metrics = collect();
        for value in [metrics.battery, metrics.memory, metrics.cpu, metrics.gpu] {
            assert!((0.0..=1.0).contains(&value), "{value}");
        }
    }
}