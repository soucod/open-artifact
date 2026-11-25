//! Pixel work of the Video type, done per pixel and per frame:
//!
//! - GIF export: a shared palette from sample frames (exact colors when few,
//!   flat colors kept, median cut refined by a few k-means rounds), ordered
//!   dithering where a color is far from the palette, only the changed
//!   rectangle of each frame written (unchanged pixels transparent), a local
//!   palette for frames the shared one fits badly, and LZW coding.
//! - Flash analysis: whether a scene flashes more than three times a second
//!   over a large enough area (WCAG 2.3.1 general flashes), and so how much
//!   shorter it may be made.
//! - MOV export: QuickTime Animation frames that keep the alpha channel,
//!   only the changed lines of each frame written, and the movie atoms
//!   around them with 16-bit PCM sound.
//!
//! Compiled to WebAssembly by `scripts/build-wasm.mjs` into `packages/wasm-motion`.

pub mod flash;
pub mod gif;
pub mod mov;

#[cfg(target_arch = "wasm32")]
mod wasm;
