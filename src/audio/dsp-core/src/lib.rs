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
pub const PARAM_SHAFT_RATE: u32 = 8;
pub const PARAM_LOAD: u32 = 9;
pub const PARAM_RPM_JITTER: u32 = 10;
pub const PARAM_CLASS_PROFILE: u32 = 11;
pub const PARAM_CAVITATION_LEVEL: u32 = 12;

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

#[wasm_bindgen]
pub fn compute_demon_spectrum(
    input: &[f32],
    sample_rate: f32,
    max_freq_hz: u32,
    input_band_low_hz: f32,
    input_band_high_hz: f32,
    envelope_hp_hz: f32,
    decimated_rate_target_hz: f32,
) -> Vec<f32> {
    let max_freq = max_freq_hz as usize;
    let mut spectrum = vec![0.0f32; max_freq + 1];

    if input.len() < 64 || !sample_rate.is_finite() || sample_rate <= 0.0 {
        return spectrum;
    }

    let band_low = if input_band_low_hz.is_finite() {
        input_band_low_hz.max(1.0)
    } else {
        20.0
    };
    let band_high = if input_band_high_hz.is_finite() {
        input_band_high_hz.max(band_low + 1.0)
    } else {
        1800.0
    };
    let env_hp = if envelope_hp_hz.is_finite() {
        envelope_hp_hz.max(0.1)
    } else {
        1.0
    };
    let decim_target = if decimated_rate_target_hz.is_finite() {
        decimated_rate_target_hz.max(100.0)
    } else {
        500.0
    };

    let n_raw = input.len();
    let mean_raw = input.iter().copied().sum::<f32>() / n_raw as f32;

    let hp_rc = 1.0 / (2.0 * PI * band_low);
    let lp_rc = 1.0 / (2.0 * PI * band_high);
    let dt = 1.0 / sample_rate;
    let hp_alpha = hp_rc / (hp_rc + dt);
    let lp_alpha = dt / (lp_rc + dt);

    let d = ((sample_rate / decim_target).floor() as usize).max(1);
    let decim_sr = sample_rate / d as f32;
    let n_decim = n_raw / d;
    if n_decim < 8 {
        return spectrum;
    }

    let mut decim_env = vec![0.0f32; n_decim];
    let mut hp_y = 0.0f32;
    let mut hp_prev_x = 0.0f32;
    let mut lp_y = 0.0f32;
    let mut accum = 0.0f32;
    for i in 0..n_raw {
        let x = input[i] - mean_raw;
        hp_y = hp_alpha * (hp_y + x - hp_prev_x);
        hp_prev_x = x;
        lp_y += lp_alpha * (hp_y - lp_y);
        accum += lp_y.abs();
        if (i + 1) % d == 0 {
            let idx = (i + 1) / d - 1;
            decim_env[idx] = accum / d as f32;
            accum = 0.0;
        }
    }

    let env_hp_rc = 1.0 / (2.0 * PI * env_hp);
    let decim_dt = 1.0 / decim_sr;
    let env_hp_alpha = env_hp_rc / (env_hp_rc + decim_dt);
    let mut env_hp_y = 0.0f32;
    let mut env_hp_prev_x = decim_env[0];
    let mut signal = vec![0.0f32; n_decim];
    for i in 0..n_decim {
        let x = decim_env[i];
        env_hp_y = env_hp_alpha * (env_hp_y + x - env_hp_prev_x);
        env_hp_prev_x = x;
        signal[i] = env_hp_y;
    }

    let hann_denom = (n_decim.saturating_sub(1)).max(1) as f32;
    for f in 1..=max_freq {
        let omega = (2.0 * PI * f as f32) / decim_sr;
        let mut re = 0.0f32;
        let mut im = 0.0f32;
        for i in 0..n_decim {
            let hann = 0.5 * (1.0 - ((2.0 * PI * i as f32) / hann_denom).cos());
            let v = signal[i] * hann;
            let angle = omega * i as f32;
            re += v * angle.cos();
            im -= v * angle.sin();
        }
        spectrum[f] = (re.hypot(im)) / n_decim as f32;
    }

    spectrum
}

#[derive(Clone, Copy)]
struct EngineState {
    shaft_phase: f32,
    blade_phase: f32,
    machinery_phase_a: f32,
    machinery_phase_b: f32,
    drift_phase: f32,
    drift_value: f32,
    current_rpm: f32,
    target_rpm: f32,
    current_shaft_rate: f32,
    target_shaft_rate: f32,
    blades: f32,
    load: f32,
    rpm_jitter: f32,
    class_profile: u32,
}

impl EngineState {
    fn new() -> Self {
        Self {
            shaft_phase: 0.0,
            blade_phase: 0.0,
            machinery_phase_a: 0.0,
            machinery_phase_b: 0.0,
            drift_phase: 0.0,
            drift_value: 0.0,
            current_rpm: 0.0,
            target_rpm: 0.0,
            current_shaft_rate: 0.0,
            target_shaft_rate: 0.0,
            blades: 5.0,
            load: 0.45,
            rpm_jitter: 0.12,
            class_profile: 0,
        }
    }

    #[inline]
    fn class_weights(&self) -> (f32, f32, f32, f32) {
        match self.class_profile {
            1 => (0.42, 0.90, 0.18, 0.75), // submarine
            2 => (0.70, 0.78, 0.58, 1.00), // merchant
            3 => (0.55, 1.05, 0.36, 1.18), // fishing vessel
            4 => (0.35, 1.18, 0.24, 1.25), // torpedo / fast propulsor
            _ => (0.55, 0.88, 0.34, 0.92), // generic surface contact
        }
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32, rng: &mut u32) -> f32 {
        self.current_rpm = self.current_rpm * 0.992 + self.target_rpm * 0.008;
        let target_shaft_rate = if self.target_shaft_rate > 0.01 {
            self.target_shaft_rate
        } else {
            self.target_rpm / 60.0
        };
        self.current_shaft_rate = self.current_shaft_rate * 0.992 + target_shaft_rate * 0.008;
        if self.current_rpm < 0.05 {
            return 0.0;
        }

        let load = clamp(self.load, 0.0, 1.0);
        let jitter = clamp(self.rpm_jitter, 0.0, 1.0);
        let (shaft_weight, blade_weight, machinery_weight, brightness) = self.class_weights();

        let drift_target = rand_signed(rng) * (0.25 + jitter * 0.75);
        self.drift_value += 0.0009 * (drift_target - self.drift_value);
        self.drift_phase += TWO_PI * (0.11 + 0.22 * jitter) / sample_rate;
        if self.drift_phase >= TWO_PI {
            self.drift_phase -= TWO_PI;
        }

        let wander = 1.0
            + (0.004 + 0.02 * jitter) * self.drift_phase.sin()
            + self.drift_value * (0.002 + 0.012 * jitter);
        let shaft_hz = (self.current_shaft_rate.max(0.05) * wander).max(0.05);
        let bpf_hz = (shaft_hz * self.blades.max(1.0)).max(0.1);

        self.shaft_phase += TWO_PI * shaft_hz / sample_rate;
        if self.shaft_phase >= TWO_PI {
            self.shaft_phase -= TWO_PI;
        }
        self.blade_phase += TWO_PI * bpf_hz / sample_rate;
        if self.blade_phase >= TWO_PI {
            self.blade_phase -= TWO_PI;
        }

        let machinery_hz_a = 24.0 + shaft_hz * (11.0 + 5.0 * brightness) + 28.0 * load;
        let machinery_hz_b = 70.0 + bpf_hz * 0.5 + 55.0 * brightness + 36.0 * load;
        self.machinery_phase_a += TWO_PI * machinery_hz_a / sample_rate;
        self.machinery_phase_b += TWO_PI * machinery_hz_b / sample_rate;
        if self.machinery_phase_a >= TWO_PI {
            self.machinery_phase_a -= TWO_PI;
        }
        if self.machinery_phase_b >= TWO_PI {
            self.machinery_phase_b -= TWO_PI;
        }

        let shaft = self.shaft_phase.sin() * 0.65
            + (2.0 * self.shaft_phase).sin() * 0.24
            + (3.0 * self.shaft_phase).sin() * 0.11;
        let blade = self.blade_phase.sin() * 0.70
            + (2.0 * self.blade_phase).sin() * 0.18
            + (3.0 * self.blade_phase).sin() * 0.08
            + (4.0 * self.blade_phase).sin() * 0.05;
        let machinery = self.machinery_phase_a.sin() * 0.75
            + (1.11 * self.machinery_phase_b).sin() * 0.23
            + (self.machinery_phase_a + self.blade_phase * 0.16).sin() * 0.14;

        let envelope = 0.80
            + 0.14 * self.blade_phase.sin().abs()
            + 0.05 * self.drift_phase.sin();
        let harmonic_signal = shaft * shaft_weight
            + blade * blade_weight * (0.72 + 0.38 * load)
            + machinery * machinery_weight * (0.55 + 0.55 * load);
        let amplitude = (0.035 + (self.current_rpm / 420.0).min(0.22)) * (0.88 + 0.24 * load);

        (harmonic_signal * envelope * 1.25).tanh() * amplitude
    }
}

#[derive(Clone, Copy)]
struct CavState {
    lp_noise: f32,
    slow_noise: f32,
    shaped_noise: f32,
    burst_env: f32,
    burst_drive: f32,
}

impl CavState {
    fn new() -> Self {
        Self {
            lp_noise: 0.0,
            slow_noise: 0.0,
            shaped_noise: 0.0,
            burst_env: 0.0,
            burst_drive: 0.0,
        }
    }

    #[inline]
    fn tick(
        &mut self,
        rpm: f32,
        shaft_phase: f32,
        blade_phase: f32,
        blade_count: f32,
        load: f32,
        cavitation_level: f32,
        class_profile: u32,
        rng: &mut u32,
    ) -> f32 {
        if rpm < 1.0 {
            self.lp_noise = 0.0;
            self.slow_noise = 0.0;
            self.shaped_noise = 0.0;
            self.burst_env = 0.0;
            self.burst_drive = 0.0;
            return 0.0;
        }

        let white = rand_signed(rng);
        let speed_norm = clamp((rpm - 60.0) / 320.0, 0.0, 1.0);
        let load = clamp(load, 0.0, 1.0);
        let cavitation_level = clamp(cavitation_level, 0.0, 1.0);
        let class_bias = match class_profile {
            1 => 0.72, // submarine
            2 => 1.02, // merchant
            3 => 1.18, // fishing vessel
            4 => 1.28, // torpedo
            _ => 1.0,
        };
        let regime_drive = clamp(
            (speed_norm * 0.58 + load * 0.24 + cavitation_level * 0.75) * class_bias,
            0.0,
            1.0,
        );

        // Use two smoothed noise bands to build a regime-dependent cavitation texture.
        self.slow_noise += 0.025 * (white - self.slow_noise);
        self.lp_noise += (0.08 + 0.06 * regime_drive) * (white - self.lp_noise);
        let hp = white - self.lp_noise;
        let fizz = hp - self.slow_noise * (0.25 + 0.2 * regime_drive);
        self.shaped_noise += (0.22 + 0.18 * regime_drive) * (fizz - self.shaped_noise);

        let blade_mod = 0.5 + 0.5 * blade_phase.sin();
        let blade_pulse = blade_phase.sin().abs();
        let discrete_blades = clamp(blade_count.round(), 1.0, 12.0) as usize;
        let pulse_power = 5.0 + regime_drive * 7.0;
        let mut blade_packet = 0.0;
        for blade_idx in 0..discrete_blades {
            let blade_offset = TWO_PI * blade_idx as f32 / discrete_blades as f32;
            let phase = shaft_phase + blade_offset;
            let passage = (0.5 + 0.5 * phase.cos()).powf(pulse_power);
            let blade_weight =
                0.88 + 0.12 * ((blade_idx as f32 * 1.73 + load * 2.4).sin() * 0.5 + 0.5);
            blade_packet += passage * blade_weight;
        }
        blade_packet /= discrete_blades.max(1) as f32;
        let modulation_depth = 0.18 + regime_drive * 0.72;
        let blade_envelope = (1.0 - modulation_depth)
            + modulation_depth * (0.18 + blade_mod * 0.34 + blade_packet * 1.48);
        self.burst_drive += 0.03 * ((blade_pulse * regime_drive) - self.burst_drive);
        let burst_threshold = 0.76 - regime_drive * 0.26;
        if self.burst_drive > burst_threshold {
            self.burst_env = (self.burst_env + 0.42 * regime_drive).min(1.0);
            self.burst_drive *= 0.65;
        }
        self.burst_env *= 0.90 - regime_drive * 0.08;

        let regime_none = (1.0 - regime_drive * 2.5).clamp(0.0, 1.0);
        let regime_incipient = (1.0 - ((regime_drive - 0.28) / 0.22).abs()).clamp(0.0, 1.0);
        let regime_developed = (1.0 - ((regime_drive - 0.58) / 0.24).abs()).clamp(0.0, 1.0);
        let regime_heavy = ((regime_drive - 0.68) / 0.32).clamp(0.0, 1.0);

        let low_texture = self.slow_noise * 0.10 + self.shaped_noise * 0.26;
        let incipient_texture = self.shaped_noise * (0.18 + 0.18 * blade_mod) * blade_envelope;
        let developed_texture =
            (self.shaped_noise * (0.26 + 0.42 * blade_mod) + hp * 0.08) * blade_envelope;
        let heavy_texture = (self.shaped_noise * (0.32 + 0.56 * blade_mod)
            + hp * (0.12 + 0.1 * blade_mod))
            * blade_envelope
            + self.burst_env * rand_signed(rng) * 0.55;

        let intensity = 0.008
            + regime_none * 0.012
            + regime_incipient * 0.05
            + regime_developed * 0.16
            + regime_heavy * 0.40;
        let texture = low_texture * regime_none
            + incipient_texture * regime_incipient
            + developed_texture * regime_developed
            + heavy_texture * regime_heavy;

        texture * intensity * (0.55 + 0.45 * load + 0.18 * speed_norm)
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
    BlueWhale = 6,
    FinWhale = 7,
    SpermWhaleClick = 8,
    OrcaCall = 9,
    BelugaCall = 10,
    FishChorus = 11,
    HerringSchool = 12,
    HelicopterRotor = 13,
    FixedWingAircraft = 14,
    JetAircraft = 15,
    AmbientOcean = 16,
    Precipitation = 17,
    IceNoise = 18,
    GeologicalNoise = 19,
    MinkePulse = 20,
    DolphinSchool = 21,
}

impl BioType {
    #[inline]
    fn from_param(value: f32) -> Self {
        match clamp(value.round(), 0.0, 21.0) as u32 {
            1 => Self::SnappingShrimp,
            2 => Self::WhaleMoan,
            3 => Self::DolphinWhistle,
            4 => Self::EcholocationClick,
            5 => Self::HumpbackSong,
            6 => Self::BlueWhale,
            7 => Self::FinWhale,
            8 => Self::SpermWhaleClick,
            9 => Self::OrcaCall,
            10 => Self::BelugaCall,
            11 => Self::FishChorus,
            12 => Self::HerringSchool,
            13 => Self::HelicopterRotor,
            14 => Self::FixedWingAircraft,
            15 => Self::JetAircraft,
            16 => Self::AmbientOcean,
            17 => Self::Precipitation,
            18 => Self::IceNoise,
            19 => Self::GeologicalNoise,
            20 => Self::MinkePulse,
            21 => Self::DolphinSchool,
            _ => Self::Chirp,
        }
    }
}

#[derive(Clone, Copy)]
struct LowCallState {
    samples_to_next: u32,
    unit_left: u32,
    env: f32,
    phase: f32,
    lfo_phase: f32,
    current_hz: f32,
    target_hz: f32,
}

impl LowCallState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            unit_left: 0,
            env: 0.0,
            phase: 0.0,
            lfo_phase: 0.0,
            current_hz: 40.0,
            target_hz: 40.0,
        }
    }

    #[inline]
    fn schedule_next(&mut self, sample_rate: f32, bio_rate: f32, min_ms: f32, max_ms: f32, rng: &mut u32) {
        let jitter = 0.65 + 0.7 * ((xorshift32(rng) as f32) / u32::MAX as f32);
        let span = (max_ms - min_ms).max(1.0);
        let ms = (max_ms - span * bio_rate) * jitter;
        self.samples_to_next = (sample_rate * ms.max(5.0) * 0.001) as u32;
    }

    #[inline]
    fn trigger(&mut self, sample_rate: f32, hz: f32, dur_ms: f32) {
        self.unit_left = (sample_rate * dur_ms.max(10.0) * 0.001) as u32;
        self.current_hz = hz;
        self.target_hz = hz;
        self.env = 1.0;
    }

    #[inline]
    fn tick(&mut self, mode: BioType, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.unit_left == 0 {
            if self.samples_to_next == 0 {
                match mode {
                    BioType::BlueWhale => {
                        let base = 14.0 + 6.0 * ((xorshift32(rng) as f32) / u32::MAX as f32);
                        self.trigger(sample_rate, base, 2600.0 + bio_rate * 1800.0);
                        self.target_hz = base + 2.2 + bio_rate * 1.4;
                        self.schedule_next(sample_rate, bio_rate, 2800.0, 8000.0, rng);
                    }
                    BioType::FinWhale => {
                        self.trigger(sample_rate, 18.0 + 4.0 * bio_rate, 650.0);
                        self.target_hz = 20.0 + 2.0 * bio_rate;
                        self.schedule_next(sample_rate, bio_rate, 900.0, 2500.0, rng);
                    }
                    BioType::MinkePulse => {
                        self.trigger(sample_rate, 85.0 + 70.0 * bio_rate, 180.0);
                        self.target_hz = self.current_hz * (1.1 + 0.2 * bio_rate);
                        self.schedule_next(sample_rate, bio_rate, 120.0, 520.0, rng);
                    }
                    _ => {
                        self.trigger(sample_rate, 160.0 + 260.0 * bio_rate, 420.0 + 420.0 * bio_rate);
                        self.target_hz = self.current_hz * (0.9 + 0.15 * bio_rate);
                        self.schedule_next(sample_rate, bio_rate, 350.0, 1200.0, rng);
                    }
                }
            } else {
                self.samples_to_next -= 1;
                return 0.0;
            }
        }

        self.unit_left = self.unit_left.saturating_sub(1);
        self.current_hz += 0.0015 * (self.target_hz - self.current_hz);
        self.lfo_phase += TWO_PI * (0.04 + bio_rate * 0.25) / sample_rate;
        if self.lfo_phase >= TWO_PI {
            self.lfo_phase -= TWO_PI;
        }
        let wobble = match mode {
            BioType::BlueWhale => 0.9,
            BioType::FinWhale => 0.25,
            BioType::MinkePulse => 2.8,
            _ => 6.0,
        };
        self.phase += TWO_PI * (self.current_hz + wobble * self.lfo_phase.sin()) / sample_rate;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        self.env *= match mode {
            BioType::BlueWhale => 0.99985,
            BioType::FinWhale => 0.9992,
            BioType::MinkePulse => 0.997,
            _ => 0.9984,
        };

        let tone = match mode {
            BioType::BlueWhale => self.phase.sin() * 0.9 + (0.5 * self.phase).sin() * 0.22,
            BioType::FinWhale => self.phase.sin() * 0.95,
            BioType::MinkePulse => self.phase.sin() * 0.65 + rand_signed(rng) * 0.08,
            _ => self.phase.sin() * 0.75 + (1.4 * self.phase).sin() * 0.2,
        };
        tone * self.env * 0.42
    }
}

#[derive(Clone, Copy)]
struct ClickTrainState {
    samples_to_next: u32,
    burst_left: u32,
    click_phase: f32,
    env: f32,
    click_hz: f32,
}

impl ClickTrainState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            burst_left: 0,
            click_phase: 0.0,
            env: 0.0,
            click_hz: 6000.0,
        }
    }

    #[inline]
    fn tick(&mut self, mode: BioType, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.samples_to_next == 0 {
            let r = (xorshift32(rng) as f32) / u32::MAX as f32;
            self.click_hz = match mode {
                BioType::SpermWhaleClick => 1800.0 + 1800.0 * r,
                _ => 6000.0 + 8000.0 * r,
            };
            self.burst_left = match mode {
                BioType::SpermWhaleClick => (sample_rate * 0.00065) as u32 + 1,
                _ => (sample_rate * 0.00025) as u32 + 1,
            };
            self.env = 1.0;
            let base_ms = match mode {
                BioType::SpermWhaleClick => 120.0 - 105.0 * bio_rate,
                _ => 35.0 - 28.0 * bio_rate,
            };
            let jitter = 0.65 + 0.8 * r;
            self.samples_to_next = (sample_rate * (base_ms * jitter).max(1.0) * 0.001) as u32;
        } else {
            self.samples_to_next -= 1;
        }

        if self.burst_left == 0 {
            return 0.0;
        }

        self.burst_left -= 1;
        self.click_phase += TWO_PI * self.click_hz / sample_rate;
        if self.click_phase >= TWO_PI {
            self.click_phase -= TWO_PI;
        }
        self.env *= match mode {
            BioType::SpermWhaleClick => 0.62,
            _ => 0.48,
        };
        (self.click_phase.sin() + rand_signed(rng) * 0.15) * self.env * 0.78
    }
}

#[derive(Clone, Copy)]
struct SocialCallState {
    samples_to_next: u32,
    unit_left: u32,
    env: f32,
    phase_a: f32,
    phase_b: f32,
    start_hz: f32,
    end_hz: f32,
    progress: f32,
}

impl SocialCallState {
    fn new() -> Self {
        Self {
            samples_to_next: 0,
            unit_left: 0,
            env: 0.0,
            phase_a: 0.0,
            phase_b: 0.0,
            start_hz: 1200.0,
            end_hz: 1600.0,
            progress: 1.0,
        }
    }

    #[inline]
    fn tick(&mut self, mode: BioType, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        if self.unit_left == 0 {
            if self.samples_to_next == 0 {
                let r0 = (xorshift32(rng) as f32) / u32::MAX as f32;
                let r1 = (xorshift32(rng) as f32) / u32::MAX as f32;
                self.start_hz = match mode {
                    BioType::OrcaCall => 650.0 + 1800.0 * r0,
                    BioType::BelugaCall => 1800.0 + 6200.0 * r0,
                    BioType::DolphinSchool => 2500.0 + 4500.0 * r0,
                    BioType::HerringSchool => 80.0 + 120.0 * r0,
                    _ => 1100.0 + 1800.0 * r0,
                };
                let span = match mode {
                    BioType::OrcaCall => 900.0 + 1300.0 * bio_rate,
                    BioType::BelugaCall => 2000.0 + 3000.0 * bio_rate,
                    BioType::DolphinSchool => 2600.0 + 3600.0 * bio_rate,
                    BioType::HerringSchool => 20.0 + 35.0 * bio_rate,
                    _ => 1200.0,
                };
                self.end_hz = if r1 > 0.5 {
                    self.start_hz + span
                } else {
                    self.start_hz - span * 0.6
                };
                let unit_ms = match mode {
                    BioType::OrcaCall => 260.0 + 420.0 * r0,
                    BioType::BelugaCall => 120.0 + 260.0 * r0,
                    BioType::DolphinSchool => 90.0 + 200.0 * r0,
                    BioType::HerringSchool => 320.0 + 240.0 * r0,
                    _ => 240.0,
                };
                self.unit_left = (sample_rate * unit_ms * 0.001) as u32;
                self.samples_to_next =
                    (sample_rate * (120.0 + 260.0 * (1.0 - bio_rate)).max(10.0) * 0.001) as u32;
                self.progress = 0.0;
                self.env = 1.0;
            } else {
                self.samples_to_next -= 1;
                return 0.0;
            }
        }

        self.unit_left = self.unit_left.saturating_sub(1);
        self.progress = (self.progress + 0.0035 + bio_rate * 0.002).min(1.0);
        let curved = self.progress * self.progress * (3.0 - 2.0 * self.progress);
        let hz = self.start_hz + (self.end_hz - self.start_hz) * curved;
        self.phase_a += TWO_PI * hz / sample_rate;
        self.phase_b += TWO_PI * (hz * 1.37) / sample_rate;
        if self.phase_a >= TWO_PI {
            self.phase_a -= TWO_PI;
        }
        if self.phase_b >= TWO_PI {
            self.phase_b -= TWO_PI;
        }
        self.env *= 0.997 - 0.001 * bio_rate;

        match mode {
            BioType::OrcaCall => {
                (self.phase_a.sin() * 0.74 + (self.phase_b * 0.5).sin() * 0.24 + rand_signed(rng) * 0.06)
                    * self.env
                    * 0.36
            }
            BioType::BelugaCall => {
                (self.phase_a.sin() * 0.55 + self.phase_b.sin() * 0.32 + rand_signed(rng) * 0.08)
                    * self.env
                    * 0.34
            }
            BioType::DolphinSchool => {
                (self.phase_a.sin() * 0.42 + rand_signed(rng) * 0.12) * self.env * 0.28
            }
            BioType::HerringSchool => {
                (self.phase_a.sin() * 0.26 + self.phase_b.sin() * 0.18 + rand_signed(rng) * 0.14)
                    * self.env
                    * 0.30
            }
            _ => 0.0,
        }
    }
}

#[derive(Clone, Copy)]
struct RotorState {
    phase_a: f32,
    phase_b: f32,
    phase_c: f32,
    noise_lp: f32,
    burst_env: f32,
}

impl RotorState {
    fn new() -> Self {
        Self {
            phase_a: 0.0,
            phase_b: 0.0,
            phase_c: 0.0,
            noise_lp: 0.0,
            burst_env: 0.0,
        }
    }

    #[inline]
    fn tick(&mut self, mode: BioType, sample_rate: f32, bio_rate: f32, rpm: f32, rng: &mut u32) -> f32 {
        let rate_base = if rpm > 1.0 { rpm / 60.0 } else { 4.0 + bio_rate * 8.0 };
        let main_rate = match mode {
            BioType::HelicopterRotor => rate_base * (0.8 + 0.3 * bio_rate),
            BioType::FixedWingAircraft => rate_base * (1.2 + 0.4 * bio_rate),
            BioType::JetAircraft => rate_base * (1.6 + 0.5 * bio_rate),
            _ => rate_base,
        };
        let tail_rate = main_rate * match mode {
            BioType::HelicopterRotor => 4.6,
            BioType::FixedWingAircraft => 2.7,
            BioType::JetAircraft => 5.3,
            _ => 1.0,
        };
        let broadband = rand_signed(rng);
        self.noise_lp += 0.06 * (broadband - self.noise_lp);
        let hp = broadband - self.noise_lp;

        self.phase_a += TWO_PI * main_rate / sample_rate;
        self.phase_b += TWO_PI * tail_rate / sample_rate;
        self.phase_c += TWO_PI * (main_rate * 0.5 + 16.0 * bio_rate) / sample_rate;
        if self.phase_a >= TWO_PI {
            self.phase_a -= TWO_PI;
        }
        if self.phase_b >= TWO_PI {
            self.phase_b -= TWO_PI;
        }
        if self.phase_c >= TWO_PI {
            self.phase_c -= TWO_PI;
        }

        let blade = self.phase_a.sin() * 0.82 + (2.0 * self.phase_a).sin() * 0.22;
        let tail = self.phase_b.sin() * 0.22;
        let turbine = self.phase_c.sin() * 0.16;
        let slap_drive = self.phase_a.sin().abs();
        if mode == BioType::HelicopterRotor && bio_rate < 0.4 && slap_drive > 0.94 {
            self.burst_env = 1.0;
        }
        self.burst_env *= 0.96;

        match mode {
            BioType::JetAircraft => (hp * (0.22 + 0.45 * bio_rate) + turbine + blade * 0.18) * 0.55,
            BioType::FixedWingAircraft => (blade * 0.62 + tail * 0.18 + hp * 0.12 + turbine) * 0.46,
            _ => (blade * 0.76 + tail * 0.24 + turbine * 0.18 + hp * 0.08 + self.burst_env * hp * 0.55) * 0.48,
        }
    }
}

#[derive(Clone, Copy)]
struct NoiseFieldState {
    lp_a: f32,
    lp_b: f32,
    drift: f32,
    burst_env: f32,
}

impl NoiseFieldState {
    fn new() -> Self {
        Self {
            lp_a: 0.0,
            lp_b: 0.0,
            drift: 0.0,
            burst_env: 0.0,
        }
    }

    #[inline]
    fn tick(&mut self, mode: BioType, sample_rate: f32, bio_rate: f32, rng: &mut u32) -> f32 {
        let white = rand_signed(rng);
        self.lp_a += 0.02 * (white - self.lp_a);
        self.lp_b += 0.12 * (white - self.lp_b);
        self.drift += 0.001 * (rand_signed(rng) - self.drift);
        let low = self.lp_a;
        let mid = self.lp_b - self.lp_a * 0.6;
        let high = white - self.lp_b;

        let trigger = ((xorshift32(rng) as f32) / u32::MAX as f32) < (0.0004 + bio_rate * 0.0025);
        if trigger {
            self.burst_env = 1.0;
        }
        self.burst_env *= match mode {
            BioType::GeologicalNoise => 0.997,
            BioType::IceNoise => 0.985,
            BioType::Precipitation => 0.94,
            _ => 0.965,
        };

        let shaped = match mode {
            BioType::AmbientOcean => low * 0.65 + mid * 0.22 + high * 0.04 + (18.0 * self.drift).sin() * 0.03,
            BioType::Precipitation => high * (0.22 + 0.46 * bio_rate) + mid * 0.12 + self.burst_env * high * 0.5,
            BioType::IceNoise => low * 0.32 + mid * 0.28 + self.burst_env * (low * 0.8 + high * 0.25),
            BioType::GeologicalNoise => low * 0.82 + mid * 0.14 + self.burst_env * (low * 1.2 + mid * 0.4),
            _ => low * 0.4 + mid * 0.2,
        };
        let level = match mode {
            BioType::AmbientOcean => 0.18 + 0.18 * bio_rate,
            BioType::Precipitation => 0.15 + 0.30 * bio_rate,
            BioType::IceNoise => 0.18 + 0.26 * bio_rate,
            BioType::GeologicalNoise => 0.16 + 0.34 * bio_rate,
            _ => 0.2,
        };
        let _ = sample_rate;
        shaped * level
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
    low_call: LowCallState,
    click_train: ClickTrainState,
    social_call: SocialCallState,
    rotor: RotorState,
    noise_field: NoiseFieldState,
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
            low_call: LowCallState::new(),
            click_train: ClickTrainState::new(),
            social_call: SocialCallState::new(),
            rotor: RotorState::new(),
            noise_field: NoiseFieldState::new(),
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
            BioType::BlueWhale | BioType::FinWhale | BioType::MinkePulse | BioType::FishChorus => {
                self.low_call.tick(mode, sample_rate, self.bio_rate, rng)
            }
            BioType::SpermWhaleClick => self.click_train.tick(mode, sample_rate, self.bio_rate, rng),
            BioType::OrcaCall | BioType::BelugaCall | BioType::HerringSchool | BioType::DolphinSchool => {
                self.social_call.tick(mode, sample_rate, self.bio_rate, rng)
            }
            BioType::HelicopterRotor | BioType::FixedWingAircraft | BioType::JetAircraft => {
                self.rotor.tick(mode, sample_rate, self.bio_rate, rpm, rng)
            }
            BioType::AmbientOcean | BioType::Precipitation | BioType::IceNoise | BioType::GeologicalNoise => {
                self.noise_field.tick(mode, sample_rate, self.bio_rate, rng)
            }
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
    cavitation_level: f32,
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
            cavitation_level: 0.35,
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

        let e = self.engine.tick(sample_rate, &mut self.rng);
        let c = self
            .cav
            .tick(
                self.engine.current_rpm,
                self.engine.shaft_phase,
                self.engine.blade_phase,
                self.engine.blades,
                self.engine.load,
                self.cavitation_level,
                self.engine.class_profile,
                &mut self.rng,
            );
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
            PARAM_SHAFT_RATE => v.engine.target_shaft_rate = clamp(value, 0.0, 120.0),
            PARAM_LOAD => v.engine.load = clamp(value, 0.0, 1.0),
            PARAM_RPM_JITTER => v.engine.rpm_jitter = clamp(value, 0.0, 1.0),
            PARAM_CLASS_PROFILE => v.engine.class_profile = clamp(value.round(), 0.0, 4.0) as u32,
            PARAM_CAVITATION_LEVEL => v.cavitation_level = clamp(value, 0.0, 1.0),
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

    pub fn output_copy(&self) -> Vec<f32> {
        self.output[0..self.last_frames].to_vec()
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

#[wasm_bindgen]
pub fn param_shaft_rate() -> u32 {
    PARAM_SHAFT_RATE
}

#[wasm_bindgen]
pub fn param_load() -> u32 {
    PARAM_LOAD
}

#[wasm_bindgen]
pub fn param_rpm_jitter() -> u32 {
    PARAM_RPM_JITTER
}

#[wasm_bindgen]
pub fn param_class_profile() -> u32 {
    PARAM_CLASS_PROFILE
}

#[wasm_bindgen]
pub fn param_cavitation_level() -> u32 {
    PARAM_CAVITATION_LEVEL
}
