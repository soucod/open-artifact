//! The GIF writer: a looping animation where each frame is written as the
//! rectangle that changed, its unchanged pixels transparent over the frame
//! before, and a frame that changes nothing only lengthens the one before.

use super::{Palette, PaletteBuilder, lzw, pixels};

/// A color this far (sum over channels) from its nearest palette color is dithered.
const DITHER_COLOR_ERROR: i32 = 8;
const DITHER_STRENGTH: f64 = 12.0;
/// A frame whose mean squared error against the shared palette is above
/// this may get a palette of its own.
const LOCAL_PALETTE_ERROR: f64 = 30.0;
/// After this many own palettes in a row that were not worth it, stop
/// trying for similar frames…
const FUTILE_TRIES: u32 = 3;
/// …until this many frames have gone by without a try.
const UNTRIED_FRAMES: u32 = 12;

/// The 8×8 ordered dither matrix (Bayer), centred on zero.
fn dither_matrix() -> [f32; 64] {
    std::array::from_fn(|cell| {
        let mut rank = 0usize;
        for bit in 0..3 {
            let (x, y) = (((cell & 7) >> bit) & 1, ((cell >> 3) >> bit) & 1);
            rank = rank * 4 + ((x ^ y) * 2 + y);
        }
        ((rank as f64 + 0.5) / 64.0 - 0.5) as f32
    })
}

fn clamp_channel(value: f64) -> u8 {
    if value < 0.0 {
        0
    } else if value > 255.0 {
        255
    } else {
        value as u8
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum EncoderError {
    Size,
    Pixels { expected: usize, got: usize },
    Palette(String),
}

impl std::fmt::Display for EncoderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncoderError::Size => write!(f, "A GIF is 1 to 65535 pixels wide and high."),
            EncoderError::Pixels { expected, got } => write!(f, "A frame takes {expected} bytes of RGBA, not {got}."),
            EncoderError::Palette(why) => f.write_str(why),
        }
    }
}

/// When trying a frame's own palette is worth it.
#[derive(Clone, Copy, Default)]
struct LocalPaletteTries {
    /// Own palettes in a row that did not halve the error.
    futile: u32,
    /// The error when the last futile try was made.
    error: f64,
    /// Frames since the last try.
    untried: u32,
}

impl LocalPaletteTries {
    fn worth_trying(&self, error: f64) -> bool {
        error > LOCAL_PALETTE_ERROR
            && (self.futile < FUTILE_TRIES || error > self.error * 2.0 || error < self.error / 2.0 || self.untried >= UNTRIED_FRAMES)
    }

    fn after(self, error: f64, tried: Option<bool>) -> LocalPaletteTries {
        match tried {
            None => LocalPaletteTries { untried: self.untried + 1, ..self },
            Some(true) => LocalPaletteTries { futile: 0, error: self.error, untried: 0 },
            Some(false) => LocalPaletteTries { futile: self.futile + 1, error, untried: 0 },
        }
    }
}

pub struct Encoder {
    width: usize,
    height: usize,
    palette: Palette,
    /// Bytes not yet handed out.
    out: Vec<u8>,
    /// Bytes handed out before `out`.
    taken: usize,
    /// Where the last written frame's delay is (it grows when frames repeat), from the start of the file.
    last_delay_at: Option<usize>,
    /// The pixels of the frame before, as given.
    previous: Vec<u32>,
    /// The color each pixel shows now (`red | green << 8 | blue << 16`).
    shown: Vec<u32>,
    indices: Vec<u8>,
    frames: u32,
    tries: LocalPaletteTries,
    local: PaletteBuilder,
    dither: [f32; 64],
    finished: bool,
}

impl Encoder {
    /// A GIF of `width` × `height` with this shared palette (RGB triples),
    /// looping `repeat` times after the first play (0: for ever).
    pub fn new(width: u32, height: u32, palette: &[u8], repeat: u16) -> Result<Encoder, EncoderError> {
        if !(1..=65535).contains(&width) || !(1..=65535).contains(&height) {
            return Err(EncoderError::Size);
        }
        let palette = Palette::new(palette).map_err(EncoderError::Palette)?;
        let pixel_count = width as usize * height as usize;
        let mut out = Vec::with_capacity(65536);
        out.extend_from_slice(b"GIF89a");
        out.extend_from_slice(&(width as u16).to_le_bytes());
        out.extend_from_slice(&(height as u16).to_le_bytes());
        out.extend_from_slice(&[0xF0 | (palette.bits() - 1), 0, 0]);
        palette.write(&mut out);
        out.extend_from_slice(&[0x21, 0xFF, 11]);
        out.extend_from_slice(b"NETSCAPE2.0");
        out.extend_from_slice(&[3, 1]);
        out.extend_from_slice(&repeat.to_le_bytes());
        out.push(0);
        Ok(Encoder {
            width: width as usize,
            height: height as usize,
            palette,
            out,
            taken: 0,
            last_delay_at: None,
            previous: vec![0; pixel_count],
            shown: vec![u32::MAX; pixel_count],
            indices: vec![0; pixel_count],
            frames: 0,
            tries: LocalPaletteTries::default(),
            local: PaletteBuilder::new(true),
            dither: dither_matrix(),
            finished: false,
        })
    }

    /// Bytes written so far (handed out or not).
    pub fn byte_length(&self) -> usize {
        self.taken + self.out.len()
    }

    /// Mean squared channel error of a sample of the pixels against a palette.
    fn palette_error(frame: &[u32], palette: &mut Palette) -> f64 {
        let (mut error, mut channels) = (0.0, 0.0);
        for &pixel in frame.iter().skip(3).step_by(7) {
            let (red, green, blue) = (pixel as u8, (pixel >> 8) as u8, (pixel >> 16) as u8);
            let index = palette.nearest(red, green, blue);
            for (channel, value) in [red, green, blue].into_iter().enumerate() {
                let difference = value as f64 - palette.channel(index, channel) as f64;
                error += difference * difference;
            }
            channels += 3.0;
        }
        if channels == 0.0 { 0.0 } else { error / channels }
    }

    /// Adds a frame of RGBA pixels shown for `delay_cs` hundredths of a
    /// second; the number of bytes it added (0 when nothing changed: the
    /// frame before is shown longer instead).
    pub fn add(&mut self, rgba: &[u8], delay_cs: u16) -> Result<usize, EncoderError> {
        let pixel_count = self.width * self.height;
        if rgba.len() != pixel_count * 4 {
            return Err(EncoderError::Pixels { expected: pixel_count * 4, got: rgba.len() });
        }
        let start = self.out.len();
        let frame: Vec<u32> = pixels(rgba).collect();
        let error = Self::palette_error(&frame, &mut self.palette);
        let mut own: Option<Palette> = None;
        let mut tried = None;
        if self.tries.worth_trying(error) {
            self.local.clear();
            self.local.add(rgba);
            let mut candidate = Palette::new(&self.local.finish()).map_err(EncoderError::Palette)?;
            let better = Self::palette_error(&frame, &mut candidate) * 2.0 < error;
            tried = Some(better);
            if better {
                own = Some(candidate);
            }
        }
        self.tries = self.tries.after(error, tried);
        let palette = own.as_mut().unwrap_or(&mut self.palette);
        let transparent = palette.transparent();
        let (mut left, mut top, mut right, mut bottom) = (self.width, self.height, usize::MAX, usize::MAX);
        let mut at = 0;
        for y in 0..self.height {
            for x in 0..self.width {
                let pixel = frame[at];
                self.indices[at] = transparent;
                if self.frames > 0 && pixel == self.previous[at] {
                    at += 1;
                    continue;
                }
                self.previous[at] = pixel;
                let (red, green, blue) = (pixel as u8, (pixel >> 8) as u8, (pixel >> 16) as u8);
                let mut index = palette.nearest(red, green, blue);
                let miss = (red as i32 - palette.channel(index, 0) as i32).abs()
                    + (green as i32 - palette.channel(index, 1) as i32).abs()
                    + (blue as i32 - palette.channel(index, 2) as i32).abs();
                if miss > DITHER_COLOR_ERROR {
                    let offset = self.dither[((y & 7) << 3) | (x & 7)] as f64 * DITHER_STRENGTH;
                    index = palette.nearest(
                        clamp_channel(red as f64 + offset),
                        clamp_channel(green as f64 + offset),
                        clamp_channel(blue as f64 + offset),
                    );
                }
                let color = palette.packed(index);
                if color != self.shown[at] {
                    self.shown[at] = color;
                    self.indices[at] = index as u8;
                    left = left.min(x);
                    right = if right == usize::MAX { x } else { right.max(x) };
                    top = top.min(y);
                    bottom = y;
                }
                at += 1;
            }
        }
        self.frames += 1;
        if right == usize::MAX {
            if let Some(delay_at) = self.last_delay_at {
                let field = delay_at - self.taken;
                let delay = u16::from_le_bytes([self.out[field], self.out[field + 1]]);
                let longer = (delay as u32 + delay_cs as u32).min(65535) as u16;
                self.out[field..field + 2].copy_from_slice(&longer.to_le_bytes());
            }
            return Ok(0);
        }
        let (columns, rows) = (right - left + 1, bottom - top + 1);
        let mut changed = Vec::with_capacity(columns * rows);
        for row in top..=bottom {
            let from = row * self.width + left;
            changed.extend_from_slice(&self.indices[from..from + columns]);
        }
        let later = self.frames > 1;
        // Graphic control: keep the frame under the next one (disposal 1),
        // transparency from the second frame on.
        self.out.extend_from_slice(&[0x21, 0xF9, 4, 4 | later as u8]);
        self.last_delay_at = Some(self.taken + self.out.len());
        self.out.extend_from_slice(&delay_cs.to_le_bytes());
        self.out.extend_from_slice(&[if later { transparent } else { 0 }, 0]);
        self.out.push(0x2C);
        for value in [left, top, columns, rows] {
            self.out.extend_from_slice(&(value as u16).to_le_bytes());
        }
        let bits = palette.bits();
        match &own {
            Some(own) => {
                self.out.push(0x80 | (bits - 1));
                own.write(&mut self.out);
            }
            None => self.out.push(0),
        }
        lzw::write(&mut self.out, &changed, bits.max(2));
        Ok(self.out.len() - start)
    }

    /// The bytes no later frame can change, handed out to be stored.
    pub fn take_ready(&mut self) -> Vec<u8> {
        let ready = if self.finished { self.out.len() } else { self.last_delay_at.map_or(self.out.len(), |at| at - self.taken) };
        self.taken += ready;
        self.out.drain(..ready).collect()
    }

    /// Ends the file; the bytes not handed out yet.
    pub fn finish(&mut self) -> Vec<u8> {
        if !self.finished {
            self.out.push(0x3B);
            self.finished = true;
        }
        self.take_ready()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gif::PaletteBuilder;

    struct Decoded {
        /// Each frame as shown, RGB.
        shown: Vec<Vec<u8>>,
        delays: Vec<u16>,
        rectangles: Vec<(u16, u16, u16, u16)>,
        local_palettes: Vec<bool>,
        repeat: gif::Repeat,
    }

    /// Decodes with an independent decoder, drawing each frame over the one before.
    fn decode(bytes: &[u8]) -> Decoded {
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::Indexed);
        let mut decoder = options.read_info(bytes).expect("a GIF");
        let (width, height) = (decoder.width() as usize, decoder.height() as usize);
        let global = decoder.global_palette().expect("a global palette").to_vec();
        let repeat = decoder.repeat();
        let mut canvas = vec![0u8; width * height * 3];
        let mut decoded = Decoded { shown: Vec::new(), delays: Vec::new(), rectangles: Vec::new(), local_palettes: Vec::new(), repeat };
        while let Some(frame) = decoder.read_next_frame().expect("a frame") {
            assert_eq!(frame.dispose, gif::DisposalMethod::Keep);
            let palette = frame.palette.as_ref().unwrap_or(&global);
            for y in 0..frame.height as usize {
                for x in 0..frame.width as usize {
                    let index = frame.buffer[y * frame.width as usize + x];
                    if Some(index) == frame.transparent {
                        continue;
                    }
                    let at = ((frame.top as usize + y) * width + frame.left as usize + x) * 3;
                    canvas[at..at + 3].copy_from_slice(&palette[index as usize * 3..index as usize * 3 + 3]);
                }
            }
            decoded.shown.push(canvas.clone());
            decoded.delays.push(frame.delay);
            decoded.rectangles.push((frame.left, frame.top, frame.width, frame.height));
            decoded.local_palettes.push(frame.palette.is_some());
        }
        decoded
    }

    fn frame(width: usize, height: usize, pixel: impl Fn(usize, usize) -> [u8; 3]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                rgba.extend_from_slice(&pixel(x, y));
                rgba.push(255);
            }
        }
        rgba
    }

    fn rgb(rgba: &[u8]) -> Vec<u8> {
        rgba.chunks_exact(4).flat_map(|pixel| [pixel[0], pixel[1], pixel[2]]).collect()
    }

    fn mean_error(shown: &[u8], rgba: &[u8]) -> f64 {
        let wanted = rgb(rgba);
        shown.iter().zip(&wanted).map(|(a, b)| (*a as f64 - *b as f64).abs()).sum::<f64>() / wanted.len() as f64
    }

    fn palette_for(frames: &[&[u8]]) -> Vec<u8> {
        let mut builder = PaletteBuilder::new(false);
        for frame in frames {
            builder.add(frame);
        }
        builder.finish()
    }

    #[test]
    fn few_colors_come_back_exactly_with_only_the_change_written() {
        let first = frame(20, 10, |x, _| if x < 10 { [255, 0, 0] } else { [0, 0, 255] });
        let second = frame(20, 10, |x, y| {
            if (4..7).contains(&x) && (2..5).contains(&y) {
                [0, 255, 0]
            } else if x < 10 {
                [255, 0, 0]
            } else {
                [0, 0, 255]
            }
        });
        let mut encoder = Encoder::new(20, 10, &palette_for(&[&first, &second]), 0).unwrap();
        assert!(encoder.add(&first, 8).unwrap() > 0);
        assert!(encoder.add(&second, 8).unwrap() > 0);
        let bytes = encoder.finish();
        assert_eq!(&bytes[..6], b"GIF89a");
        assert_eq!(bytes[bytes.len() - 1], 0x3B);
        let decoded = decode(&bytes);
        assert_eq!(decoded.shown, vec![rgb(&first), rgb(&second)]);
        assert_eq!(decoded.rectangles, vec![(0, 0, 20, 10), (4, 2, 3, 3)]);
        assert_eq!(decoded.delays, vec![8, 8]);
        assert_eq!(decoded.repeat, gif::Repeat::Infinite);
    }

    #[test]
    fn an_unchanged_frame_lengthens_the_one_before() {
        let still = frame(8, 8, |x, y| [(x * 30) as u8, (y * 30) as u8, 0]);
        let mut encoder = Encoder::new(8, 8, &palette_for(&[&still]), 2).unwrap();
        encoder.add(&still, 10).unwrap();
        assert_eq!(encoder.add(&still, 10).unwrap(), 0);
        assert_eq!(encoder.add(&still, 5).unwrap(), 0);
        let decoded = decode(&encoder.finish());
        assert_eq!(decoded.delays, vec![25]);
        assert_eq!(decoded.repeat, gif::Repeat::Finite(2));
    }

    #[test]
    fn many_colors_stay_close() {
        let frames: Vec<Vec<u8>> =
            (0..3).map(|shift| frame(160, 90, |x, y| [(x + shift * 20) as u8, (y * 2) as u8, ((x + y) / 2) as u8])).collect();
        let samples: Vec<&[u8]> = frames.iter().map(Vec::as_slice).collect();
        let mut encoder = Encoder::new(160, 90, &palette_for(&samples), 0).unwrap();
        for frame in &frames {
            encoder.add(frame, 4).unwrap();
        }
        let decoded = decode(&encoder.finish());
        for (shown, frame) in decoded.shown.iter().zip(&frames) {
            let error = mean_error(shown, frame);
            assert!(error < 6.0, "mean channel error {error}");
        }
    }

    #[test]
    fn a_frame_far_from_the_shared_palette_gets_its_own() {
        let reds = frame(64, 64, |x, y| [(x * 4) as u8, 0, (y % 2) as u8]);
        let blues = frame(64, 64, |x, y| [0, (y * 4) as u8, 128 + (x * 2) as u8]);
        let mut encoder = Encoder::new(64, 64, &palette_for(&[&reds]), 0).unwrap();
        encoder.add(&reds, 4).unwrap();
        encoder.add(&blues, 4).unwrap();
        let decoded = decode(&encoder.finish());
        assert_eq!(decoded.local_palettes, vec![false, true]);
        let error = mean_error(&decoded.shown[1], &blues);
        assert!(error < 6.0, "mean channel error {error}");
    }

    #[test]
    fn handed_out_chunks_make_the_same_file() {
        let frames: Vec<Vec<u8>> =
            (0..4).map(|n| frame(30, 20, |x, y| if x == n * 5 { [255, 255, 255] } else { [(y * 10) as u8, 0, 0] })).collect();
        let samples: Vec<&[u8]> = frames.iter().map(Vec::as_slice).collect();
        let palette = palette_for(&samples);
        let mut whole = Encoder::new(30, 20, &palette, 0).unwrap();
        let mut chunked = Encoder::new(30, 20, &palette, 0).unwrap();
        let mut chunks = Vec::new();
        for frame in frames.iter().chain([&frames[3], &frames[3]]) {
            whole.add(frame, 6).unwrap();
            chunked.add(frame, 6).unwrap();
            chunks.extend(chunked.take_ready());
        }
        assert_eq!(whole.byte_length(), chunked.byte_length());
        chunks.extend(chunked.finish());
        assert_eq!(chunks, whole.finish());
        assert_eq!(decode(&chunks).delays, vec![6, 6, 6, 18]);
    }

    #[test]
    fn rejects_bad_sizes() {
        assert_eq!(Encoder::new(0, 10, &[0, 0, 0], 0).err(), Some(EncoderError::Size));
        let mut encoder = Encoder::new(2, 2, &[0, 0, 0], 0).unwrap();
        assert_eq!(encoder.add(&[0; 12], 1), Err(EncoderError::Pixels { expected: 16, got: 12 }));
    }
}
