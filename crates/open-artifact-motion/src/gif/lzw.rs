//! GIF's variable-width LZW coding of an image's color indices, written as
//! data sub-blocks.

const MAX_CODES: u16 = 4096;
const HASH_BITS: u32 = 13;
const HASH_MASK: usize = (1 << HASH_BITS) - 1;

/// Packs codes LSB-first into sub-blocks of at most 255 bytes.
struct CodeWriter<'a> {
    out: &'a mut Vec<u8>,
    block: [u8; 255],
    block_length: usize,
    bits: u32,
    bit_count: u32,
    code_bits: u32,
}

impl CodeWriter<'_> {
    fn flush_block(&mut self) {
        if self.block_length == 0 {
            return;
        }
        self.out.push(self.block_length as u8);
        self.out.extend_from_slice(&self.block[..self.block_length]);
        self.block_length = 0;
    }

    fn push_byte(&mut self, byte: u8) {
        self.block[self.block_length] = byte;
        self.block_length += 1;
        if self.block_length == 255 {
            self.flush_block();
        }
    }

    /// Writes a code; then widens codes once `next_code` no longer fits.
    fn write(&mut self, code: u16, next_code: u16) {
        self.bits |= (code as u32) << self.bit_count;
        self.bit_count += self.code_bits;
        while self.bit_count >= 8 {
            self.push_byte(self.bits as u8);
            self.bits >>= 8;
            self.bit_count -= 8;
        }
        if next_code as u32 > (1 << self.code_bits) - 1 && self.code_bits < 12 {
            self.code_bits += 1;
        }
    }
}

/// Writes the image data of `indices`: the minimum code size, the coded
/// sub-blocks and the block terminator.
pub fn write(out: &mut Vec<u8>, indices: &[u8], min_code_size: u8) {
    out.push(min_code_size);
    let clear_code: u16 = 1 << min_code_size;
    let end_code = clear_code + 1;
    let first_code = end_code + 1;
    let mut next_code = first_code;
    let mut writer = CodeWriter { out, block: [0; 255], block_length: 0, bits: 0, bit_count: 0, code_bits: min_code_size as u32 + 1 };
    // Open addressing over (prefix code, next index) → code.
    let mut keys = vec![-1i32; 1 << HASH_BITS];
    let mut codes = vec![0u16; 1 << HASH_BITS];
    writer.write(clear_code, next_code);
    let Some((&first, rest)) = indices.split_first() else {
        writer.write(end_code, next_code);
        writer.flush_block();
        writer.out.push(0);
        return;
    };
    let mut prefix = first as u16;
    for &index in rest {
        let key = ((prefix as i32) << 8) | index as i32;
        let mut slot = ((key as u32).wrapping_mul(2654435761) >> (32 - HASH_BITS)) as usize;
        while keys[slot] != -1 && keys[slot] != key {
            slot = (slot + 1) & HASH_MASK;
        }
        if keys[slot] == key {
            prefix = codes[slot];
            continue;
        }
        writer.write(prefix, next_code);
        if next_code < MAX_CODES {
            keys[slot] = key;
            codes[slot] = next_code;
            next_code += 1;
        } else {
            writer.write(clear_code, next_code);
            keys.fill(-1);
            next_code = first_code;
            writer.code_bits = min_code_size as u32 + 1;
        }
        prefix = index as u16;
    }
    writer.write(prefix, next_code);
    writer.write(end_code, next_code);
    if writer.bit_count > 0 {
        writer.push_byte(writer.bits as u8);
    }
    writer.flush_block();
    writer.out.push(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decodes GIF LZW sub-blocks back to indices (the reader's side of the format).
    fn decode(data: &[u8]) -> Vec<u8> {
        let min_code_size = data[0] as u32;
        let mut bytes = Vec::new();
        let mut at = 1;
        while data[at] != 0 {
            let length = data[at] as usize;
            bytes.extend_from_slice(&data[at + 1..at + 1 + length]);
            at += 1 + length;
        }
        assert_eq!(at, data.len() - 1, "one terminator at the end");
        let clear = 1u32 << min_code_size;
        let end = clear + 1;
        let mut table: Vec<Vec<u8>> = Vec::new();
        let reset = |table: &mut Vec<Vec<u8>>| {
            table.clear();
            for code in 0..clear {
                table.push(vec![code as u8]);
            }
            table.push(Vec::new());
            table.push(Vec::new());
        };
        reset(&mut table);
        let mut code_bits = min_code_size + 1;
        let (mut bits, mut bit_count, mut byte_at) = (0u32, 0u32, 0usize);
        let mut previous: Option<Vec<u8>> = None;
        let mut out = Vec::new();
        loop {
            while bit_count < code_bits {
                bits |= (bytes[byte_at] as u32) << bit_count;
                byte_at += 1;
                bit_count += 8;
            }
            let code = bits & ((1 << code_bits) - 1);
            bits >>= code_bits;
            bit_count -= code_bits;
            if code == clear {
                reset(&mut table);
                code_bits = min_code_size + 1;
                previous = None;
                continue;
            }
            if code == end {
                break;
            }
            let entry = if (code as usize) < table.len() {
                table[code as usize].clone()
            } else {
                let mut entry = previous.clone().unwrap();
                entry.push(entry[0]);
                entry
            };
            if let Some(mut grown) = previous.take()
                && table.len() < 4096
            {
                grown.push(entry[0]);
                table.push(grown);
            }
            out.extend_from_slice(&entry);
            previous = Some(entry);
            if table.len() == 1 << code_bits && code_bits < 12 {
                code_bits += 1;
            }
        }
        out
    }

    #[test]
    fn round_trips_through_a_decoder() {
        let mut seed = 7u32;
        let noise: Vec<u8> = (0..70_000)
            .map(|_| {
                seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
                ((seed >> 16) % 200) as u8
            })
            .collect();
        let runs: Vec<u8> = (0..50_000u32).map(|i| ((i / 37) % 5) as u8).collect();
        for (indices, size) in [(noise, 8u8), (runs, 3), (vec![1], 2), (vec![0, 0, 0], 2)] {
            let mut out = Vec::new();
            write(&mut out, &indices, size);
            assert_eq!(decode(&out), indices);
        }
    }
}
