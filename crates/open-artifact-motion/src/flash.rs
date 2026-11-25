//! General flash analysis (WCAG 2.3.1) over frames sampled at 30 fps.
//!
//! A pixel transition is a change of relative luminance of at least 0.1
//! where the darker side is below 0.8. Transitions count where, within a
//! window of a tenth of the view (341 × 256 of 1024 × 768), they cover a
//! quarter of it, adding up over a few frames with a decay. Six such
//! transitions at one place make three flashes; the shortest time over
//! which that happens says how much faster the scene could play before it
//! flashes more than three times a second.

/// Frames are sampled this often.
pub const SAMPLE_FPS: f64 = 30.0;
/// Analysis works on luminance at most this many pixels on the long side.
const MAX_SIDE: usize = 200;
/// The smallest luminance change that is a transition.
const TRANSITION: f64 = 0.099999;
/// A side brighter than this cannot be the dark side of a flash.
const BRIGHT: f64 = 0.8;
const REFERENCE_VIEW: [f64; 2] = [1024.0, 768.0];
const REFERENCE_WINDOW: [f64; 2] = [341.0, 256.0];
/// A quarter of the reference window, in reference pixels.
const REFERENCE_AREA: f64 = 21824.0;
/// Transitions per place that make three flashes.
const TRANSITIONS: usize = 6;
/// Three flashes may take this long at the least (seconds) before it is too fast.
const SAFE_SPAN: f64 = 1.0333333333333334;

fn srgb_to_linear() -> [f32; 256] {
    std::array::from_fn(|value| {
        let channel = value as f64 / 255.0;
        (if channel <= 0.04045 { channel / 12.92 } else { ((channel + 0.055) / 1.055).powf(2.4) }) as f32
    })
}

/// Relative luminance of RGBA pixels, halved until the long side is at most 200.
pub fn luminance(rgba: &[u8], width: usize, table: &[f32; 256]) -> (usize, usize, Vec<f32>) {
    let mut lum: Vec<f32> = rgba
        .chunks_exact(4)
        .map(|pixel| {
            (0.2126 * table[pixel[0] as usize] as f64 + 0.7152 * table[pixel[1] as usize] as f64 + 0.0722 * table[pixel[2] as usize] as f64)
                as f32
        })
        .collect();
    let mut width = width;
    let mut height = lum.len().checked_div(width).unwrap_or(0);
    while width.max(height) > MAX_SIDE {
        let (half_width, half_height) = (width >> 1, height >> 1);
        let mut half = vec![0f32; half_width * half_height];
        for y in 0..half_height {
            for x in 0..half_width {
                let (top, bottom) = (2 * y * width + 2 * x, (2 * y + 1) * width + 2 * x);
                half[y * half_width + x] =
                    ((lum[top] as f64 + lum[top + 1] as f64 + lum[bottom] as f64 + lum[bottom + 1] as f64) / 4.0) as f32;
            }
        }
        (width, height, lum) = (half_width, half_height, half);
    }
    (width, height, lum)
}

/// Per pixel: the direction luminance is moving in and the turns that are
/// transitions.
struct Transitions {
    started: bool,
    /// 1 rising, -1 falling, 0 not moved enough yet.
    direction: Vec<i8>,
    /// Whether the current run has been reported (or never will be).
    reported: Vec<bool>,
    /// The extreme of the current run.
    extreme: Vec<f32>,
    /// Before the first run: the highest and lowest seen.
    highest: Vec<f32>,
    lowest: Vec<f32>,
}

impl Transitions {
    fn new(pixels: usize) -> Transitions {
        Transitions {
            started: false,
            direction: vec![0; pixels],
            reported: vec![false; pixels],
            extreme: vec![0.0; pixels],
            highest: vec![0.0; pixels],
            lowest: vec![0.0; pixels],
        }
    }

    /// Writes each pixel's new transition (±1, or 0) into `found`; whether there was one.
    fn add(&mut self, lum: &[f32], found: &mut [i8]) -> bool {
        if !self.started {
            self.highest.copy_from_slice(lum);
            self.lowest.copy_from_slice(lum);
            found.fill(0);
            self.started = true;
            return false;
        }
        let mut any = false;
        for (index, &value) in lum.iter().enumerate() {
            let now = value as f64;
            let mut direction = self.direction[index];
            let mut turned_from = f64::NAN;
            if direction == 0 {
                if value > self.highest[index] {
                    self.highest[index] = value;
                }
                if value < self.lowest[index] {
                    self.lowest[index] = value;
                }
                if now - self.lowest[index] as f64 >= TRANSITION {
                    direction = 1;
                    turned_from = self.lowest[index] as f64;
                } else if self.highest[index] as f64 - now >= TRANSITION {
                    direction = -1;
                    turned_from = self.highest[index] as f64;
                }
            } else {
                let further = if direction == 1 { value > self.extreme[index] } else { value < self.extreme[index] };
                if further {
                    self.extreme[index] = value;
                }
                if (self.extreme[index] as f64 - now) * direction as f64 >= TRANSITION {
                    turned_from = self.extreme[index] as f64;
                    direction = -direction;
                }
            }
            if !turned_from.is_nan() {
                self.direction[index] = direction;
                self.extreme[index] = value;
                // A rise from a bright level is not part of a flash.
                self.reported[index] = direction == 1 && turned_from >= BRIGHT;
            }
            // A fall counts once it reaches the dark side.
            if direction != 0 && !self.reported[index] && (direction == 1 || (self.extreme[index] as f64) < BRIGHT) {
                self.reported[index] = true;
                found[index] = direction;
                any = true;
            } else {
                found[index] = 0;
            }
        }
        any
    }
}

/// The transition window scaled to the frame, and the area it must cover.
struct Window {
    width: usize,
    height: usize,
    window_width: usize,
    window_height: usize,
    area: f64,
}

impl Window {
    fn new(width: usize, height: usize) -> Window {
        let scale = (REFERENCE_VIEW[0] / width as f64).min(REFERENCE_VIEW[1] / height as f64);
        Window {
            width,
            height,
            window_width: ((REFERENCE_WINDOW[0] / scale + 0.5).floor() as usize).max(1),
            window_height: ((REFERENCE_WINDOW[1] / scale + 0.5).floor() as usize).max(1),
            area: REFERENCE_AREA / (scale * scale),
        }
    }

    /// Signed transitions summed over the window around each pixel.
    fn sums(&self, found: &[i8], integral: &mut [f64], sums: &mut [f32]) {
        let (width, height) = (self.width, self.height);
        let stride = width + 1;
        for y in 0..height {
            let mut row = 0.0;
            for x in 0..width {
                row += found[y * width + x] as f64;
                integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
            }
        }
        let (half_width, half_height) = ((self.window_width >> 1) as isize, (self.window_height >> 1) as isize);
        for y in 0..height {
            let top = (y as isize - half_height).max(0) as usize * stride;
            let bottom = (y as isize - half_height + self.window_height as isize).min(height as isize) as usize * stride;
            for x in 0..width {
                let left = (x as isize - half_width).max(0) as usize;
                let right = (x as isize - half_width + self.window_width as isize).min(width as isize) as usize;
                sums[y * width + x] = (integral[bottom + right] - integral[top + right] - integral[bottom + left] + integral[top + left]) as f32;
            }
        }
    }
}

/// The detector for one frame size.
struct Detector {
    window: Window,
    transitions: Transitions,
    found: Vec<i8>,
    integral: Vec<f64>,
    sums: Vec<f32>,
    /// Window sums carried over from earlier frames (decaying).
    carried: Vec<f32>,
    /// The sign of the last large transition per place.
    last_sign: Vec<i8>,
    /// The frames of the last six large transitions per place (ring, -1 unset).
    ring: Vec<i32>,
    ring_at: Vec<u8>,
    /// Decay due since the last frame with transitions.
    decay: f64,
}

/// Where three flashes happened fastest: the frames of the first and last transition.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Burst {
    pub first: u32,
    pub last: u32,
}

/// Flash analysis of a sampled stretch of film, fed frame by frame.
pub struct FlashAnalyzer {
    from_frame: i64,
    to_frame: i64,
    table: [f32; 256],
    frame: i64,
    size: Option<(usize, usize)>,
    detector: Option<Detector>,
    fastest: Option<Burst>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FlashError {
    Width,
    Size { width: usize, height: usize, first_width: usize, first_height: usize },
}

impl std::fmt::Display for FlashError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FlashError::Width => f.write_str("A frame's width must divide its pixels."),
            FlashError::Size { width, height, first_width, first_height } => {
                write!(f, "A picture of {width}x{height} among pictures of {first_width}x{first_height}.")
            }
        }
    }
}

impl FlashAnalyzer {
    /// An analyzer whose verdict covers the frames from `from_frame` to
    /// `to_frame` (frame indices from 0, sampled at 30 fps): three flashes
    /// count when they end after `from_frame` and begin before `to_frame`.
    pub fn new(from_frame: u32, to_frame: u32) -> FlashAnalyzer {
        FlashAnalyzer {
            from_frame: from_frame as i64,
            to_frame: to_frame as i64,
            table: srgb_to_linear(),
            frame: -1,
            size: None,
            detector: None,
            fastest: None,
        }
    }

    /// Frames seen.
    pub fn frames(&self) -> u32 {
        (self.frame + 1) as u32
    }

    /// Adds the next frame, RGBA pixels `width` wide. Every frame must
    /// have the size of the first.
    pub fn add(&mut self, rgba: &[u8], width: usize) -> Result<(), FlashError> {
        if width == 0 || !(rgba.len() / 4).is_multiple_of(width) {
            return Err(FlashError::Width);
        }
        let (width, height, lum) = luminance(rgba, width, &self.table);
        if let Some((first_width, first_height)) = self.size
            && (first_width, first_height) != (width, height)
        {
            return Err(FlashError::Size { width, height, first_width, first_height });
        }
        self.frame += 1;
        self.size = Some((width, height));
        let pixels = width * height;
        let detector = self.detector.get_or_insert_with(|| Detector {
            window: Window::new(width, height),
            transitions: Transitions::new(pixels),
            found: vec![0; pixels],
            integral: vec![0.0; (width + 1) * (height + 1)],
            sums: vec![0.0; pixels],
            carried: vec![0.0; pixels],
            last_sign: vec![0; pixels],
            ring: vec![-1; TRANSITIONS * pixels],
            ring_at: vec![0; pixels],
            decay: 1.0,
        });
        detector.decay *= (-2.0f64 / 9.0).exp();
        if !detector.transitions.add(&lum, &mut detector.found) {
            return Ok(());
        }
        detector.window.sums(&detector.found, &mut detector.integral, &mut detector.sums);
        let area = detector.window.area;
        let frame = self.frame;
        for index in 0..pixels {
            let total = detector.carried[index] as f64 * detector.decay + detector.sums[index] as f64;
            let sign: i8 = if total > area { 1 } else if total < -area { -1 } else { 0 };
            if sign == 0 || sign == detector.last_sign[index] {
                detector.carried[index] = total.clamp(-area, area) as f32;
                continue;
            }
            detector.last_sign[index] = sign;
            detector.carried[index] = 0.0;
            let slot = detector.ring_at[index] as usize * pixels + index;
            let earlier = detector.ring[slot] as i64;
            let span = self.fastest.map_or(i64::MAX, |burst| burst.last as i64 - burst.first as i64);
            if earlier >= 0 && earlier < self.to_frame && frame > self.from_frame && frame - earlier < span {
                self.fastest = Some(Burst { first: earlier as u32, last: frame as u32 });
            }
            detector.ring[slot] = frame as i32;
            detector.ring_at[index] = ((detector.ring_at[index] as usize + 1) % TRANSITIONS) as u8;
        }
        detector.decay = 1.0;
        Ok(())
    }

    /// Where three flashes happened fastest, if anywhere.
    pub fn fastest(&self) -> Option<Burst> {
        self.fastest
    }

    /// The shortest time three flashes took, in seconds (infinite: none).
    pub fn span(&self) -> f64 {
        self.fastest.map_or(f64::INFINITY, |burst| (burst.last - burst.first) as f64 / SAMPLE_FPS)
    }

    /// The least share of its length the stretch can be shortened to
    /// without flashing too fast: 0 when it never flashes, 1 when it
    /// cannot be shortened at all.
    pub fn safe_scale(&self) -> f64 {
        safe_scale(self.span())
    }
}

/// The least share of its length a stretch whose fastest three flashes took
/// `span` seconds can be shortened to.
pub fn safe_scale(span: f64) -> f64 {
    (SAFE_SPAN / span).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(width: usize, height: usize, level: u8) -> Vec<u8> {
        [level, level, level, 255].repeat(width * height)
    }

    /// Frames of a film that alternates between black and white every `every` frames.
    fn run(analyzer: &mut FlashAnalyzer, frames: usize, every: usize, width: usize, height: usize) {
        for frame in 0..frames {
            let level = if (frame / every).is_multiple_of(2) { 0 } else { 255 };
            analyzer.add(&flat(width, height, level), width).unwrap();
        }
    }

    #[test]
    fn luminance_follows_srgb_and_halves_big_frames() {
        let table = srgb_to_linear();
        let (width, height, lum) = luminance(&flat(800, 450, 255), 800, &table);
        assert_eq!((width, height), (200, 112));
        assert!((lum[0] - 1.0).abs() < 1e-6);
        let (_, _, grey) = luminance(&flat(2, 2, 128), 2, &table);
        assert!((grey[0] - 0.2158605).abs() < 1e-5);
    }

    #[test]
    fn steady_pictures_never_flash() {
        let mut analyzer = FlashAnalyzer::new(0, 90);
        for _ in 0..90 {
            analyzer.add(&flat(64, 36, 90), 64).unwrap();
        }
        assert_eq!(analyzer.span(), f64::INFINITY);
        assert_eq!(analyzer.safe_scale(), 0.0);
        assert_eq!(analyzer.frames(), 90);
    }

    #[test]
    fn a_full_screen_strobe_cannot_be_shortened() {
        // Black and white swapping every 2 frames: 7.5 flashes a second.
        let mut analyzer = FlashAnalyzer::new(0, 90);
        run(&mut analyzer, 90, 2, 64, 36);
        let burst = analyzer.fastest().expect("flashes");
        assert_eq!(burst.last - burst.first, 12);
        assert_eq!(analyzer.safe_scale(), 1.0);
    }

    #[test]
    fn slow_flashes_allow_some_shortening() {
        // A swap every 15 frames: six transitions over 90 frames (3 s).
        let mut analyzer = FlashAnalyzer::new(0, 200);
        run(&mut analyzer, 200, 15, 64, 36);
        assert_eq!(analyzer.span(), 3.0);
        assert!((analyzer.safe_scale() - SAFE_SPAN / 3.0).abs() < 1e-12);
    }

    #[test]
    fn small_flashing_areas_do_not_count() {
        let mut analyzer = FlashAnalyzer::new(0, 90);
        let (width, height) = (160, 90);
        for frame in 0..90 {
            let mut rgba = flat(width, height, 0);
            if (frame / 2) % 2 == 1 {
                for y in 0..10 {
                    for x in 0..10 {
                        rgba[(y * width + x) * 4..(y * width + x) * 4 + 3].fill(255);
                    }
                }
            }
            analyzer.add(&rgba, width).unwrap();
        }
        assert_eq!(analyzer.fastest(), None);
    }

    #[test]
    fn bright_flicker_above_the_dark_threshold_is_safe() {
        // Between 0.85 and 1.0 luminance: the darker side is never below 0.8.
        let mut analyzer = FlashAnalyzer::new(0, 90);
        for frame in 0..90 {
            let level = if (frame / 2) % 2 == 0 { 237 } else { 255 };
            analyzer.add(&flat(64, 36, level), 64).unwrap();
        }
        assert_eq!(analyzer.fastest(), None);
    }

    #[test]
    fn flashes_outside_the_scene_do_not_count() {
        // The strobe stops at frame 30, before the scene (60–120) starts.
        let mut analyzer = FlashAnalyzer::new(60, 120);
        for frame in 0..150 {
            let level = if frame < 30 && (frame / 2) % 2 == 1 { 255 } else { 0 };
            analyzer.add(&flat(64, 36, level), 64).unwrap();
        }
        assert_eq!(analyzer.fastest(), None);
    }

    #[test]
    fn frames_must_keep_their_size() {
        let mut analyzer = FlashAnalyzer::new(0, 10);
        analyzer.add(&flat(8, 8, 0), 8).unwrap();
        assert!(matches!(analyzer.add(&flat(8, 4, 0), 8), Err(FlashError::Size { .. })));
        assert_eq!(analyzer.add(&flat(3, 1, 0), 2), Err(FlashError::Width));
    }
}
