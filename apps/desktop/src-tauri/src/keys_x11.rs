//! X11 键码映射：物理键位还原到与 Windows 一致的虚拟键码。

use std::collections::HashMap;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::ConnectionExt;
use x11rb::rust_connection::RustConnection;

pub fn key_map(conn: &RustConnection) -> HashMap<u8, u32> {
    let setup = conn.setup();
    let min = setup.min_keycode;
    let count = setup.max_keycode.saturating_sub(min).saturating_add(1);
    let Some(reply) = conn
        .get_keyboard_mapping(min, count)
        .ok()
        .and_then(|cookie| cookie.reply().ok())
    else {
        return HashMap::new();
    };
    let per = reply.keysyms_per_keycode.max(1) as usize;
    let mut keys = HashMap::new();
    for index in 0..count as usize {
        let keysym = reply.keysyms.get(index * per).copied().unwrap_or(0);
        let vk = keysym_to_vk(keysym);
        if vk != 0 {
            keys.insert(min.wrapping_add(index as u8), vk);
        }
    }
    keys
}

pub fn keysym_to_vk(keysym: u32) -> u32 {
    match keysym {
        0x08 => 0x08,
        0x09 | 0xfe20 => 0x09,
        0x0d => 0x0d,
        0x1b => 0x1b,
        0x20 => 0x20,
        0x30..=0x39 => keysym,
        0x61..=0x7a => keysym - 0x20,
        0x2d => 0xbd,
        0x3d => 0xbb,
        0x5b => 0xdb,
        0x5d => 0xdd,
        0x5c => 0xdc,
        0x3b => 0xba,
        0x27 => 0xde,
        0x2c => 0xbc,
        0x2e => 0xbe,
        0x2f => 0xbf,
        0x60 => 0xc0,
        0xffe1 => 0xa0,
        0xffe2 => 0xa1,
        0xffe3 => 0xa2,
        0xffe4 => 0xa3,
        0xffe9 => 0xa4,
        0xffea => 0xa5,
        0xffeb | 0xffe7 | 0xffe8 => 0x5b,
        0xffec => 0x5c,
        0xff50 => 0x24,
        0xff57 => 0x23,
        0xff55 => 0x21,
        0xff56 => 0x22,
        0xff63 => 0x2d,
        0xffff => 0x2e,
        0xff51..=0xff54 => 0x25 + (keysym - 0xff51),
        0xffbe..=0xffd5 => 0x70 + (keysym - 0xffbe),
        0xffe5 => 0x14,
        0xff7f => 0x90,
        0xff14 => 0x91,
        0xff61 => 0x2c,
        0xff13 => 0x13,
        0xff67 => 0x5d,
        0xff8d => 0x0d,
        0xffb0..=0xffb9 => 0x60 + (keysym - 0xffb0),
        0xffae | 0xffac => 0x6e,
        0xffab => 0x6b,
        0xffad => 0x6d,
        0xffaa => 0x6a,
        0xffaf => 0x6f,
        0xffbd => 0x92,
        0x1008ff12 => 0xad,
        0x1008ff11 => 0xae,
        0x1008ff13 => 0xaf,
        0x1008ff17 => 0xb0,
        0x1008ff16 => 0xb1,
        0x1008ff15 => 0xb2,
        0x1008ff14 => 0xb3,
        0x1008ff19 => 0xb4,
        _ => 0,
    }
}
