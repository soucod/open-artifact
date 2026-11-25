//! Picking up to 255 colors for frames. Few colors are taken exactly.
//! Otherwise large flat areas keep their exact color (a background must not
//! shimmer), and the rest is a weighted median cut over a color histogram,
//! refined by k-means rounds.

use std::collections::{HashMap, HashSet};

use super::{COLOR_WEIGHTS, color_distance, packed_to_rgb, pixels};

/// A run this long of one color is part of a flat area.
const FLAT_RUN_PIXELS: u64 = 8;
/// Share of all pixels a flat color must cover to be kept exactly.
const FLAT_COLOR_SHARE: f64 = 0.005;
/// Flat colors closer than this in every channel form one cluster.
const FLAT_COLOR_CHANNEL_DISTANCE: i32 = 3;
/// A cluster of more flat colors than this is a gradient: only its loners stay.
const MAX_DENSE_CLUSTER_COLORS: usize = 8;
const MAX_FLAT_COLORS: usize = 96;
/// Most histogram cells the median cut works over (more: coarser cells).
const MAX_COLOR_BUCKETS: usize = 32768;
/// Every pixel is counted, except in fast mode (one pixel in this many).
const FAST_SAMPLE_STEP: usize = 7;

/// Pixel counts and channel sums per histogram cell.
struct Histogram {
    channel_bits: u32,
    counts: Vec<u64>,
    sums: [Vec<u64>; 3],
}

impl Histogram {
    fn new(channel_bits: u32) -> Histogram {
        let cells = 1 << (channel_bits * 3);
        Histogram { channel_bits, counts: vec![0; cells], sums: [vec![0; cells], vec![0; cells], vec![0; cells]] }
    }

    fn clear(&mut self) {
        self.counts.fill(0);
        for sums in &mut self.sums {
            sums.fill(0);
        }
    }

    fn cell(&self, red: u8, green: u8, blue: u8) -> usize {
        let (bits, shift) = (self.channel_bits, 8 - self.channel_bits);
        (((red >> shift) as usize) << (bits * 2)) | (((green >> shift) as usize) << bits) | (blue >> shift) as usize
    }

    fn add(&mut self, red: u8, green: u8, blue: u8) {
        let cell = self.cell(red, green, blue);
        self.counts[cell] += 1;
        self.sums[0][cell] += red as u64;
        self.sums[1][cell] += green as u64;
        self.sums[2][cell] += blue as u64;
    }

    /// The occupied cells as weighted points (their mean colors), leaving
    /// out the pixels of the given flat colors.
    fn points(&self, flats: &[(u32, u64)]) -> Points {
        let mut counts: Vec<i64> = self.counts.iter().map(|&count| count as i64).collect();
        let mut sums: [Vec<i64>; 3] = std::array::from_fn(|channel| self.sums[channel].iter().map(|&sum| sum as i64).collect());
        for &(color, count) in flats {
            let rgb = [color as u8, (color >> 8) as u8, (color >> 16) as u8];
            let cell = self.cell(rgb[0], rgb[1], rgb[2]);
            counts[cell] -= count as i64;
            for channel in 0..3 {
                sums[channel][cell] -= count as i64 * rgb[channel] as i64;
            }
        }
        let occupied: Vec<usize> = (0..counts.len()).filter(|&cell| counts[cell] > 0).collect();
        Points {
            weight: occupied.iter().map(|&cell| (counts[cell] as f64).powf(0.7)).collect(),
            at: std::array::from_fn(|channel| occupied.iter().map(|&cell| sums[channel][cell] as f64 / counts[cell] as f64).collect()),
        }
    }
}

/// Histogram cells as points: a weight and a mean color each.
struct Points {
    weight: Vec<f64>,
    at: [Vec<f64>; 3],
}

/// A box of the median cut: its points, the channel it spreads most along
/// and how much (-1 for a single point).
struct Cut {
    points: Vec<usize>,
    axis: usize,
    spread: f64,
}

impl Points {
    fn cut(&self, points: Vec<usize>) -> Cut {
        let mut axis = 0;
        let mut widest = -1.0;
        for channel in 0..3 {
            let (mut weight, mut sum, mut squares) = (0.0, 0.0, 0.0);
            for &point in &points {
                let value = self.at[channel][point];
                weight += self.weight[point];
                sum += value * self.weight[point];
                squares += value * value * self.weight[point];
            }
            let spread = (squares - sum * sum / weight) * COLOR_WEIGHTS[channel];
            if spread > widest {
                axis = channel;
                widest = spread;
            }
        }
        let spread = if points.len() > 1 { widest } else { -1.0 };
        Cut { points, axis, spread }
    }

    /// Up to `wanted` colors: median cut, then `rounds` k-means rounds.
    fn colors(&self, wanted: usize, rounds: usize) -> Vec<f64> {
        let count = self.weight.len();
        let mut cuts = vec![self.cut((0..count).collect())];
        while cuts.len() < wanted {
            let mut widest = 0;
            for (index, cut) in cuts.iter().enumerate() {
                if cut.spread > cuts[widest].spread {
                    widest = index;
                }
            }
            if cuts[widest].spread <= 0.0 {
                break;
            }
            let Cut { mut points, axis, .. } = std::mem::replace(&mut cuts[widest], Cut { points: Vec::new(), axis: 0, spread: -1.0 });
            let values = &self.at[axis];
            points.sort_by(|a, b| values[*a].partial_cmp(&values[*b]).unwrap_or(std::cmp::Ordering::Equal));
            let (mut weight, mut sum) = (0.0, 0.0);
            for &point in &points {
                weight += self.weight[point];
                sum += values[point] * self.weight[point];
            }
            let mean = sum / weight;
            let mut split = 1;
            while split < points.len() - 1 && values[points[split]] < mean {
                split += 1;
            }
            let upper = points.split_off(split);
            cuts[widest] = self.cut(points);
            cuts.push(self.cut(upper));
        }
        let size = cuts.len();
        let mut owner = vec![0usize; count];
        for (index, cut) in cuts.iter().enumerate() {
            for &point in &cut.points {
                owner[point] = index;
            }
        }
        let mut centers = vec![0.0f64; size * 3];
        for round in 0..=rounds {
            if round > 0 {
                for point in 0..count {
                    let mut best = f64::INFINITY;
                    for center in 0..size {
                        let distance = color_distance(
                            self.at[0][point] - centers[center * 3],
                            self.at[1][point] - centers[center * 3 + 1],
                            self.at[2][point] - centers[center * 3 + 2],
                        );
                        if distance < best {
                            best = distance;
                            owner[point] = center;
                        }
                    }
                }
            }
            let mut weights = vec![0.0f64; size];
            let mut sums = vec![0.0f64; size * 3];
            for point in 0..count {
                let center = owner[point];
                weights[center] += self.weight[point];
                for channel in 0..3 {
                    sums[center * 3 + channel] += self.at[channel][point] * self.weight[point];
                }
            }
            for center in 0..size {
                if weights[center] > 0.0 {
                    for channel in 0..3 {
                        centers[center * 3 + channel] = sums[center * 3 + channel] / weights[center];
                    }
                }
            }
        }
        centers
    }
}

/// Rounds half up, as the palette's colors are stored.
fn to_channel(value: f64) -> u8 {
    (value + 0.5).floor().clamp(0.0, 255.0) as u8
}

fn near_flat(a: u32, b: u32) -> bool {
    [0, 8, 16].iter().all(|shift| (((a >> shift) & 255) as i32 - ((b >> shift) & 255) as i32).abs() <= FLAT_COLOR_CHANNEL_DISTANCE)
}

/// Builds a palette from frames fed one at a time.
pub struct PaletteBuilder {
    fast: bool,
    /// The first colors met, in order (more than 255: too many to keep exactly).
    distinct: Vec<u32>,
    distinct_seen: HashSet<u32>,
    /// Pixels in long runs per color, in the order the colors were first met.
    flat_counts: Vec<(u32, u64)>,
    flat_index: HashMap<u32, usize>,
    total_pixels: u64,
    fine: Histogram,
    coarse: Histogram,
}

impl PaletteBuilder {
    /// A builder; `fast` samples fewer pixels and refines less (for a
    /// single frame's own palette).
    pub fn new(fast: bool) -> PaletteBuilder {
        PaletteBuilder {
            fast,
            distinct: Vec::new(),
            distinct_seen: HashSet::new(),
            flat_counts: Vec::new(),
            flat_index: HashMap::new(),
            total_pixels: 0,
            fine: Histogram::new(6),
            coarse: Histogram::new(5),
        }
    }

    pub fn clear(&mut self) {
        self.distinct.clear();
        self.distinct_seen.clear();
        self.flat_counts.clear();
        self.flat_index.clear();
        self.total_pixels = 0;
        self.fine.clear();
        self.coarse.clear();
    }

    /// Adds a frame of RGBA pixels (alpha is ignored).
    pub fn add(&mut self, rgba: &[u8]) {
        let mut run_color = u32::MAX;
        let mut run_length = 0u64;
        for pixel in pixels(rgba).map(|pixel| pixel & 0xFF_FFFF).chain(std::iter::once(u32::MAX)) {
            if pixel == run_color {
                run_length += 1;
                continue;
            }
            if run_length >= FLAT_RUN_PIXELS {
                self.add_flat(run_color, run_length);
            }
            run_color = pixel;
            run_length = 1;
            if pixel != u32::MAX && self.distinct.len() <= 255 && self.distinct_seen.insert(pixel) {
                self.distinct.push(pixel);
            }
        }
        self.total_pixels += (rgba.len() / 4) as u64;
        let step = if self.fast { FAST_SAMPLE_STEP } else { 1 };
        for pixel in rgba.chunks_exact(4).step_by(step) {
            self.fine.add(pixel[0], pixel[1], pixel[2]);
            self.coarse.add(pixel[0], pixel[1], pixel[2]);
        }
    }

    fn add_flat(&mut self, color: u32, pixels: u64) {
        match self.flat_index.get(&color) {
            Some(&index) => self.flat_counts[index].1 += pixels,
            None => {
                self.flat_index.insert(color, self.flat_counts.len());
                self.flat_counts.push((color, pixels));
            }
        }
    }

    /// The flat colors kept exactly, most used first, with their pixel counts.
    fn flats(&self) -> Vec<(u32, u64)> {
        let least = self.total_pixels as f64 * FLAT_COLOR_SHARE;
        let mut flats: Vec<(u32, u64)> = self.flat_counts.iter().copied().filter(|&(_, count)| count as f64 >= least).collect();
        flats.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
        let mut parent: Vec<usize> = (0..flats.len()).collect();
        fn root(parent: &mut [usize], index: usize) -> usize {
            if parent[index] != index {
                parent[index] = root(parent, parent[index]);
            }
            parent[index]
        }
        for index in 0..flats.len() {
            for other in 0..index {
                if near_flat(flats[index].0, flats[other].0) {
                    let (a, b) = (root(&mut parent, index), root(&mut parent, other));
                    parent[a] = b;
                }
            }
        }
        let mut cluster_sizes: HashMap<usize, usize> = HashMap::new();
        for index in 0..flats.len() {
            *cluster_sizes.entry(root(&mut parent, index)).or_default() += 1;
        }
        let mut kept = Vec::new();
        for index in 0..flats.len() {
            let color = flats[index].0;
            let small_cluster = cluster_sizes[&root(&mut parent, index)] <= MAX_DENSE_CLUSTER_COLORS;
            if small_cluster || flats.iter().filter(|&&(other, _)| other != color && near_flat(color, other)).count() < 2 {
                kept.push(flats[index]);
            }
            if kept.len() == MAX_FLAT_COLORS {
                break;
            }
        }
        kept
    }

    /// The palette as RGB triples, at most 255 colors.
    pub fn finish(&self) -> Vec<u8> {
        if self.distinct.len() <= 255 {
            return packed_to_rgb(self.distinct.iter().copied());
        }
        let flats = self.flats();
        let wanted = 255 - flats.len();
        let rounds = if self.fast { 1 } else { 3 };
        let subtracted: &[(u32, u64)] = if self.fast { &[] } else { &flats };
        let mut points = self.fine.points(subtracted);
        if points.weight.len() > MAX_COLOR_BUCKETS {
            points = self.coarse.points(subtracted);
        }
        let mut rgb = packed_to_rgb(flats.iter().map(|&(color, _)| color));
        let count = points.weight.len();
        if count <= wanted {
            for point in 0..count {
                for channel in 0..3 {
                    rgb.push(to_channel(points.at[channel][point]));
                }
            }
            return rgb;
        }
        rgb.extend(points.colors(wanted, rounds).into_iter().map(to_channel));
        rgb
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: usize, height: usize, pixel: impl Fn(usize, usize) -> [u8; 3]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                let [r, g, b] = pixel(x, y);
                rgba.extend_from_slice(&[r, g, b, 255]);
            }
        }
        rgba
    }

    #[test]
    fn few_colors_are_kept_exactly_in_order() {
        let mut builder = PaletteBuilder::new(false);
        builder.add(&frame(4, 2, |x, _| if x < 2 { [10, 20, 30] } else { [200, 100, 0] }));
        assert_eq!(builder.finish(), vec![10, 20, 30, 200, 100, 0]);
    }

    #[test]
    fn many_colors_make_a_full_palette_keeping_the_background() {
        let mut builder = PaletteBuilder::new(false);
        // A flat background with a gradient square.
        builder.add(&frame(256, 256, |x, y| if (64..192).contains(&x) && (64..192).contains(&y) { [x as u8, y as u8, 128] } else { [12, 34, 56] }));
        let palette = builder.finish();
        assert_eq!(palette.len(), 255 * 3);
        assert_eq!(&palette[..3], &[12, 34, 56], "the flat background comes first, exact");
    }

    #[test]
    fn fast_mode_also_fills_the_palette() {
        let mut builder = PaletteBuilder::new(true);
        builder.add(&frame(200, 200, |x, y| [x as u8, y as u8, (x + y) as u8]));
        let palette = builder.finish();
        assert!(palette.len() > 200 * 3 && palette.len() <= 255 * 3);
    }
}
