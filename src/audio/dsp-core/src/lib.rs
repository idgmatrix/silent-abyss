use std::f32::consts::PI;
use wasm_bindgen::prelude::*;

const TWO_PI: f32 = 2.0 * PI;

pub const PARAM_RPM: u32 = 0;
pub const PARAM_BLADES: u32 = 1;
pub const PARAM_GAIN: u32 = 2;
pub const PARAM_ENGINE_MIX: u32 = 3;
pub const PARAM_CAV_MIX: u32 = 4;
pub const PARAM_BIO_MIX: u32 = 5;

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
struct BioState {
    // Samples until next click trigger.
    samples_to_next: u32,
    // Envelope for current click.
    env: f32,
    // Current click oscillator phase.
    phase: f32,
    // Chirp start frequency.
    start_hz: f32,
    // Chirp end frequency.
    end_hz: f32,
    // Progress through chirp envelope [0..1].
    progress: f32,
}

impl BioState {
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
    fn schedule_next(&mut self, sample_rate: f32, rpm: f32, rng: &mut u32) {
        let speed = clamp(rpm / 280.0, 0.0, 1.0);
        let base_ms = 110.0 - 70.0 * speed;
        let jitter = 0.55 + 0.9 * ((xorshift32(rng) as f32) / u32::MAX as f32);
        let ms = (base_ms * jitter).max(12.0);
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
    fn tick(&mut self, sample_rate: f32, rpm: f32, rng: &mut u32) -> f32 {
        if self.samples_to_next == 0 {
            self.trigger_click(rpm, rng);
            self.schedule_next(sample_rate, rpm, rng);
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
