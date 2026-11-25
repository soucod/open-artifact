//! The WebAssembly facade: a palette builder and a GIF encoder fed one
//! frame at a time, a MOV encoder, and the flash analyzer.

use wasm_bindgen::prelude::*;

use crate::{flash, gif, mov};

/// Collects sample frames and picks a GIF palette for them.
#[wasm_bindgen]
pub struct GifPaletteBuilder {
    builder: gif::PaletteBuilder,
}

#[wasm_bindgen]
impl GifPaletteBuilder {
    /// A builder; `fast` samples fewer pixels and refines less.
    #[wasm_bindgen(constructor)]
    pub fn new(fast: bool) -> GifPaletteBuilder {
        GifPaletteBuilder { builder: gif::PaletteBuilder::new(fast) }
    }

    /// Adds a frame of RGBA pixels.
    pub fn add(&mut self, rgba: &[u8]) {
        self.builder.add(rgba);
    }

    /// The palette as RGB triples (at most 255 colors).
    pub fn finish(&self) -> Vec<u8> {
        self.builder.finish()
    }
}

/// A GIF being written.
#[wasm_bindgen]
pub struct GifEncoder {
    encoder: gif::Encoder,
}

#[wasm_bindgen]
impl GifEncoder {
    /// A looping GIF of `width` × `height` with a shared palette (RGB
    /// triples); `repeat` plays after the first (0: for ever).
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, palette: &[u8], repeat: u16) -> Result<GifEncoder, JsError> {
        let encoder = gif::Encoder::new(width, height, palette, repeat).map_err(|error| JsError::new(&error.to_string()))?;
        Ok(GifEncoder { encoder })
    }

    /// Adds a frame of RGBA pixels shown `delay_cs` hundredths of a second;
    /// the bytes it added (0: unchanged, the frame before shows longer).
    pub fn add(&mut self, rgba: &[u8], delay_cs: u16) -> Result<u32, JsError> {
        let added = self.encoder.add(rgba, delay_cs).map_err(|error| JsError::new(&error.to_string()))?;
        Ok(added as u32)
    }

    /// Bytes written so far.
    #[wasm_bindgen(getter, js_name = byteLength)]
    pub fn byte_length(&self) -> f64 {
        self.encoder.byte_length() as f64
    }

    /// The bytes written so far that no later frame changes (handed out once).
    #[wasm_bindgen(js_name = takeReady)]
    pub fn take_ready(&mut self) -> Vec<u8> {
        self.encoder.take_ready()
    }

    /// Ends the GIF; the bytes not handed out yet.
    pub fn finish(&mut self) -> Vec<u8> {
        self.encoder.finish()
    }
}

/// A MOV being laid out. The caller keeps the bytes of each frame and the
/// sound, and puts them after the header in the order of `pieces`.
#[wasm_bindgen]
pub struct MovEncoder {
    encoder: mov::RleEncoder,
    movie: mov::Movie,
    pieces: Vec<mov::Piece>,
}

#[wasm_bindgen]
impl MovEncoder {
    /// A movie of `width` × `height` at `fps`, a key frame every `key_every`
    /// frames; `repeats` is "unchanged", "shared" or "whole".
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, fps: f64, key_every: u32, repeats: &str) -> Result<MovEncoder, JsError> {
        let repeats = match repeats {
            "unchanged" => mov::Repeats::Unchanged,
            "shared" => mov::Repeats::Shared,
            "whole" => mov::Repeats::Whole,
            other => return Err(JsError::new(&format!("no such way to store repeats: {other}"))),
        };
        if width > u16::MAX as u32 || height > u16::MAX as u32 {
            return Err(JsError::new("a MOV frame is at most 65535 pixels a side"));
        }
        let encoder = mov::RleEncoder::new(width, height, key_every).map_err(|error| JsError::new(&error.to_string()))?;
        Ok(MovEncoder { encoder, movie: mov::Movie::new(width as u16, height as u16, fps, repeats), pieces: Vec::new() })
    }

    /// Adds a frame of RGBA pixels; the bytes to keep for it (empty: it
    /// shares the bytes of the frame before).
    pub fn add(&mut self, rgba: &[u8]) -> Result<Vec<u8>, JsError> {
        let sample = self.encoder.encode(rgba).map_err(|error| JsError::new(&error.to_string()))?;
        Ok(match self.movie.add(&sample) {
            mov::Stored::Bytes(bytes) => bytes.to_vec(),
            mov::Stored::SharesPrevious => Vec::new(),
        })
    }

    /// Bytes of the frames kept so far.
    #[wasm_bindgen(getter, js_name = byteLength)]
    pub fn byte_length(&self) -> f64 {
        self.movie.bytes() as f64
    }

    /// Ends the movie with `sound_frames` sample frames of 16-bit PCM (0:
    /// silent); the bytes ahead of the samples.
    pub fn finish(&mut self, sound_frames: f64, sample_rate: u32, channels: u16) -> Vec<u8> {
        let sound = (sound_frames >= 1.0).then_some(mov::Sound { frames: sound_frames as u64, sample_rate, channels });
        let (header, pieces) = self.movie.finish(sound);
        self.pieces = pieces;
        header
    }

    /// What follows the header after `finish`, as triples: `0, frame, 0` for
    /// a frame's bytes and `1, from, to` for those PCM sample frames.
    pub fn pieces(&self) -> Vec<f64> {
        self.pieces
            .iter()
            .flat_map(|piece| match *piece {
                mov::Piece::Frame(index) => [0.0, index as f64, 0.0],
                mov::Piece::Sound { from, to } => [1.0, from as f64, to as f64],
            })
            .collect()
    }
}

/// Flash analysis of frames sampled at 30 fps.
#[wasm_bindgen]
pub struct FlashAnalyzer {
    analyzer: flash::FlashAnalyzer,
}

#[wasm_bindgen]
impl FlashAnalyzer {
    /// An analyzer judging flashes that reach into frames `from_frame`..`to_frame`.
    #[wasm_bindgen(constructor)]
    pub fn new(from_frame: u32, to_frame: u32) -> FlashAnalyzer {
        FlashAnalyzer { analyzer: flash::FlashAnalyzer::new(from_frame, to_frame) }
    }

    /// Adds the next frame of RGBA pixels, `width` wide.
    pub fn add(&mut self, rgba: &[u8], width: u32) -> Result<(), JsError> {
        self.analyzer.add(rgba, width as usize).map_err(|error| JsError::new(&error.to_string()))
    }

    /// Frames seen.
    #[wasm_bindgen(getter)]
    pub fn frames(&self) -> u32 {
        self.analyzer.frames()
    }

    /// The fastest three flashes: their first and last transition frames, or empty.
    pub fn fastest(&self) -> Vec<u32> {
        self.analyzer.fastest().map_or_else(Vec::new, |burst| vec![burst.first, burst.last])
    }

    /// The least share of its length the stretch can be shortened to (0: any, 1: none).
    #[wasm_bindgen(js_name = safeScale)]
    pub fn safe_scale(&self) -> f64 {
        self.analyzer.safe_scale()
    }
}
