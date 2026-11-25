//! The QuickTime movie around the samples: `ftyp`, the `moov` atom with a
//! video track (`rle `) and, when there is sound, a track of 16-bit
//! little-endian PCM (`sowt`), then one `mdat` holding the samples. Sound
//! goes in a chunk every half second, ahead of the frames it plays under.
//!
//! The sample bytes stay with the caller: [`Movie::finish`] gives the header
//! and the order of the pieces that follow it.

use super::rle::RleSample;

/// What becomes of a frame that repeats the one before.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Repeats {
    /// A 7-byte sample: players keep showing the frame before.
    Unchanged,
    /// The repeated key frame's bytes are stored once, and both samples point at them.
    Shared,
    /// Every frame stored whole.
    Whole,
}

/// What a frame stores.
pub enum Stored<'a> {
    Bytes(&'a [u8]),
    /// Nothing new: the sample points at the bytes of the frame before.
    SharesPrevious,
}

/// The sample of a frame that is the frame before.
pub const UNCHANGED_SAMPLE: [u8; 7] = [0, 0, 0, 7, 0, 0, 0];

/// One piece of the `mdat`, in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Piece {
    /// The stored bytes of frame `n`.
    Frame(u32),
    /// PCM sample frames `from..to`.
    Sound { from: u64, to: u64 },
}

/// The movie's sound: `frames` sample frames of `channels` × 16 bits.
#[derive(Clone, Copy, Debug)]
pub struct Sound {
    pub frames: u64,
    pub sample_rate: u32,
    pub channels: u16,
}

struct Frame {
    size: u32,
    key: bool,
    shares_previous: bool,
}

#[derive(Clone, Copy)]
struct Chunk {
    at: u64,
    samples: u32,
}

struct Track {
    id: u32,
    sound: bool,
    timescale: u32,
    samples: u32,
    ticks_per_sample: u32,
    /// One size for all (sound), or each sample's.
    sizes: Result<u32, Vec<u32>>,
    chunks: Vec<Chunk>,
    keys: Option<Vec<u32>>,
    width: u16,
    height: u16,
    description: Vec<u8>,
}

/// A movie being laid out, frame by frame.
pub struct Movie {
    width: u16,
    height: u16,
    fps: f64,
    repeats: Repeats,
    frames: Vec<Frame>,
    bytes: u64,
}

/// Bytes of an atom body, written big-endian.
#[derive(Default)]
struct Body(Vec<u8>);

impl Body {
    fn u16(mut self, value: u16) -> Body {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }
    fn u32(mut self, value: u32) -> Body {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }
    fn u64(mut self, value: u64) -> Body {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }
    fn zeros(mut self, count: usize) -> Body {
        self.0.resize(self.0.len() + count, 0);
        self
    }
    fn fixed(self, value: f64) -> Body {
        self.u32((value * 65536.0).round() as u32)
    }
    fn text(mut self, text: &str) -> Body {
        self.0.extend_from_slice(text.as_bytes());
        self
    }
    fn pascal(mut self, text: &str) -> Body {
        self.0.push(text.len() as u8);
        self.text(text)
    }
    fn bytes(mut self, bytes: &[u8]) -> Body {
        self.0.extend_from_slice(bytes);
        self
    }
    fn matrix(self) -> Body {
        self.fixed(1.0).zeros(12).fixed(1.0).zeros(12).u32(0x4000_0000)
    }
    fn atom(self, kind: &str) -> Vec<u8> {
        Body::default().u32(8 + self.0.len() as u32).text(kind).bytes(&self.0).0
    }
    /// An atom with a version (0) and flags word first.
    fn full_atom(self, kind: &str, flags: u32) -> Vec<u8> {
        Body::default().u32(flags).bytes(&self.0).atom(kind)
    }
}

fn track_atom(track: &Track, movie_timescale: u32, data_offset: u64) -> Vec<u8> {
    let ticks = track.samples as u64 * track.ticks_per_sample as u64;
    let duration = (ticks * movie_timescale as u64).div_ceil(track.timescale as u64) as u32;
    let mut sample_to_chunk = Body::default();
    let mut runs = 0;
    for (index, chunk) in track.chunks.iter().enumerate() {
        if index > 0 && track.chunks[index - 1].samples == chunk.samples {
            continue;
        }
        sample_to_chunk = sample_to_chunk.u32(index as u32 + 1).u32(chunk.samples).u32(1);
        runs += 1;
    }
    let header = if track.sound {
        Body::default().zeros(4).full_atom("smhd", 0)
    } else {
        Body::default().zeros(8).full_atom("vmhd", 1)
    };
    let sizes = match &track.sizes {
        Ok(size) => Body::default().u32(*size).u32(track.samples),
        Err(sizes) => sizes.iter().fold(Body::default().u32(0).u32(track.samples), |body, &size| body.u32(size)),
    };
    let offsets = track.chunks.iter().fold(Body::default().u32(track.chunks.len() as u32), |body, chunk| body.u64(data_offset + chunk.at));
    let keys = match &track.keys {
        Some(keys) => keys.iter().fold(Body::default().u32(keys.len() as u32), |body, &key| body.u32(key)).full_atom("stss", 0),
        None => Vec::new(),
    };
    let table = Body::default()
        .bytes(&Body::default().u32(1).bytes(&track.description).full_atom("stsd", 0))
        .bytes(&Body::default().u32(1).u32(track.samples).u32(track.ticks_per_sample).full_atom("stts", 0))
        .bytes(&keys)
        .bytes(&Body::default().u32(runs).bytes(&sample_to_chunk.0).full_atom("stsc", 0))
        .bytes(&sizes.full_atom("stsz", 0))
        .bytes(&offsets.full_atom("co64", 0))
        .atom("stbl");
    let media_info = Body::default()
        .bytes(&header)
        .bytes(&Body::default().text("dhlr").text("url ").zeros(12).pascal("DataHandler").full_atom("hdlr", 0))
        .bytes(&Body::default().bytes(&Body::default().u32(1).bytes(&Body::default().full_atom("url ", 1)).full_atom("dref", 0)).atom("dinf"))
        .bytes(&table)
        .atom("minf");
    let media = Body::default()
        .bytes(&Body::default().zeros(8).u32(track.timescale).u32(ticks as u32).u16(32767).zeros(2).full_atom("mdhd", 0))
        .bytes(
            &Body::default()
                .text("mhlr")
                .text(if track.sound { "soun" } else { "vide" })
                .zeros(12)
                .pascal(if track.sound { "SoundHandler" } else { "VideoHandler" })
                .full_atom("hdlr", 0),
        )
        .bytes(&media_info)
        .atom("mdia");
    Body::default()
        .bytes(
            &Body::default()
                .zeros(8)
                .u32(track.id)
                .zeros(4)
                .u32(duration)
                .zeros(12)
                .u16(if track.sound { 256 } else { 0 })
                .zeros(2)
                .matrix()
                .fixed(track.width as f64)
                .fixed(track.height as f64)
                .full_atom("tkhd", 3),
        )
        .bytes(&Body::default().bytes(&Body::default().u32(1).u32(duration).u32(0).fixed(1.0).full_atom("elst", 0)).atom("edts"))
        .bytes(&media)
        .atom("trak")
}

impl Movie {
    pub fn new(width: u16, height: u16, fps: f64, repeats: Repeats) -> Movie {
        Movie { width, height, fps: if fps.is_finite() && fps > 0.0 { fps } else { 30.0 }, repeats, frames: Vec::new(), bytes: 0 }
    }

    /// Takes the next frame's sample: what to store of it.
    pub fn add<'a>(&mut self, sample: &RleSample<'a>) -> Stored<'a> {
        let previous_size = self.frames.last().map_or(0, |frame| frame.size);
        let (stored, key) = if sample.same && self.repeats == Repeats::Unchanged {
            (Stored::Bytes(&UNCHANGED_SAMPLE), false)
        } else if sample.repeat && self.repeats == Repeats::Shared {
            (Stored::SharesPrevious, sample.key)
        } else {
            (Stored::Bytes(sample.data), sample.key)
        };
        let (size, shares_previous) = match stored {
            Stored::Bytes(bytes) => (bytes.len() as u32, false),
            Stored::SharesPrevious => (previous_size, true),
        };
        if !shares_previous {
            self.bytes += size as u64;
        }
        self.frames.push(Frame { size, key, shares_previous });
        stored
    }

    /// The bytes of the frames stored so far.
    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    /// The bytes ahead of the samples, and the order the stored frames and the sound follow in.
    pub fn finish(&self, sound: Option<Sound>) -> (Vec<u8>, Vec<Piece>) {
        let timescale = (self.fps * 100.0).round().max(1.0) as u32;
        let frame_count = self.frames.len();
        let sound = sound.filter(|sound| sound.frames > 0 && sound.channels > 0 && sound.sample_rate > 0);
        let bytes_per_sound_frame = sound.map_or(0, |sound| sound.channels as u64 * 2);
        let frames_per_sound_chunk = (self.fps / 2.0).round().max(1.0) as usize;
        let mut pieces = Vec::new();
        let mut frame_chunks: Vec<Chunk> = Vec::with_capacity(frame_count);
        let mut sound_chunks = Vec::new();
        let (mut at, mut sound_written) = (0u64, 0u64);
        for (index, frame) in self.frames.iter().enumerate() {
            if let Some(sound) = sound
                && index % frames_per_sound_chunk == 0
            {
                let until = if index + frames_per_sound_chunk >= frame_count {
                    sound.frames
                } else {
                    sound.frames.min((((index + frames_per_sound_chunk) as f64 / self.fps) * sound.sample_rate as f64).round() as u64)
                };
                if until > sound_written {
                    pieces.push(Piece::Sound { from: sound_written, to: until });
                    sound_chunks.push(Chunk { at, samples: (until - sound_written) as u32 });
                    at += (until - sound_written) * bytes_per_sound_frame;
                    sound_written = until;
                }
            }
            if frame.shares_previous && index > 0 {
                frame_chunks.push(frame_chunks[index - 1]);
                continue;
            }
            pieces.push(Piece::Frame(index as u32));
            frame_chunks.push(Chunk { at, samples: 1 });
            at += frame.size as u64;
        }

        let keys: Vec<u32> = self.frames.iter().enumerate().filter(|(_, frame)| frame.key).map(|(index, _)| index as u32 + 1).collect();
        let mut tracks = vec![Track {
            id: 1,
            sound: false,
            timescale,
            samples: frame_count as u32,
            ticks_per_sample: 100,
            sizes: Err(self.frames.iter().map(|frame| frame.size).collect()),
            chunks: frame_chunks,
            keys: if keys.len() == frame_count { None } else { Some(keys) },
            width: self.width,
            height: self.height,
            description: Body::default()
                .zeros(6)
                .u16(1)
                .zeros(8)
                .u32(512)
                .u32(512)
                .u16(self.width)
                .u16(self.height)
                .fixed(72.0)
                .fixed(72.0)
                .zeros(4)
                .u16(1)
                .pascal("Animation")
                .zeros(22)
                .u16(32)
                .u16(0xffff)
                .atom("rle "),
        }];
        if let Some(sound) = sound
            && sound_written > 0
        {
            let channels = sound.channels as u32;
            tracks.push(Track {
                id: 2,
                sound: true,
                timescale: sound.sample_rate,
                samples: sound_written as u32,
                ticks_per_sample: 1,
                sizes: Ok(bytes_per_sound_frame as u32),
                chunks: sound_chunks,
                keys: None,
                width: 0,
                height: 0,
                description: Body::default()
                    .zeros(6)
                    .u16(1)
                    .zeros(8)
                    .u16(sound.channels)
                    .u16(16)
                    .zeros(4)
                    .fixed(sound.sample_rate as f64)
                    .bytes(&Body::default().u32(((99 + channels) << 16) | channels).zeros(8).full_atom("chan", 0))
                    .atom("sowt"),
            });
        }
        let duration = tracks
            .iter()
            .map(|track| (track.samples as u64 * track.ticks_per_sample as u64 * timescale as u64).div_ceil(track.timescale as u64))
            .max()
            .unwrap_or(0) as u32;
        let movie = |data_offset: u64| {
            tracks.iter().fold(
                Body::default().bytes(
                    &Body::default()
                        .zeros(8)
                        .u32(timescale)
                        .u32(duration)
                        .fixed(1.0)
                        .u16(256)
                        .zeros(10)
                        .matrix()
                        .zeros(24)
                        .u32(tracks.len() as u32 + 1)
                        .full_atom("mvhd", 0),
                ),
                |body, track| body.bytes(&track_atom(track, timescale, data_offset)),
            )
            .atom("moov")
        };
        let file_type = Body::default().text("qt  ").u32(0x200).text("qt  ").atom("ftyp");
        let data_offset = (file_type.len() + movie(0).len() + 16) as u64;
        let header = Body::default()
            .bytes(&file_type)
            .bytes(&movie(data_offset))
            .u32(1)
            .text("mdat")
            .u64(16 + at)
            .0;
        (header, pieces)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mov::rle::{RleEncoder, decode};

    /// The atoms of `bytes` (kind, body), not descending.
    fn atoms(bytes: &[u8]) -> Vec<(String, &[u8])> {
        let mut found = Vec::new();
        let mut at = 0;
        while at + 8 <= bytes.len() {
            let mut size = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
            let kind = String::from_utf8_lossy(&bytes[at + 4..at + 8]).into_owned();
            let mut head = 8;
            if size == 1 {
                size = u64::from_be_bytes(bytes[at + 8..at + 16].try_into().unwrap()) as usize;
                head = 16;
            }
            let end = (at + size).min(bytes.len());
            found.push((kind, &bytes[at + head..end]));
            at += size;
        }
        found
    }

    /// The body of the atom at `path` (kinds from the top; a full atom's version and flags kept).
    fn find<'a>(bytes: &'a [u8], path: &[&str]) -> &'a [u8] {
        let skip = |kind: &str| match kind {
            "stsd" => 8,
            "dref" => 8,
            _ => 0,
        };
        let mut body = bytes;
        let mut parent = "";
        for kind in path {
            let children = &body[skip(parent)..];
            body = atoms(children).into_iter().find(|(found, _)| found == kind).unwrap_or_else(|| panic!("no {kind} in {parent}")).1;
            parent = kind;
        }
        body
    }

    fn tracks(moov: &[u8]) -> Vec<&[u8]> {
        atoms(moov).into_iter().filter(|(kind, _)| kind == "trak").map(|(_, body)| body).collect()
    }

    fn word(bytes: &[u8], at: usize) -> u32 {
        u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    fn assemble(header: &[u8], pieces: &[Piece], stored: &[Vec<u8>], pcm: &[u8], channels: u64) -> Vec<u8> {
        let mut file = header.to_vec();
        for piece in pieces {
            match *piece {
                Piece::Frame(index) => file.extend_from_slice(&stored[index as usize]),
                Piece::Sound { from, to } => file.extend_from_slice(&pcm[(from * channels * 2) as usize..(to * channels * 2) as usize]),
            }
        }
        file
    }

    #[test]
    fn writes_a_quicktime_movie_whose_tables_find_every_sample() {
        let (width, height, fps) = (6usize, 4usize, 10.0);
        let mut encoder = RleEncoder::new(width as u32, height as u32, 1).unwrap();
        let mut movie = Movie::new(width as u16, height as u16, fps, Repeats::Unchanged);
        let frames: Vec<Vec<u8>> = (0..12usize)
            .map(|step| (0..width * height).flat_map(|pixel| [(pixel * 9) as u8, (step / 3 * 40) as u8, 0, if pixel % 2 == 0 { 255 } else { 0 }]).collect())
            .collect();
        let mut stored = Vec::new();
        for frame in &frames {
            let sample = encoder.encode(frame).unwrap();
            match movie.add(&sample) {
                Stored::Bytes(bytes) => stored.push(bytes.to_vec()),
                Stored::SharesPrevious => unreachable!(),
            }
        }
        let pcm: Vec<u8> = (0..48_000u32 * 12 / 10 * 2 * 2).map(|index| index as u8).collect();
        let sound = Sound { frames: (pcm.len() / 4) as u64, sample_rate: 48_000, channels: 2 };
        let (header, pieces) = movie.finish(Some(sound));
        let file = assemble(&header, &pieces, &stored, &pcm, 2);

        let top = atoms(&file);
        assert_eq!(top.iter().map(|(kind, _)| kind.as_str()).collect::<Vec<_>>(), ["ftyp", "moov", "mdat"]);
        assert_eq!(top[0].1, b"qt  \0\0\x02\0qt  ");
        assert_eq!(top[2].1.len() as u64, stored.iter().map(|bytes| bytes.len() as u64).sum::<u64>() + pcm.len() as u64);
        let moov = top[1].1;
        let mvhd = find(moov, &["mvhd"]);
        assert_eq!((word(mvhd, 12), word(mvhd, 16)), (1000, 1200), "timescale fps × 100, 12 frames of 100 ticks");

        let [video, audio] = tracks(moov)[..] else { panic!("two tracks") };
        let stsd = find(video, &["mdia", "minf", "stbl", "stsd"]);
        assert_eq!(&stsd[12..16], b"rle ");
        let description = &stsd[16..];
        assert_eq!(u16::from_be_bytes([description[24], description[25]]) as usize, width);
        assert_eq!(&description[43..52], b"Animation");
        assert_eq!(&description[74..78], &[0, 32, 0xff, 0xff], "32-bit ARGB, no color table");

        let sizes = find(video, &["mdia", "minf", "stbl", "stsz"]);
        let offsets = find(video, &["mdia", "minf", "stbl", "co64"]);
        let sample_to_chunk = find(video, &["mdia", "minf", "stbl", "stsc"]);
        assert_eq!(&sample_to_chunk[4..], &[0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
        let mut canvas = vec![0; width * height * 4];
        for index in 0..frames.len() {
            let size = word(sizes, 12 + index * 4) as usize;
            let at = u64::from_be_bytes(offsets[8 + index * 8..16 + index * 8].try_into().unwrap()) as usize;
            decode(&file[at..at + size], width, height, &mut canvas);
            assert_eq!(canvas, frames[index], "frame {index}");
        }
        let stss = atoms(find(video, &["mdia", "minf", "stbl"])).into_iter().find(|(kind, _)| kind == "stss").map(|(_, body)| body.to_vec());
        assert_eq!(stss.map(|body| word(&body, 4)), Some(4), "frames repeating the one before are not sync samples");

        assert_eq!(&find(audio, &["mdia", "hdlr"])[8..12], b"soun");
        let sowt = find(audio, &["mdia", "minf", "stbl", "stsd"]);
        assert_eq!(&sowt[12..16], b"sowt");
        assert_eq!(&sowt[32..36], &[0, 2, 0, 16], "stereo, 16 bits");
        let audio_sizes = find(audio, &["mdia", "minf", "stbl", "stsz"]);
        assert_eq!((word(audio_sizes, 4), word(audio_sizes, 8) as u64), (4, sound.frames));
        let audio_offsets = find(audio, &["mdia", "minf", "stbl", "co64"]);
        let chunks = word(audio_offsets, 4) as usize;
        assert_eq!(chunks, 3, "a chunk every half second");
        let first = u64::from_be_bytes(audio_offsets[8..16].try_into().unwrap()) as usize;
        assert_eq!(&file[first..first + 16], &pcm[..16]);
        let mdhd = find(audio, &["mdia", "mdhd"]);
        assert_eq!((word(mdhd, 12), word(mdhd, 16) as u64), (48_000, sound.frames));
    }

    #[test]
    fn shared_repeats_point_at_the_same_bytes() {
        let mut encoder = RleEncoder::new(2, 2, 1).unwrap();
        let mut movie = Movie::new(2, 2, 30.0, Repeats::Shared);
        let still = [7u8; 16];
        let mut stored = Vec::new();
        for _ in 0..3 {
            let sample = encoder.encode(&still).unwrap();
            match movie.add(&sample) {
                Stored::Bytes(bytes) => stored.push(bytes.to_vec()),
                Stored::SharesPrevious => stored.push(Vec::new()),
            }
        }
        assert!(stored[1].is_empty() && stored[2].is_empty());
        assert_eq!(movie.bytes(), stored[0].len() as u64);
        let (header, pieces) = movie.finish(None);
        assert_eq!(pieces, [Piece::Frame(0)]);
        let moov = atoms(&header)[1].1;
        let [video] = tracks(moov)[..] else { panic!("one track") };
        let offsets = find(video, &["mdia", "minf", "stbl", "co64"]);
        assert_eq!(word(offsets, 4), 3);
        assert!(offsets[8..16] == offsets[16..24] && offsets[16..24] == offsets[24..32]);
        assert_eq!(u64::from_be_bytes(offsets[8..16].try_into().unwrap()), header.len() as u64);
    }

    #[test]
    fn unchanged_frames_store_seven_bytes() {
        let mut encoder = RleEncoder::new(2, 1, 1).unwrap();
        let mut movie = Movie::new(2, 1, 24.0, Repeats::Unchanged);
        let frame = [1u8, 2, 3, 4, 5, 6, 7, 8];
        let first = encoder.encode(&frame).unwrap();
        assert!(matches!(movie.add(&first), Stored::Bytes(bytes) if bytes.len() > 7));
        let again = encoder.encode(&frame).unwrap();
        assert!(matches!(movie.add(&again), Stored::Bytes(bytes) if bytes == UNCHANGED_SAMPLE));
    }
}
