//! 系统占用指标：电池、内存、CPU、GPU，返回 0-1 的百分比给 BOSS 血条数据映射。

#![allow(non_snake_case)]

use serde::Serialize;

#[derive(Clone, Copy, Default, Serialize)]
pub struct SystemMetrics {
    pub battery: f64,
    pub memory: f64,
    pub cpu: f64,
    pub gpu: f64,
}

#[cfg(windows)]
mod imp {
    use super::SystemMetrics;
    use std::sync::Mutex;

    #[repr(C)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        reserved1: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }

    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    fn file_time_value(time: FileTime) -> u64 {
        ((time.high as u64) << 32) | time.low as u64
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
    }

    // PDH_FMT_COUNTERVALUE 的状态字加联合体，按 8 字节对齐补位
    #[repr(C)]
    struct PdhFmtCounterValue {
        status: u32,
        padding: u32,
        value: f64,
    }

    #[repr(C)]
    struct PdhFmtCounterValueItem {
        name: *const u16,
        value: PdhFmtCounterValue,
    }

    #[link(name = "pdh")]
    extern "system" {
        fn PdhOpenQueryW(data_source: *const u16, user_data: usize, query: *mut isize) -> u32;
        fn PdhAddEnglishCounterW(query: isize, path: *const u16, user_data: usize, counter: *mut isize) -> u32;
        fn PdhCollectQueryData(query: isize) -> u32;
        fn PdhGetFormattedCounterArrayW(
            counter: isize,
            format: u32,
            buffer_size: *mut u32,
            item_count: *mut u32,
            buffer: *mut PdhFmtCounterValueItem,
        ) -> u32;
        fn PdhCloseQuery(query: isize) -> u32;
    }

    const PDH_FMT_DOUBLE: u32 = 0x0000_0200;
    const PDH_MORE_DATA: u32 = 0x8000_07D2;
    const PDH_INVALID_DATA: u32 = 0xC000_0BBA;

    struct GpuQuery {
        query: isize,
        counter: isize,
    }

    static GPU_QUERY: Mutex<Option<GpuQuery>> = Mutex::new(None);
    static CPU_SAMPLE: Mutex<Option<[u64; 3]>> = Mutex::new(None);

    fn open_gpu_query() -> Option<GpuQuery> {
        let path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage\0".encode_utf16().collect();
        let mut query = 0isize;
        let mut counter = 0isize;

        unsafe {
            if PdhOpenQueryW(std::ptr::null(), 0, &mut query) != 0 {
                return None;
            }
            if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
                PdhCloseQuery(query);
                return None;
            }
        }

        Some(GpuQuery { query, counter })
    }

    fn gpu_usage() -> f64 {
        let mut guard = match GPU_QUERY.lock() {
            Ok(guard) => guard,
            Err(_) => return 0.0,
        };
        if guard.is_none() {
            *guard = open_gpu_query();
        }
        let Some(gpu) = guard.as_ref() else {
            return 0.0;
        };

        unsafe {
            // 速率计数需要至少两次采样，第一次调用只建立基准
            if PdhCollectQueryData(gpu.query) != 0 {
                *guard = None;
                return 0.0;
            }

            let mut size = 0u32;
            let mut count = 0u32;
            let status = PdhGetFormattedCounterArrayW(
                gpu.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                std::ptr::null_mut(),
            );
            if status != PDH_MORE_DATA || size == 0 {
                return 0.0;
            }

            let item_size = std::mem::size_of::<PdhFmtCounterValueItem>();
            let capacity = (size as usize / item_size) + 1;
            let mut buffer: Vec<PdhFmtCounterValueItem> = Vec::with_capacity(capacity);
            buffer.resize_with(capacity, || PdhFmtCounterValueItem {
                name: std::ptr::null(),
                value: PdhFmtCounterValue { status: 0, padding: 0, value: 0.0 },
            });

            let status = PdhGetFormattedCounterArrayW(
                gpu.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                buffer.as_mut_ptr(),
            );
            if status != 0 && status != PDH_INVALID_DATA {
                return 0.0;
            }

            // 各进程的同类型引擎会重复计数，累加后截到 100%
            let mut total = 0.0;
            for item in buffer.iter().take(count as usize) {
                if item.value.status != 0 || item.name.is_null() {
                    continue;
                }
                let mut len = 0usize;
                while *item.name.add(len) != 0 {
                    len += 1;
                }
                let name = String::from_utf16_lossy(std::slice::from_raw_parts(item.name, len));
                if name.contains("engtype_3D") {
                    total += item.value.value;
                }
            }

            (total / 100.0).clamp(0.0, 1.0)
        }
    }

    fn battery_level() -> f64 {
        let mut status = SystemPowerStatus {
            ac_line_status: 0,
            battery_flag: 0,
            battery_life_percent: 255,
            system_status_flag: 0,
            reserved1: 0,
            battery_life_time: 0,
            battery_full_life_time: 0,
        };
        let ok = unsafe { GetSystemPowerStatus(&mut status) } != 0;
        if !ok || status.battery_life_percent == 255 {
            return 0.0;
        }
        f64::from(status.battery_life_percent) / 100.0
    }

    fn memory_usage() -> f64 {
        let mut status = MemoryStatusEx {
            length: std::mem::size_of::<MemoryStatusEx>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page_file: 0,
            avail_page_file: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended_virtual: 0,
        };
        let ok = unsafe { GlobalMemoryStatusEx(&mut status) } != 0;
        if !ok {
            return 0.0;
        }
        f64::from(status.memory_load) / 100.0
    }

    fn cpu_usage() -> f64 {
        let mut idle = FileTime { low: 0, high: 0 };
        let mut kernel = FileTime { low: 0, high: 0 };
        let mut user = FileTime { low: 0, high: 0 };
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
            return 0.0;
        }

        let current = [
            file_time_value(idle),
            file_time_value(kernel),
            file_time_value(user),
        ];

        let mut guard = match CPU_SAMPLE.lock() {
            Ok(guard) => guard,
            Err(_) => return 0.0,
        };
        let previous = guard.replace(current);
        let Some(previous) = previous else {
            return 0.0;
        };

        let idle_delta = current[0].saturating_sub(previous[0]);
        // kernel 时间已经包含 idle
        let total_delta = current[1].saturating_sub(previous[1]) + current[2].saturating_sub(previous[2]);
        if total_delta == 0 {
            return 0.0;
        }
        (1.0 - idle_delta as f64 / total_delta as f64).clamp(0.0, 1.0)
    }

    pub fn collect() -> SystemMetrics {
        SystemMetrics {
            battery: battery_level(),
            memory: memory_usage(),
            cpu: cpu_usage(),
            gpu: gpu_usage(),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::SystemMetrics;

    pub fn collect() -> SystemMetrics {
        SystemMetrics { battery: 0.0, memory: 0.0, cpu: 0.0, gpu: 0.0 }
    }
}

pub fn collect() -> SystemMetrics {
    imp::collect()
}
