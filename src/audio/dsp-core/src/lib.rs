use std::f32::consts::PI;
use wasm_bindgen::prelude::*;

const TWO_PI: f32 = 2.0 * PI;

pub const PARAM_RPM: u32 = 0;
pub const PARAM_BLADES: u32 = 1;
pub const PARAM_GAIN: u32 = 2;
pub const PARAM_ENGINE_MIX: u32 = 3;
pub const PARAM_CAV_MIX: u32 = 4;
pub const PARAM_BIO_MIX: u32 = 5;
pub const PARAM_BIO_TYPE: u32 = 6;
pub const PARAM_BIO_RATE: u32 = 7;

#[inline]
fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    v.max(lo).min(hi)
}

#[inline]
fn xorshift32(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

#[inline]
fn rand_signed(state: &mut u32) -> f32 {
    let x = xorshift32(state);
    (x as f32 / u32::MAX as f32) * 2.0 - 1.0
}

#[derive(Clone, Copy)]
struct EngineState {
    phase: f32,
    current_rpm: f32,
    target_rpm: f32,
    blades: f32,
}

impl EngineState {
    fn new() -> Self {
        Self {
            phase: 0.0,
            current_rpm: 0.0,
            target_rpm: 0.0,
            blades: 5.0,
        }
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32) -> f32 {
        self.current_rpm = self.current_rpm * 0.99 + self.target_rpm * 0.01;
        if self.current_rpm < 0.05 {
            return 0.0;
        }

        let base_hz = (self.current_rpm / 60.0) * self.blades;
        let delta = TWO_PI * base_hz / sample_rate;
        self.phase += delta;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        let p = self.phase;
        let harmonic_signal = p.sin() * 0.60
            + (2.0 * p).sin() * 0.25
            + (3.0 * p).sin() * 0.15
            + (0.5 * p).sin() * 0.05;

        let amplitude = (self.current_rpm / 220.0).min(0.30);
        (harmonic_signal * 1.5).tanh() * amplitude
    }
}

#[derive(Clone, Copy)]
struct CavState {
    filtered_noise: f32,
}

impl CavState {
    fn new() -> Self {
        Self {
            filtered_noise: 0.0,
        }
    }

    #[inline]
    fn tick(&mut self, rpm: f32, phase: f32, rng: &mut u32) -> f32 {
        if rpm < 1.0 {
            self.filtered_noise = 0.0;
            return 0.0;
        }

        let white = rand_signed(rng);
        self.filtered_noise += 0.22 * (white - self.filtered_noise);

        let speed_norm = clamp((rpm - 60.0) / 320.0, 0.0, 1.0);
        let intensity = 0.01 + speed_norm * speed_norm * 0.55;
        let blade_mod = 0.5 + 0.5 * phase.sin();

        self.filtered_noise * intensity * (0.5 + 0.5 * blade_mod)
    }
}

#[derive(Clone, Copy)]
struct ChirpState {
    // Samples until next trigger.
    samples_to_next: u32,
    // Envelope for current event.
    env: f32,
    // Current oscillator phase.
    phase: f32,
    // Chirp start frequency.
    start_hz: f32,
    // Chirp end frequency.
    end_hz: f32,
    // Progress through chirp envelope [0..1].
    progress: f32,
}

impl ChirpState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            env: 0.0,
            phase: 0.0,
            start_hz: 1600.0,
            end_hz: 450.0,
            progress: 1.0,
        }
    }

    #[inline]
    fn schedule_next(&mut self, sample_rate: f32, rpm: f32, bio_rate: f32, rng: &mut u32) {
        let speed = clamp(rpm / 280.0, 0.0, 1.0);
        let rate_scale = 1.25 - 0.8 * bio_rate;
        let base_ms = 110.0 - 70.0 * speed;
        let jitter = 0.55 + 0.9 * ((xorshift32(rng) as f32) / u32::MAX as f32);
        let ms = (base_ms * rate_scale * jitter).max(12.0);
        self.samples_to_next = (sample_rate * ms * 0.001) as u32;
    }

    #[inline]
    fn trigger_click(&mut self, rpm: f32, rng: &mut u32) {
        let speed = clamp(rpm / 280.0, 0.0, 1.0);
        let rnd = (xorshift32(rng) as f32) / u32::MAX as f32;
        self.env = 0.9;
        self.phase = 0.0;
        self.progress = 0.0;
        self.start_hz = 1400.0 + 1200.0 * speed + 300.0 * rnd;
        self.end_hz = 300.0 + 450.0 * (1.0 - speed);
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, rpm: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.samples_to_next == 0 {
            self.trigger_click(rpm, rng);
            self.schedule_next(sample_rate, rpm, bio_rate, rng);
        } else {
            self.samples_to_next -= 1;
        }

        if self.env <= 0.0001 {
            return 0.0;
        }

        let t = self.progress;
        let chirp_hz = self.start_hz + (self.end_hz - self.start_hz) * t;
        self.phase += TWO_PI * chirp_hz / sample_rate;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        // Fast decay envelope for short transients.
        self.env *= 0.94;
        self.progress = (self.progress + 0.045).min(1.0);

        self.phase.sin() * self.env
    }
}

#[derive(Clone, Copy)]
struct SnappingShrimpState {
    samples_to_next: u32,
    burst_left: u32,
    env: f32,
    hp_state: f32,
}

impl SnappingShrimpState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            burst_left: 0,
            env: 0.0,
            hp_state: 0.0,
        }
    }

    #[inline]
    fn schedule_next(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) {
        let jitter = 0.4 + 1.2 * ((xorshift32(rng) as f32) / u32::MAX as f32);
        let base_ms = 140.0 - 136.0 * bio_rate;
        let ms = (base_ms * jitter).max(1.0);
        self.samples_to_next = (sample_rate * ms * 0.001) as u32;
    }

    #[inline]
    fn trigger_snap(&mut self, sample_rate: f32, rng: &mut u32) {
        let dur_ms = 1.0 + ((xorshift32(rng) as f32) / u32::MAX as f32);
        self.burst_left = (sample_rate * dur_ms * 0.001) as u32;
        self.env = 1.0;
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.samples_to_next == 0 {
            self.trigger_snap(sample_rate, rng);
            self.schedule_next(sample_rate, bio_rate, rng);
        } else {
            self.samples_to_next -= 1;
        }

        if self.burst_left == 0 && self.env < 0.0001 {
            return 0.0;
        }

        let white = rand_signed(rng);
        // Cheap one-pole low-pass used to derive a high-pass transient component.
        self.hp_state += 0.30 * (white - self.hp_state);
        let transient = white - self.hp_state;

        if self.burst_left > 0 {
            self.burst_left -= 1;
            self.env *= 0.72;
        } else {
            self.env *= 0.2;
        }

        transient * self.env * 0.9
    }
}

#[derive(Clone, Copy)]
struct WhaleMoanState {
    phase: f32,
    lfo_phase: f32,
    drift: f32,
}

impl WhaleMoanState {
    fn new() -> Self {
        Self {
            phase: 0.0,
            lfo_phase: 0.0,
            drift: 0.0,
        }
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        let drift_target = rand_signed(rng) * 0.02;
        self.drift += 0.0008 * (drift_target - self.drift);

        let lfo_hz = 0.08 + bio_rate * 0.32;
        self.lfo_phase += TWO_PI * lfo_hz / sample_rate;
        if self.lfo_phase >= TWO_PI {
            self.lfo_phase -= TWO_PI;
        }

        let base_hz = 40.0 + 110.0 * bio_rate;
        let wobble = self.lfo_phase.sin() * (10.0 + 20.0 * bio_rate);
        let inst_hz = (base_hz + wobble + self.drift * 140.0).max(20.0);
        self.phase += TWO_PI * inst_hz / sample_rate;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        let p = self.phase;
        let moan = p.sin() * 0.75 + (0.5 * p).sin() * 0.35 + (1.5 * p).sin() * 0.12;
        moan * 0.42
    }
}

#[derive(Clone, Copy)]
struct DolphinWhistleState {
    samples_to_next: u32,
    env: f32,
    phase: f32,
    start_hz: f32,
    end_hz: f32,
    progress: f32,
    vibrato_phase: f32,
}

impl DolphinWhistleState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            env: 0.0,
            phase: 0.0,
            start_hz: 5000.0,
            end_hz: 7600.0,
            progress: 1.0,
            vibrato_phase: 0.0,
        }
    }

    #[inline]
    fn schedule_next(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) {
        let jitter = 0.6 + ((xorshift32(rng) as f32) / u32::MAX as f32);
        let base_ms = 320.0 - 210.0 * bio_rate;
        let ms = (base_ms * jitter).max(35.0);
        self.samples_to_next = (sample_rate * ms * 0.001) as u32;
    }

    #[inline]
    fn trigger_whistle(&mut self, rng: &mut u32, bio_rate: f32) {
        let r0 = (xorshift32(rng) as f32) / u32::MAX as f32;
        let r1 = (xorshift32(rng) as f32) / u32::MAX as f32;
        let start = 3200.0 + r0 * 6800.0;
        let span = (r1 * 2.0 - 1.0) * (1500.0 + 1900.0 * bio_rate);
        self.start_hz = start;
        self.end_hz = clamp(start + span, 3000.0, 15000.0);
        self.phase = 0.0;
        self.progress = 0.0;
        self.env = 1.0;
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.samples_to_next == 0 {
            self.trigger_whistle(rng, bio_rate);
            self.schedule_next(sample_rate, bio_rate, rng);
        } else {
            self.samples_to_next -= 1;
        }

        if self.env <= 0.0001 {
            return 0.0;
        }

        let t = self.progress;
        let curved = t * t * (3.0 - 2.0 * t);
        let glide_hz = self.start_hz + (self.end_hz - self.start_hz) * curved;
        self.vibrato_phase += TWO_PI * (5.0 + 3.0 * bio_rate) / sample_rate;
        if self.vibrato_phase >= TWO_PI {
            self.vibrato_phase -= TWO_PI;
        }
        let vib = 1.0 + 0.015 * self.vibrato_phase.sin();
        self.phase += TWO_PI * glide_hz * vib / sample_rate;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        self.env *= 0.9965;
        self.progress = (self.progress + (0.0018 + 0.0012 * bio_rate)).min(1.0);
        self.phase.sin() * self.env * 0.30
    }
}

#[derive(Clone, Copy)]
struct EcholocationClickState {
    samples_to_next: u32,
    burst_left: u32,
    phase: f32,
    env: f32,
    click_hz: f32,
}

impl EcholocationClickState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            burst_left: 0,
            phase: 0.0,
            env: 0.0,
            click_hz: 9500.0,
        }
    }

    #[inline]
    fn schedule_next(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) {
        let jitter = 0.7 + 0.6 * ((xorshift32(rng) as f32) / u32::MAX as f32);
        let base_ms = 60.0 - 55.0 * bio_rate;
        let ms = (base_ms * jitter).max(1.2);
        self.samples_to_next = (sample_rate * ms * 0.001) as u32;
    }

    #[inline]
    fn trigger_click(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) {
        let r = (xorshift32(rng) as f32) / u32::MAX as f32;
        self.click_hz = 7000.0 + 7000.0 * (0.35 * bio_rate + 0.65 * r);
        self.burst_left = (sample_rate * 0.00025) as u32 + 1;
        self.phase = 0.0;
        self.env = 1.0;
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.samples_to_next == 0 {
            self.trigger_click(sample_rate, bio_rate, rng);
            self.schedule_next(sample_rate, bio_rate, rng);
        } else {
            self.samples_to_next -= 1;
        }

        if self.burst_left == 0 {
            self.env *= 0.05;
            return 0.0;
        }

        self.burst_left -= 1;
        self.phase += TWO_PI * self.click_hz / sample_rate;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }
        self.env *= 0.45;
        self.phase.sin() * self.env * 0.85
    }
}

#[derive(Clone, Copy)]
struct HumpbackSongState {
    samples_to_next: u32,
    unit_samples_left: u32,
    unit_kind: u32,
    phase: f32,
    mod_phase: f32,
    env: f32,
    current_hz: f32,
    target_hz: f32,
    unit_progress: f32,
}

impl HumpbackSongState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            unit_samples_left: 0,
            unit_kind: 0,
            phase: 0.0,
            mod_phase: 0.0,
            env: 0.0,
            current_hz: 220.0,
            target_hz: 220.0,
            unit_progress: 1.0,
        }
    }

    #[inline]
    fn schedule_gap(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) {
        let jitter = 0.6 + ((xorshift32(rng) as f32) / u32::MAX as f32);
        let base_ms = 320.0 - 220.0 * bio_rate;
        let gap_ms = (base_ms * jitter).max(30.0);
        self.samples_to_next = (sample_rate * gap_ms * 0.001) as u32;
    }

    #[inline]
    fn trigger_unit(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) {
        self.unit_kind = xorshift32(rng) % 3;
        self.phase = 0.0;
        self.mod_phase = 0.0;
        self.env = 1.0;
        self.unit_progress = 0.0;

        match self.unit_kind {
            // Low moan unit
            0 => {
                let dur_ms = 450.0 + 650.0 * ((xorshift32(rng) as f32) / u32::MAX as f32);
                self.unit_samples_left = (sample_rate * dur_ms * 0.001) as u32;
                self.target_hz = 55.0 + 110.0 * bio_rate;
            }
            // Mid whistle unit
            1 => {
                let dur_ms = 260.0 + 420.0 * ((xorshift32(rng) as f32) / u32::MAX as f32);
                self.unit_samples_left = (sample_rate * dur_ms * 0.001) as u32;
                self.target_hz = 380.0 + 620.0 * ((xorshift32(rng) as f32) / u32::MAX as f32);
            }
            // Rising/falling unit
            _ => {
                let dur_ms = 320.0 + 480.0 * ((xorshift32(rng) as f32) / u32::MAX as f32);
                self.unit_samples_left = (sample_rate * dur_ms * 0.001) as u32;
                self.target_hz = 120.0 + 340.0 * ((xorshift32(rng) as f32) / u32::MAX as f32);
            }
        }
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.unit_samples_left == 0 {
            if self.samples_to_next == 0 {
                self.trigger_unit(sample_rate, bio_rate, rng);
            } else {
                self.samples_to_next -= 1;
                return 0.0;
            }
        }

        self.unit_samples_left = self.unit_samples_left.saturating_sub(1);
        if self.unit_samples_left == 0 {
            self.schedule_gap(sample_rate, bio_rate, rng);
        }

        self.current_hz += 0.0025 * (self.target_hz - self.current_hz);
        self.mod_phase += TWO_PI * (0.2 + 0.9 * bio_rate) / sample_rate;
        if self.mod_phase >= TWO_PI {
            self.mod_phase -= TWO_PI;
        }
        let mod_scale = 1.0 + 0.10 * self.mod_phase.sin();
        self.phase += TWO_PI * self.current_hz * mod_scale / sample_rate;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        self.unit_progress = (self.unit_progress + 1.0 / (sample_rate * 0.7)).min(1.0);
        let attack = (self.unit_progress / 0.12).min(1.0);
        let release = 1.0 - self.unit_progress.powf(1.8);
        self.env = attack * release.max(0.0);

        let p = self.phase;
        match self.unit_kind {
            0 => (p.sin() * 0.75 + (0.5 * p).sin() * 0.35 + (1.4 * p).sin() * 0.12) * self.env * 0.40,
            1 => (p.sin() * 0.9 + (2.03 * p).sin() * 0.08) * self.env * 0.34,
            _ => {
                let rise = self.unit_progress * self.unit_progress;
                let sweep = self.current_hz * (0.8 + 0.6 * rise);
                self.phase += TWO_PI * (sweep - self.current_hz) / sample_rate;
                (self.phase.sin() * 0.8 + (1.5 * self.phase).sin() * 0.15) * self.env * 0.36
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BioType {
    Chirp = 0,
    SnappingShrimp = 1,
    WhaleMoan = 2,
    DolphinWhistle = 3,
    EcholocationClick = 4,
    HumpbackSong = 5,
}

impl BioType {
    #[inline]
    fn from_param(value: f32) -> Self {
        match clamp(value.round(), 0.0, 5.0) as u32 {
            1 => Self::SnappingShrimp,
            2 => Self::WhaleMoan,
            3 => Self::DolphinWhistle,
            4 => Self::EcholocationClick,
            5 => Self::HumpbackSong,
            _ => Self::Chirp,
        }
    }
}

#[derive(Clone, Copy)]
struct BioState {
    bio_type: BioType,
    prev_type: BioType,
    bio_rate: f32,
    xfade: f32,
    chirp: ChirpState,
    snapping_shrimp: SnappingShrimpState,
    whale_moan: WhaleMoanState,
    dolphin_whistle: DolphinWhistleState,
    echolocation_click: EcholocationClickState,
    humpback_song: HumpbackSongState,
}

impl BioState {
    fn new() -> Self {
        Self {
            bio_type: BioType::Chirp,
            prev_type: BioType::Chirp,
            bio_rate: 0.35,
            xfade: 1.0,
            chirp: ChirpState::new(),
            snapping_shrimp: SnappingShrimpState::new(),
            whale_moan: WhaleMoanState::new(),
            dolphin_whistle: DolphinWhistleState::new(),
            echolocation_click: EcholocationClickState::new(),
            humpback_song: HumpbackSongState::new(),
        }
    }

    #[inline]
    fn set_type(&mut self, next: BioType) {
        if next == self.bio_type {
            return;
        }
        self.prev_type = self.bio_type;
        self.bio_type = next;
        self.xfade = 0.0;
    }

    #[inline]
    fn set_rate(&mut self, value: f32) {
        self.bio_rate = clamp(value, 0.0, 1.0);
    }

    #[inline]
    fn tick_mode(&mut self, mode: BioType, sample_rate: f32, rpm: f32, rng: &mut u32) -> f32 {
        match mode {
            BioType::Chirp => self.chirp.tick(sample_rate, rpm, self.bio_rate, rng),
            BioType::SnappingShrimp => self.snapping_shrimp.tick(sample_rate, self.bio_rate, rng),
            BioType::WhaleMoan => self.whale_moan.tick(sample_rate, self.bio_rate, rng),
            BioType::DolphinWhistle => self.dolphin_whistle.tick(sample_rate, self.bio_rate, rng),
            BioType::EcholocationClick => self.echolocation_click.tick(sample_rate, self.bio_rate, rng),
            BioType::HumpbackSong => self.humpback_song.tick(sample_rate, self.bio_rate, rng),
        }
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, rpm: f32, rng: &mut u32) -> f32 {
        if self.xfade < 1.0 {
            let a = self.tick_mode(self.prev_type, sample_rate, rpm, rng);
            let b = self.tick_mode(self.bio_type, sample_rate, rpm, rng);
            let out = a * (1.0 - self.xfade) + b * self.xfade;
            let step = 1.0 / (sample_rate * 0.015);
            self.xfade = (self.xfade + step).min(1.0);
            out
        } else {
            self.tick_mode(self.bio_type, sample_rate, rpm, rng)
        }
    }
}

#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    gain: f32,
    engine_mix: f32,
    cav_mix: f32,
    bio_mix: f32,
    rng: u32,
    engine: EngineState,
    cav: CavState,
    bio: BioState,
}

impl Voice {
    fn new(seed: u32) -> Self {
        Self {
            active: true,
            gain: 1.0,
            engine_mix: 1.0,
            cav_mix: 0.55,
            bio_mix: 0.25,
            rng: seed,
            engine: EngineState::new(),
            cav: CavState::new(),
            bio: BioState::new(),
        }
    }

    #[inline]
    fn sample(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        let e = self.engine.tick(sample_rate);
        let c = self
            .cav
            .tick(self.engine.current_rpm, self.engine.phase, &mut self.rng);
        let b = self
            .bio
            .tick(sample_rate, self.engine.current_rpm, &mut self.rng);

        (e * self.engine_mix + c * self.cav_mix + b * self.bio_mix) * self.gain
    }
}

#[wasm_bindgen]
pub struct DspGraph {
    sample_rate: f32,
    max_frames: usize,
    last_frames: usize,
    voices: Vec<Voice>,
    output: Vec<f32>,
    next_seed: u32,
}

#[wasm_bindgen]
impl DspGraph {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, max_frames: usize, max_voices: usize) -> Self {
        let capped_voices = max_voices.max(1);
        let mut voices = Vec::with_capacity(capped_voices);
        for _ in 0..capped_voices {
            voices.push(Voice::new(0));
            let idx = voices.len() - 1;
            voices[idx].active = false;
        }

        Self {
            sample_rate,
            max_frames: max_frames.max(1),
            last_frames: 0,
            voices,
            output: vec![0.0; max_frames.max(1)],
            next_seed: 0x1234_abcd,
        }
    }

    pub fn add_voice(&mut self) -> i32 {
        for i in 0..self.voices.len() {
            if !self.voices[i].active {
                self.next_seed = self.next_seed.wrapping_add(0x9e37_79b9);
                self.voices[i] = Voice::new(self.next_seed);
                return i as i32;
            }
        }
        -1
    }

    pub fn remove_voice(&mut self, voice_id: u32) -> bool {
        let idx = voice_id as usize;
        if idx >= self.voices.len() {
            return false;
        }
        self.voices[idx].active = false;
        true
    }

    pub fn set_param(&mut self, voice_id: u32, param_id: u32, value: f32) -> bool {
        let idx = voice_id as usize;
        if idx >= self.voices.len() || !self.voices[idx].active {
            return false;
        }

        let v = &mut self.voices[idx];
        match param_id {
            PARAM_RPM => v.engine.target_rpm = value.max(0.0),
            PARAM_BLADES => v.engine.blades = clamp(value, 1.0, 12.0),
            PARAM_GAIN => v.gain = clamp(value, 0.0, 2.0),
            PARAM_ENGINE_MIX => v.engine_mix = clamp(value, 0.0, 1.5),
            PARAM_CAV_MIX => v.cav_mix = clamp(value, 0.0, 1.5),
            PARAM_BIO_MIX => v.bio_mix = clamp(value, 0.0, 1.5),
            PARAM_BIO_TYPE => v.bio.set_type(BioType::from_param(value)),
            PARAM_BIO_RATE => v.bio.set_rate(value),
            _ => return false,
        }

        true
    }

    // Returns a pointer into WASM memory to the graph output buffer.
    // Read `output_len()` samples from this address.
    pub fn process(&mut self, frames: usize) -> usize {
        let n = frames.min(self.max_frames);
        self.last_frames = n;

        for i in 0..n {
            let mut mix = 0.0f32;
            for voice in &mut self.voices {
                mix += voice.sample(self.sample_rate);
            }
            self.output[i] = mix.tanh();
        }

        self.output.as_ptr() as usize
    }

    pub fn output_len(&self) -> usize {
        self.last_frames
    }

    pub fn output_ptr(&self) -> usize {
        self.output.as_ptr() as usize
    }

    pub fn max_frames(&self) -> usize {
        self.max_frames
    }
}

#[wasm_bindgen]
pub fn param_rpm() -> u32 {
    PARAM_RPM
}

#[wasm_bindgen]
pub fn param_blades() -> u32 {
    PARAM_BLADES
}

#[wasm_bindgen]
pub fn param_gain() -> u32 {
    PARAM_GAIN
}

#[wasm_bindgen]
pub fn param_engine_mix() -> u32 {
    PARAM_ENGINE_MIX
}

#[wasm_bindgen]
pub fn param_cav_mix() -> u32 {
    PARAM_CAV_MIX
}

#[wasm_bindgen]
pub fn param_bio_mix() -> u32 {
    PARAM_BIO_MIX
}

#[wasm_bindgen]
pub fn param_bio_type() -> u32 {
    PARAM_BIO_TYPE
}

#[wasm_bindgen]
pub fn param_bio_rate() -> u32 {
    PARAM_BIO_RATE
}
