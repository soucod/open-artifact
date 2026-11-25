//! QuickTime Animation (`rle `) at 32 bits a pixel: ARGB, straight alpha.
//!
//! Each sample is its byte size, a header, then for every coded line a skip
//! count and run codes: a positive code is that many literal pixels, a
//! negative one a single pixel repeated, 0 a further skip, −1 the end of the
//! line. A key frame codes every line; a delta frame only the lines from the
//! first to the last changed pixel, skipping pixels the frame before already
//! shows.

#[derive(Debug, PartialEq, Eq)]
pub enum RleError {
    Size,
    Pixels { expected: usize, got: usize },
}

impl std::fmt::Display for RleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RleError::Size => write!(f, "A MOV is 1 to 65535 pixels wide and high."),
            RleError::Pixels { expected, got } => write!(f, "A frame takes {expected} bytes of RGBA, not {got}."),
        }
    }
}

/// A frame as coded.
pub struct RleSample<'a> {
    pub data: &'a [u8],
    pub key: bool,
    /// The frame is the one before, pixel for pixel.
    pub same: bool,
    /// `data` is the sample before, unchanged: a key frame that repeats the key frame before.
    pub repeat: bool,
}

/// Longest literal run, and longest repeat run, a code holds.
const MAX_LITERAL: usize = 127;
const MAX_REPEAT: usize = 128;
/// Longest skip one skip byte holds.
const MAX_SKIP: usize = 254;
const END_OF_LINE: u8 = 0xff;

pub struct RleEncoder {
    width: usize,
    height: usize,
    key_every: u32,
    frames: u32,
    current: Vec<u32>,
    previous: Vec<u32>,
    /// Whether the last sample was a key frame; `None` before the first.
    last_key: Option<bool>,
    out: Vec<u8>,
}

fn argb(pixel: u32) -> [u8; 4] {
    let [red, green, blue, alpha] = pixel.to_le_bytes();
    [alpha, red, green, blue]
}

fn write_literals(out: &mut Vec<u8>, pixels: &[u32], mut from: usize, to: usize) {
    while from < to {
        let end = to.min(from + MAX_LITERAL);
        out.push((end - from) as u8);
        for &pixel in &pixels[from..end] {
            out.extend_from_slice(&argb(pixel));
        }
        from = end;
    }
}

fn write_skip(out: &mut Vec<u8>, skip: usize) {
    out.push(skip.min(MAX_SKIP) as u8 + 1);
    let mut left = skip.saturating_sub(MAX_SKIP);
    while left > 0 {
        out.push(0);
        out.push(left.min(MAX_SKIP) as u8 + 1);
        left = left.saturating_sub(MAX_SKIP);
    }
}

impl RleEncoder {
    /// An encoder of `width` × `height` frames, every `key_every`th a key frame (1: all of them).
    pub fn new(width: u32, height: u32, key_every: u32) -> Result<RleEncoder, RleError> {
        if width == 0 || height == 0 || width > 65535 || height > 65535 {
            return Err(RleError::Size);
        }
        let count = width as usize * height as usize;
        Ok(RleEncoder {
            width: width as usize,
            height: height as usize,
            key_every: key_every.max(1),
            frames: 0,
            current: vec![0; count],
            previous: vec![0; count],
            last_key: None,
            out: Vec::new(),
        })
    }

    /// Codes a frame of RGBA pixels.
    pub fn encode(&mut self, rgba: &[u8]) -> Result<RleSample<'_>, RleError> {
        let count = self.width * self.height;
        if rgba.len() != count * 4 {
            return Err(RleError::Pixels { expected: count * 4, got: rgba.len() });
        }
        for (pixel, bytes) in self.current.iter_mut().zip(rgba.as_chunks::<4>().0) {
            *pixel = u32::from_le_bytes(*bytes);
        }
        let key = self.frames.is_multiple_of(self.key_every);
        self.frames = self.frames.wrapping_add(1);
        let (mut first, mut last) = (0, count);
        if let Some(last_key) = self.last_key {
            while first < last && self.current[first] == self.previous[first] {
                first += 1;
            }
            while last > first && self.current[last - 1] == self.previous[last - 1] {
                last -= 1;
            }
            if first == last && key && last_key {
                return Ok(RleSample { data: &self.out, key: true, same: true, repeat: true });
            }
        }
        let same = self.last_key.is_some() && first == last;
        let delta = !key;
        let (first_row, last_row) = if delta { (first / self.width, last.div_ceil(self.width)) } else { (0, self.height) };

        let out = &mut self.out;
        out.clear();
        out.extend_from_slice(&[0; 4]);
        if first_row >= last_row || (first_row == 0 && last_row == self.height) {
            out.extend_from_slice(&0u16.to_be_bytes());
        } else {
            for word in [8, first_row as u16, 0, (last_row - first_row) as u16, 0] {
                out.extend_from_slice(&u16::to_be_bytes(word));
            }
        }
        let (pixels, base) = (&self.current, &self.previous);
        for row in first_row..last_row {
            let line = row * self.width;
            let (mut start, mut end) = (line, line + self.width);
            if delta {
                while start < end && pixels[start] == base[start] {
                    start += 1;
                }
                while end > start && pixels[end - 1] == base[end - 1] {
                    end -= 1;
                }
            }
            write_skip(out, if start == end { 0 } else { start - line });
            let (mut at, mut literal_from, mut same_until, mut run_until) = (start, start, start, start);
            while at < end {
                if delta && same_until <= at {
                    same_until = at;
                    while same_until < end && pixels[same_until] == base[same_until] {
                        same_until += 1;
                    }
                }
                let color = pixels[at];
                if run_until <= at {
                    run_until = at + 1;
                    while run_until < end && pixels[run_until] == color {
                        run_until += 1;
                    }
                }
                let unchanged = same_until.saturating_sub(at);
                let run = run_until - at;
                // Skip unchanged pixels unless coding them as runs takes fewer bytes.
                let skip_pays = unchanged > 0
                    && (unchanged >= run
                        || run.div_ceil(MAX_REPEAT) * 5 > unchanged.div_ceil(MAX_SKIP) * 2 + (run - unchanged).div_ceil(MAX_REPEAT) * 5);
                if skip_pays {
                    write_literals(out, pixels, literal_from, at);
                    let skipped = unchanged.min(MAX_SKIP);
                    out.push(0);
                    out.push(skipped as u8 + 1);
                    at += skipped;
                    literal_from = at;
                } else if run > 1 {
                    write_literals(out, pixels, literal_from, at);
                    let repeated = run.min(MAX_REPEAT);
                    out.push((256 - repeated) as u8);
                    out.extend_from_slice(&argb(color));
                    at += repeated;
                    literal_from = at;
                } else {
                    at += 1;
                }
            }
            write_literals(out, pixels, literal_from, end);
            out.push(END_OF_LINE);
        }
        out.push(0);
        let size = out.len() as u32;
        out[..4].copy_from_slice(&size.to_be_bytes());
        std::mem::swap(&mut self.current, &mut self.previous);
        self.last_key = Some(key);
        Ok(RleSample { data: &self.out, key, same, repeat: false })
    }
}

/// Decodes 32-bit QuickTime Animation samples over the frame before, as a player does.
#[cfg(test)]
pub(crate) fn decode(sample: &[u8], width: usize, height: usize, canvas: &mut [u8]) {
    let size = u32::from_be_bytes(sample[..4].try_into().unwrap()) as usize;
    assert_eq!(size, sample.len());
    if size < 8 {
        return;
    }
    let header = u16::from_be_bytes([sample[4], sample[5]]);
    let mut at = 6;
    let read16 = |at: usize| u16::from_be_bytes([sample[at], sample[at + 1]]) as usize;
    let (first_row, rows) = if header & 8 != 0 {
        let rows = (read16(at), read16(at + 4));
        at += 8;
        rows
    } else {
        (0, height)
    };
    for row in first_row..first_row + rows {
        let mut x = sample[at] as usize - 1;
        at += 1;
        loop {
            let code = sample[at] as i8;
            at += 1;
            match code {
                -1 => break,
                0 => {
                    x += sample[at] as usize - 1;
                    at += 1;
                }
                code if code > 0 => {
                    for _ in 0..code {
                        let [a, r, g, b] = sample[at..at + 4] else { unreachable!() };
                        canvas[(row * width + x) * 4..][..4].copy_from_slice(&[r, g, b, a]);
                        x += 1;
                        at += 4;
                    }
                }
                code => {
                    let [a, r, g, b] = sample[at..at + 4] else { unreachable!() };
                    at += 4;
                    for _ in 0..-(code as i32) {
                        canvas[(row * width + x) * 4..][..4].copy_from_slice(&[r, g, b, a]);
                        x += 1;
                    }
                }
            }
            assert!(x <= width);
        }
    }
    assert_eq!(sample[at], 0, "a sample ends in a zero byte");
    assert_eq!(at + 1, size);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: usize, height: usize, color: impl Fn(usize, usize) -> [u8; 4]) -> Vec<u8> {
        let color = &color;
        (0..height).flat_map(|y| (0..width).flat_map(move |x| color(x, y))).collect()
    }

    #[test]
    fn a_flat_line_is_one_repeat() {
        let mut encoder = RleEncoder::new(4, 1, 1).unwrap();
        let sample = encoder.encode(&frame(4, 1, |_, _| [10, 20, 30, 128])).unwrap();
        // size, header 0, skip 0, repeat 4 × ARGB, end of line, end.
        assert_eq!(sample.data, &[0, 0, 0, 14, 0, 0, 1, 0xfc, 128, 10, 20, 30, 0xff, 0]);
        assert!(sample.key && !sample.same && !sample.repeat);
    }

    #[test]
    fn mixed_pixels_are_literals_and_runs() {
        let colors = [[1, 0, 0, 255], [2, 0, 0, 255], [3, 3, 3, 0], [3, 3, 3, 0], [3, 3, 3, 0]];
        let mut encoder = RleEncoder::new(5, 1, 1).unwrap();
        let sample = encoder.encode(&frame(5, 1, |x, _| colors[x])).unwrap();
        assert_eq!(sample.data, &[0, 0, 0, 23, 0, 0, 1, 2, 255, 1, 0, 0, 255, 2, 0, 0, 0xfd, 0, 3, 3, 3, 0xff, 0]);
    }

    #[test]
    fn long_runs_and_literals_split() {
        let (width, height) = (700, 3);
        let mut encoder = RleEncoder::new(width as u32, height as u32, 1).unwrap();
        let pixels = frame(width, height, |x, y| match y {
            0 => [9, 9, 9, 255],
            1 => [(x % 251) as u8, (x / 251) as u8, 7, 255],
            _ => [(x / 3) as u8, 0, 0, (x % 2) as u8 * 255],
        });
        let sample = encoder.encode(&pixels).unwrap();
        let mut canvas = vec![0; width * height * 4];
        decode(sample.data, width, height, &mut canvas);
        assert_eq!(canvas, pixels);
    }

    #[test]
    fn delta_frames_round_trip_and_skip_what_stayed() {
        let (width, height) = (300, 40);
        let mut encoder = RleEncoder::new(width as u32, height as u32, 4).unwrap();
        let mut canvas = vec![0; width * height * 4];
        let mut sizes = Vec::new();
        for step in 0..8usize {
            let pixels = frame(width, height, |x, y| {
                let inside = (10..20).contains(&y) && (step * 30..step * 30 + 25).contains(&x);
                if inside { [255, step as u8 * 20, 0, 200] } else { [0, 0, (x / 50) as u8 * 30, 255] }
            });
            let sample = encoder.encode(&pixels).unwrap();
            assert_eq!(sample.key, step % 4 == 0);
            sizes.push(sample.data.len());
            decode(sample.data, width, height, &mut canvas);
            assert_eq!(canvas, pixels, "frame {step}");
        }
        assert!(sizes[1] < sizes[0] / 2, "a delta frame codes only what moved: {sizes:?}");
    }

    #[test]
    fn a_delta_frame_with_a_wide_unchanged_gap_skips_past_254() {
        let (width, height) = (1200, 2);
        let mut encoder = RleEncoder::new(width as u32, height as u32, 2).unwrap();
        let mut canvas = vec![0; width * height * 4];
        let still = frame(width, height, |x, _| [(x % 200) as u8, 1, 2, 255]);
        decode(encoder.encode(&still).unwrap().data, width, height, &mut canvas);
        let mut moved = still.clone();
        moved[(width + 1100) * 4] = 77;
        moved[(width + 600) * 4] = 66;
        let sample = encoder.encode(&moved).unwrap();
        assert!(!sample.key);
        assert_eq!(&sample.data[4..14], &[0, 8, 0, 1, 0, 0, 0, 1, 0, 0], "only the second line is coded");
        decode(sample.data, width, height, &mut canvas);
        assert_eq!(canvas, moved);
    }

    #[test]
    fn unchanged_frames_repeat_or_shrink() {
        let pixels = frame(8, 8, |x, y| [x as u8, y as u8, 0, 255]);
        let mut keys = RleEncoder::new(8, 8, 1).unwrap();
        let first = keys.encode(&pixels).unwrap().data.to_vec();
        let again = keys.encode(&pixels).unwrap();
        assert!(again.repeat && again.same && again.key);
        assert_eq!(again.data, &first[..]);

        let mut deltas = RleEncoder::new(8, 8, 3).unwrap();
        deltas.encode(&pixels).unwrap();
        let again = deltas.encode(&pixels).unwrap();
        assert!(again.same && !again.repeat && !again.key);
        assert_eq!(again.data, &[0, 0, 0, 7, 0, 0, 0], "an empty delta is under 8 bytes: players show the frame before");
    }

    #[test]
    fn rejects_wrong_sizes() {
        assert_eq!(RleEncoder::new(0, 4, 1).err(), Some(RleError::Size));
        let mut encoder = RleEncoder::new(2, 2, 1).unwrap();
        assert_eq!(encoder.encode(&[0; 15]).err(), Some(RleError::Pixels { expected: 16, got: 15 }));
    }
}
