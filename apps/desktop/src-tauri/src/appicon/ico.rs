//! ICO 目录读写：源图缩放为多尺寸，解析构建时内置的原始图标。

use image::{DynamicImage, ImageFormat, RgbaImage};

pub const SIZES: [u32; 7] = [16, 24, 32, 48, 64, 128, 256];

pub struct Entry {
    pub width: u32,
    pub height: u32,
    pub planes: u16,
    pub bit_count: u16,
    pub data: Vec<u8>,
}

/// 动画贴图是竖向帧条，只取顶部方形区域作为图标源
pub fn square_source(bytes: &[u8]) -> Result<RgbaImage, String> {
    let image = image::load_from_memory(bytes).map_err(|error| error.to_string())?;
    let side = image.width().min(image.height());
    if side == 0 {
        return Err("图标图片为空".into());
    }
    Ok(image::imageops::crop_imm(&image, 0, 0, side, side).to_image())
}

pub fn resize(source: &RgbaImage, size: u32) -> RgbaImage {
    image::imageops::resize(source, size, size, image::imageops::FilterType::Nearest)
}

pub fn entries(source: &RgbaImage) -> Result<Vec<Entry>, String> {
    SIZES
        .iter()
        .map(|size| {
            let image = resize(source, *size);
            let mut data = Vec::new();
            DynamicImage::ImageRgba8(image)
                .write_to(&mut std::io::Cursor::new(&mut data), ImageFormat::Png)
                .map_err(|error| error.to_string())?;
            Ok(Entry {
                width: *size,
                height: *size,
                planes: 1,
                bit_count: 32,
                data,
            })
        })
        .collect()
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    if bytes.len() < 6 || u16::from_le_bytes([bytes[0], bytes[1]]) != 0 {
        return Err("图标文件格式无效".into());
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    let mut entries = Vec::with_capacity(count);

    for index in 0..count {
        let offset = 6 + index * 16;
        if bytes.len() < offset + 16 {
            return Err("图标目录不完整".into());
        }
        let side = |value: u8| if value == 0 { 256 } else { value as u32 };
        let width = side(bytes[offset]);
        let height = side(bytes[offset + 1]);
        let planes = u16::from_le_bytes([bytes[offset + 4], bytes[offset + 5]]);
        let bit_count = u16::from_le_bytes([bytes[offset + 6], bytes[offset + 7]]);
        let size = u32::from_le_bytes([
            bytes[offset + 8],
            bytes[offset + 9],
            bytes[offset + 10],
            bytes[offset + 11],
        ]) as usize;
        let start = u32::from_le_bytes([
            bytes[offset + 12],
            bytes[offset + 13],
            bytes[offset + 14],
            bytes[offset + 15],
        ]) as usize;

        let end = start.checked_add(size).ok_or("图标数据越界")?;
        if end > bytes.len() {
            return Err("图标数据不完整".into());
        }
        entries.push(Entry {
            width,
            height,
            planes: if planes == 0 { 1 } else { planes },
            bit_count: if bit_count == 0 { 32 } else { bit_count },
            data: bytes[start..end].to_vec(),
        });
    }

    if entries.is_empty() {
        return Err("图标文件没有图像".into());
    }
    Ok(entries)
}

fn dimension(value: u32) -> u8 {
    if value >= 256 {
        0
    } else {
        value as u8
    }
}

/// RT_GROUP_ICON 数据，图像编号从 1 开始
pub fn group(entries: &[Entry]) -> Vec<u8> {
    let mut out = Vec::with_capacity(6 + entries.len() * 14);
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    for (index, entry) in entries.iter().enumerate() {
        out.push(dimension(entry.width));
        out.push(dimension(entry.height));
        out.push(0);
        out.push(0);
        out.extend_from_slice(&entry.planes.to_le_bytes());
        out.extend_from_slice(&entry.bit_count.to_le_bytes());
        out.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&((index + 1) as u16).to_le_bytes());
    }
    out
}

/// 完整 ICO 文件，供提权进程读取
pub fn file(entries: &[Entry]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());

    let mut offset = 6 + entries.len() * 16;
    for entry in entries {
        out.push(dimension(entry.width));
        out.push(dimension(entry.height));
        out.push(0);
        out.push(0);
        out.extend_from_slice(&entry.planes.to_le_bytes());
        out.extend_from_slice(&entry.bit_count.to_le_bytes());
        out.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(offset as u32).to_le_bytes());
        offset += entry.data.len();
    }
    for entry in entries {
        out.extend_from_slice(&entry.data);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_generated_ico() {
        let source = image::RgbaImage::from_pixel(16, 16, image::Rgba([210, 40, 40, 255]));
        let entries = entries(&source).unwrap();
        let parsed = parse(&file(&entries)).unwrap();
        assert_eq!(parsed.len(), SIZES.len());
        assert_eq!(parsed.first().unwrap().width, 16);
        assert_eq!(parsed.last().unwrap().width, 256);
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::os::windows::ffi::OsStrExt;

    const IMAGE_ICON: u32 = 1;
    const LR_LOADFROMFILE: u32 = 0x10;

    #[link(name = "user32")]
    extern "system" {
        fn LoadImageW(
            instance: isize,
            name: *const u16,
            kind: u32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> isize;
        fn DestroyIcon(icon: isize) -> i32;
    }

    #[test]
    fn windows_loads_generated_ico() {
        let source = image::RgbaImage::from_pixel(16, 16, image::Rgba([30, 160, 90, 255]));
        let entries = entries(&source).unwrap();
        let path = std::env::temp_dir().join(format!("craftsharp-ico-test-{}.ico", std::process::id()));
        std::fs::write(&path, file(&entries)).unwrap();

        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let icon = unsafe { LoadImageW(0, wide.as_ptr(), IMAGE_ICON, 32, 32, LR_LOADFROMFILE) };
        assert_ne!(icon, 0, "Windows 无法读取生成的 ICO");
        unsafe {
            DestroyIcon(icon);
        }
        let _ = std::fs::remove_file(&path);
    }
}
