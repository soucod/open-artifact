//! GIF export: palettes, the frame encoder and LZW coding.

mod encoder;
mod lzw;
mod palette;
mod quantize;

pub use encoder::{Encoder, EncoderError};
pub use palette::Palette;
pub use quantize::PaletteBuilder;

/// How much each channel's difference counts when matching colors (the eye
/// is most sensitive to green, least to blue).
const COLOR_WEIGHTS: [f64; 3] = [0.9, 1.77, 0.33];

fn color_distance(red: f64, green: f64, blue: f64) -> f64 {
    red * red * COLOR_WEIGHTS[0] + green * green * COLOR_WEIGHTS[1] + blue * blue * COLOR_WEIGHTS[2]
}

/// The pixels of an RGBA buffer as little-endian words: red in the low byte.
fn pixels(rgba: &[u8]) -> impl Iterator<Item = u32> + '_ {
    rgba.chunks_exact(4).map(|pixel| u32::from_le_bytes([pixel[0], pixel[1], pixel[2], pixel[3]]))
}

/// The RGB bytes of colors packed as `red | green << 8 | blue << 16`.
fn packed_to_rgb(colors: impl IntoIterator<Item = u32>) -> Vec<u8> {
    colors.into_iter().flat_map(|color| [color as u8, (color >> 8) as u8, (color >> 16) as u8]).collect()
}
