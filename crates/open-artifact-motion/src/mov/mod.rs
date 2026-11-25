//! MOV export: QuickTime Animation (`rle `, 32-bit ARGB with alpha) frames
//! and 16-bit PCM sound, for laying a transparent film over footage.

pub mod movie;
pub mod rle;

pub use movie::{Movie, Piece, Repeats, Sound, Stored, UNCHANGED_SAMPLE};
pub use rle::{RleEncoder, RleError, RleSample};
