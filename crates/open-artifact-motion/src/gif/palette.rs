//! A GIF color table and the nearest-color lookup over it.

use super::color_distance;

/// Lookup cells: 7 bits per channel.
const NEAR_CELLS: usize = 1 << 21;

fn near_cell(red: u8, green: u8, blue: u8) -> usize {
    (((red >> 1) as usize) << 14) | (((green >> 1) as usize) << 7) | (blue >> 1) as usize
}

/// Up to 255 colors; the index after the last one is the transparent one.
pub struct Palette {
    rgb: Vec<u8>,
    colors: usize,
    /// Bits per index (the table is written padded to `1 << bits` entries).
    bits: u8,
    /// Each color as `red | green << 8 | blue << 16`.
    packed: Vec<u32>,
    /// The color picked for each lookup cell, -1 until asked.
    near: Vec<i16>,
}

impl Palette {
    /// A palette of RGB triples (at most 255 colors; none gives one black).
    pub fn new(rgb: &[u8]) -> Result<Palette, String> {
        if !rgb.len().is_multiple_of(3) {
            return Err("A palette holds RGB triples.".into());
        }
        if rgb.len() > 255 * 3 {
            return Err("A palette holds at most 255 colors.".into());
        }
        let rgb = if rgb.is_empty() { vec![0, 0, 0] } else { rgb.to_vec() };
        let colors = rgb.len() / 3;
        let bits = (usize::BITS - colors.leading_zeros()).max(1) as u8;
        let packed: Vec<u32> = rgb.chunks_exact(3).map(|c| c[0] as u32 | (c[1] as u32) << 8 | (c[2] as u32) << 16).collect();
        let mut near = vec![-1i16; NEAR_CELLS];
        // Exact colors find themselves; the first of equal colors wins.
        for (index, color) in rgb.chunks_exact(3).enumerate().rev() {
            near[near_cell(color[0], color[1], color[2])] = index as i16;
        }
        Ok(Palette { rgb, colors, bits, packed, near })
    }

    pub fn colors(&self) -> usize {
        self.colors
    }

    pub fn bits(&self) -> u8 {
        self.bits
    }

    pub fn transparent(&self) -> u8 {
        self.colors as u8
    }

    pub fn rgb(&self) -> &[u8] {
        &self.rgb
    }

    pub fn packed(&self, index: usize) -> u32 {
        self.packed[index]
    }

    pub fn channel(&self, index: usize, channel: usize) -> u8 {
        self.rgb[index * 3 + channel]
    }

    /// The index of the color nearest to this one. The answer is kept for
    /// the color's lookup cell, so later colors in the cell share it.
    pub fn nearest(&mut self, red: u8, green: u8, blue: u8) -> usize {
        let cell = near_cell(red, green, blue);
        if self.near[cell] >= 0 {
            return self.near[cell] as usize;
        }
        let mut best = f64::INFINITY;
        let mut found = 0;
        for (index, color) in self.rgb.chunks_exact(3).enumerate() {
            let distance = color_distance(
                red as f64 - color[0] as f64,
                green as f64 - color[1] as f64,
                blue as f64 - color[2] as f64,
            );
            if distance < best {
                best = distance;
                found = index;
            }
        }
        self.near[cell] = found as i16;
        found
    }

    /// Writes the color table, padded with black to `1 << bits` entries.
    pub fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.rgb);
        out.resize(out.len() + (3 << self.bits) - self.rgb.len(), 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_cover_the_transparent_index() {
        assert_eq!(Palette::new(&[0; 3]).unwrap().bits(), 1);
        assert_eq!(Palette::new(&[0; 9]).unwrap().bits(), 2);
        assert_eq!(Palette::new(&[0; 12]).unwrap().bits(), 3);
        assert_eq!(Palette::new(&[0; 765]).unwrap().bits(), 8);
        assert!(Palette::new(&[0; 768]).is_err());
    }

    #[test]
    fn nearest_prefers_green_accuracy() {
        let mut palette = Palette::new(&[0, 0, 0, 255, 255, 255, 200, 0, 0]).unwrap();
        assert_eq!(palette.nearest(250, 250, 250), 1);
        assert_eq!(palette.nearest(190, 10, 10), 2);
        assert_eq!(palette.nearest(0, 0, 0), 0);
        let mut out = Vec::new();
        palette.write(&mut out);
        assert_eq!(out.len(), 12);
    }
}
