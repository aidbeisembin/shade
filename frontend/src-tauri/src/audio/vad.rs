use anyhow::{anyhow, Result};
use silero_rs::{VadConfig, VadSession, VadTransition};
use log::{debug, info, warn};
use std::collections::VecDeque;
use std::time::Duration;

/// Silero VAD only operates at 16kHz; input is resampled to this rate, and every
/// sample count and timestamp inside this module is expressed in it.
const VAD_SAMPLE_RATE: u32 = 16000;

/// Silence kept after the last speech frame of a segment (Silero `post_speech_pad`).
const POST_SPEECH_PAD_MS: usize = 400;

/// Live path only (`with_live_limits`, pipeline.rs). A speech piece is normally closed by a
/// pause of `VAD_REDEMPTION_TIME_MS`; someone talking without such a pause kept one piece
/// open for tens of seconds (owner's log: 10 % of pieces over 14 s, longest 131 s) and the
/// live transcript stayed empty all that time. From this length on, the piece is closed at a
/// quiet moment between words.
pub const LIVE_SOFT_MAX_PIECE_MS: usize = 6_000;
/// Live path only: the piece is closed by this length in any case, at the quietest moment
/// after `LIVE_SOFT_MAX_PIECE_MS` (or exactly here if none is quiet). 10 s was tried first:
/// text came at ~10.4 s, past the ~8 s goal, and quality was no better (PR, table).
pub const LIVE_HARD_MAX_PIECE_MS: usize = 8_000;
/// At the hard limit the quietest moment after the soft limit is used only if it is quieter
/// than this share of the mean (or Silero hears no speech in it); otherwise there is no
/// quiet moment and the cut falls on the hard limit.
const LIVE_QUIET_RATIO: f32 = 0.6;
/// After a forced cut the rest of the utterance is sent when the pause finally comes. If it
/// holds less speech than this, it is only the tail silence and the post-speech pad, and is
/// dropped instead of being sent to the model (Whisper invents text on silence).
const LIVE_MIN_TAIL_SPEECH_MS: usize = 90;

/// Limits on live pieces of continuous speech. `DEFAULT` is what the app uses; the other
/// values exist for tests and the measurement in `vad_bench.rs`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LiveLimits {
    pub soft_ms: usize,
    pub hard_ms: usize,
    /// After `soft_ms`, cut at once in a micro-pause: a run of frames where Silero hears no
    /// speech, at least `min_gap_ms` long (shorter than the pause that ends a piece). Without
    /// one, the piece waits for `hard_ms` and is cut at the quietest moment in between.
    /// A dip in loudness alone is not enough for an early cut: the closure before «п», «т»,
    /// «к» inside a word is as quiet for 50-90 ms (measured, see PR).
    pub cut_at_first_gap: bool,
    pub min_gap_ms: usize,
}

impl LiveLimits {
    pub const DEFAULT: LiveLimits = LiveLimits {
        soft_ms: LIVE_SOFT_MAX_PIECE_MS,
        hard_ms: LIVE_HARD_MAX_PIECE_MS,
        cut_at_first_gap: true,
        min_gap_ms: 150,
    };
}

/// Loudness of one 30 ms VAD frame of the current piece.
#[derive(Debug, Clone, Copy)]
struct FrameLevel {
    start_ms: usize,
    rms: f32,
    /// Silero's probability for this frame was below the negative threshold
    silent: bool,
}

impl FrameLevel {
    /// The cut goes through the middle of the frame
    fn mid_ms(&self) -> usize {
        self.start_ms + 15
    }
}

/// Where to close the open piece, given the loudness of its frames so far (the last one is
/// the frame just heard), or None to keep it open. After `soft_ms` the first micro-pause of
/// `min_gap_ms` closes it in its middle (with `cut_at_first_gap`); at `hard_ms` the quietest
/// moment after `soft_ms` (loudness averaged over 90 ms) is used, or, if none is quiet, the
/// hard limit itself.
fn choose_cut(frames: &VecDeque<FrameLevel>, piece_start_ms: usize, limits: LiveLimits) -> Option<usize> {
    let frame = *frames.back()?;
    let frame_end_ms = frame.start_ms + 30;
    let piece_ms = frame_end_ms.saturating_sub(piece_start_ms);
    if piece_ms < limits.soft_ms {
        return None;
    }
    let mean = frames.iter().map(|f| f.rms).sum::<f32>() / frames.len() as f32;
    let soft_from_ms = piece_start_ms + limits.soft_ms;
    if limits.cut_at_first_gap {
        let quiet_run = frames
            .iter()
            .rev()
            .take_while(|f| f.silent)
            .count();
        if quiet_run > 0 && quiet_run * 30 >= limits.min_gap_ms {
            let run_start_ms = frames[frames.len() - quiet_run].start_ms;
            let cut_ms = (run_start_ms + frame_end_ms) / 2;
            if cut_ms >= soft_from_ms {
                return Some(cut_ms);
            }
        }
    }
    if piece_ms < limits.hard_ms {
        return None;
    }
    // Loudness around each frame (it and its neighbours): a short closure inside a word is
    // less quiet than a real gap between words
    let smoothed = |i: usize| {
        let from = i.saturating_sub(1);
        let to = (i + 1).min(frames.len() - 1);
        frames.range(from..=to).map(|f| f.rms).sum::<f32>() / (to - from + 1) as f32
    };
    let quietest = (0..frames.len())
        .filter(|&i| frames[i].mid_ms() >= soft_from_ms)
        .map(|i| (frames[i], smoothed(i)))
        .min_by(|(a, sa), (b, sb)| {
            (!a.silent, *sa)
                .partial_cmp(&(!b.silent, *sb))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    match quietest {
        Some((f, level)) if f.silent || level < LIVE_QUIET_RATIO * mean => Some(f.mid_ms()),
        _ => Some(frame_end_ms),
    }
}

/// Represents a complete speech segment detected by VAD
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
}

/// Processes audio in 30ms chunks but returns complete speech segments
pub struct ContinuousVadProcessor {
    session: VadSession,
    chunk_size: usize,
    sample_rate: u32,
    buffer: Vec<f32>,
    speech_segments: VecDeque<SpeechSegment>,
    current_speech: Vec<f32>,
    in_speech: bool,
    processed_samples: usize,
    speech_start_sample: usize,
    // State tracking for smart logging
    last_logged_state: bool,
    // Live limits on continuous speech (None on the batch paths). The utterance stays in
    // Silero's buffer from its start; a forced cut only moves `piece_start_ms` forward, and
    // pieces are sliced out of that buffer, so they follow each other without gaps.
    live_limits: Option<LiveLimits>,
    piece_start_ms: usize,
    cut_in_utterance: bool,
    piece_frames: VecDeque<FrameLevel>,
    // The zero-padded last frame of `flush()` is not real audio: no cut may land in it
    flushing: bool,
}

impl ContinuousVadProcessor {
    pub fn new(input_sample_rate: u32, redemption_time_ms: u32) -> Result<Self> {
        crate::ensure_onnx_runtime_available()?;

        // Use STRICT settings to prevent silence from reaching Whisper
        let mut config = VadConfig::default();
        config.sample_rate = VAD_SAMPLE_RATE as usize;

        // CONTINUOUS SPEECH FIX: Tuned for capturing complete 5+ second utterances
        // Previous: 0.55/0.40 with 400ms redemption was fragmenting speech into 40ms segments
        // New: More lenient thresholds + longer redemption for continuous speech
        config.positive_speech_threshold = 0.50;  // Silero default - good for continuous speech
        config.negative_speech_threshold = 0.35;  // Silero default - allows natural pauses

        // Use the caller's redemption time without additional capping. The batch
        // paths (`import.rs`, `retranscription.rs`) pass 2000ms to bridge natural
        // pauses; the live path (`pipeline.rs`) passes 500ms to reduce pause-induced
        // latency. Uninterrupted speech on the live path is bounded separately by
        // `with_live_limits` (soft and hard piece length).
        config.redemption_time = Duration::from_millis(redemption_time_ms as u64);
        config.pre_speech_pad = Duration::from_millis(300);   // Pre-speech padding for context
        config.post_speech_pad = Duration::from_millis(POST_SPEECH_PAD_MS as u64);  // Increased: more context at end

        // CRITICAL FIX: Increased min_speech_time to prevent tiny 40ms fragments
        // Previous: 100ms allowed too-short segments that Whisper rejects
        // New: 250ms ensures segments are substantial enough for Whisper (>100ms requirement)
        config.min_speech_time = Duration::from_millis(250);  // Prevent tiny fragments

        debug!("Creating VAD session with: sample_rate={}Hz, redemption={}ms, min_speech={}ms, input_rate={}Hz",
               VAD_SAMPLE_RATE, redemption_time_ms, 250, input_sample_rate);

        let session = VadSession::new(config)
            .map_err(|e| anyhow!("Failed to create VAD session: {:?}", e))?;

        // VAD uses 30ms chunks at 16kHz (480 samples)
        let vad_chunk_size = (VAD_SAMPLE_RATE as f32 * 0.03) as usize; // 480 samples

        info!("VAD processor created: input={}Hz, vad={}Hz, chunk_size={} samples",
              input_sample_rate, VAD_SAMPLE_RATE, vad_chunk_size);

        Ok(Self {
            session,
            chunk_size: vad_chunk_size,
            sample_rate: input_sample_rate, // Store input rate for resampling ratio in resample_to_16k()
            buffer: Vec::with_capacity(vad_chunk_size * 2),
            speech_segments: VecDeque::new(),
            current_speech: Vec::new(),
            in_speech: false,
            processed_samples: 0,
            speech_start_sample: 0,
            // Initialize state tracking
            last_logged_state: false,
            live_limits: None,
            piece_start_ms: 0,
            cut_in_utterance: false,
            piece_frames: VecDeque::new(),
            flushing: false,
        })
    }

    /// Live path (pipeline.rs): pieces of continuous speech are closed at a quiet moment
    /// after `limits.soft_ms`, and by `limits.hard_ms` in any case. The batch paths
    /// (import.rs, retranscription.rs) do not call this: they want long pieces.
    pub fn with_live_limits(mut self, limits: LiveLimits) -> Self {
        assert!(limits.soft_ms <= limits.hard_ms, "soft limit must not exceed hard limit");
        self.live_limits = Some(limits);
        self
    }

    /// Called for every frame while in speech: records its loudness and closes the open
    /// piece if `choose_cut` says so.
    fn consider_live_cut(&mut self, frame: FrameLevel) {
        let Some(limits) = self.live_limits else { return };
        if !self.in_speech || self.flushing {
            return;
        }
        self.piece_frames.push_back(frame);
        if let Some(cut_ms) = choose_cut(&self.piece_frames, self.piece_start_ms, limits) {
            self.emit_forced_piece(cut_ms);
        }
    }

    /// Sends the open piece up to `cut_ms` and starts the next one there.
    fn emit_forced_piece(&mut self, cut_ms: usize) {
        // Silero keeps the utterance from its start until the pause; never ask for audio it
        // does not hold (that would panic inside silero)
        // (silero reports the range as f64 seconds: round, `as_millis` would floor 1 ms off)
        let (buffer_from, buffer_to) = self.session.current_buffer_range();
        let to_ms = |d: Duration| (d.as_secs_f64() * 1000.0).round() as usize;
        let (buffer_from_ms, buffer_to_ms) = (to_ms(buffer_from), to_ms(buffer_to));
        if self.piece_start_ms < buffer_from_ms
            || cut_ms > buffer_to_ms
            || cut_ms <= self.piece_start_ms
        {
            warn!(
                "VAD: forced cut skipped, [{}, {}) ms is outside Silero's buffer [{}, {}) ms",
                self.piece_start_ms, cut_ms, buffer_from_ms, buffer_to_ms
            );
            return;
        }
        let samples = self.session.get_speech(self.piece_start_ms, Some(cut_ms)).to_vec();
        info!(
            "VAD: forced cut of continuous speech: {} ms piece ({} samples)",
            cut_ms - self.piece_start_ms,
            samples.len()
        );
        self.speech_segments.push_back(SpeechSegment {
            samples,
            start_timestamp_ms: self.piece_start_ms as f64,
            end_timestamp_ms: cut_ms as f64,
            confidence: 0.85,
        });
        self.piece_start_ms = cut_ms;
        self.cut_in_utterance = true;
        // Frames after the cut belong to the next piece
        while self.piece_frames.front().is_some_and(|f| f.start_ms < cut_ms) {
            self.piece_frames.pop_front();
        }
        self.current_speech.clear();
    }

    fn reset_piece(&mut self, start_ms: usize) {
        self.piece_start_ms = start_ms;
        self.cut_in_utterance = false;
        self.piece_frames.clear();
    }

    /// Process incoming audio samples and return any complete speech segments
    /// Handles resampling from input sample rate to 16kHz for VAD processing
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        // Resample to 16kHz if needed
        let resampled_audio = if self.sample_rate == 16000 {
            samples.to_vec()
        } else {
            self.resample_to_16k(samples)?
        };

        self.buffer.extend_from_slice(&resampled_audio);
        let mut completed_segments = Vec::new();

        // Process complete 30ms chunks (480 samples at 16kHz)
        while self.buffer.len() >= self.chunk_size {
            let chunk: Vec<f32> = self.buffer.drain(..self.chunk_size).collect();
            self.process_chunk(&chunk)?;

            // Extract any completed speech segments
            while let Some(segment) = self.speech_segments.pop_front() {
                completed_segments.push(segment);
            }
        }

        Ok(completed_segments)
    }

    /// Improved resampling from input sample rate to 16kHz with anti-aliasing
    /// Uses linear interpolation and basic low-pass filtering for better quality
    fn resample_to_16k(&self, samples: &[f32]) -> Result<Vec<f32>> {
        if self.sample_rate == 16000 {
            return Ok(samples.to_vec());
        }

        // Calculate downsampling ratio
        let ratio = self.sample_rate as f64 / 16000.0;
        let output_len = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_len);

        // Apply simple low-pass filter before downsampling to reduce aliasing
        let cutoff_freq = 0.4; // Normalized frequency (0.4 * Nyquist)
        let mut filtered_samples = Vec::with_capacity(samples.len());
        
        // Simple moving average filter (basic low-pass)
        let filter_size = (self.sample_rate as f64 / (cutoff_freq * self.sample_rate as f64)) as usize;
        let filter_size = std::cmp::max(1, std::cmp::min(filter_size, 5)); // Limit filter size
        
        for i in 0..samples.len() {
            let start = if i >= filter_size { i - filter_size } else { 0 };
            let end = std::cmp::min(i + filter_size + 1, samples.len());
            let sum: f32 = samples[start..end].iter().sum();
            filtered_samples.push(sum / (end - start) as f32);
        }

        // Linear interpolation downsampling
        for i in 0..output_len {
            let source_pos = i as f64 * ratio;
            let source_index = source_pos as usize;
            let fraction = source_pos - source_index as f64;
            
            if source_index + 1 < filtered_samples.len() {
                // Linear interpolation
                let sample1 = filtered_samples[source_index];
                let sample2 = filtered_samples[source_index + 1];
                let interpolated = sample1 + (sample2 - sample1) * fraction as f32;
                resampled.push(interpolated);
            } else if source_index < filtered_samples.len() {
                resampled.push(filtered_samples[source_index]);
            }
        }

        debug!("Resampled from {} samples ({}Hz) to {} samples (16kHz) with anti-aliasing",
               samples.len(), self.sample_rate, resampled.len());

        Ok(resampled)
    }

    /// Flush any remaining audio and return final speech segments
    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        debug!("VAD flush: in_speech={}, current_speech_len={}, buffer_len={}, speech_segments_queued={}",
              self.in_speech, self.current_speech.len(), self.buffer.len(), self.speech_segments.len());

        let mut completed_segments = Vec::new();
        // Preserve the real post-resampling endpoint before padding the final VAD frame.
        let real_end_sample = self.processed_samples + self.buffer.len();

        // Process any remaining buffered audio
        if !self.buffer.is_empty() {
            let remaining = self.buffer.clone();
            self.buffer.clear();

            // Pad to chunk size if needed
            let mut padded_chunk = remaining;
            if padded_chunk.len() < self.chunk_size {
                padded_chunk.resize(self.chunk_size, 0.0);
            }

            self.flushing = true;
            let result = self.process_chunk(&padded_chunk);
            self.flushing = false;
            result?;
        }

        // Live path: a forced cut may have already sent the start of this utterance; only
        // the rest, from the last cut, is left
        let piece_start_sample = if self.cut_in_utterance {
            self.piece_start_ms * VAD_SAMPLE_RATE as usize / 1000
        } else {
            self.speech_start_sample
        };
        // A cut exactly at the end of the audio leaves nothing to send
        let nothing_after_cut = self.cut_in_utterance && real_end_sample <= piece_start_sample;

        // Force end any ongoing speech
        if self.in_speech && nothing_after_cut {
            self.current_speech.clear();
            self.in_speech = false;
            self.reset_piece(0);
        } else if self.in_speech && (self.cut_in_utterance || !self.current_speech.is_empty()) {
            let real_sample_count = real_end_sample
                .checked_sub(piece_start_sample)
                .filter(|count| *count > 0)
                .ok_or_else(|| {
                    anyhow!(
                        "VAD flush invariant violated: active speech interval [{}, {}) is empty or reversed",
                        piece_start_sample,
                        real_end_sample
                    )
                })?;
            // Silero's buffer holds the utterance from its start, before any forced cut
            let offset = piece_start_sample - self.speech_start_sample;
            let active_speech = self.session.get_current_speech();
            if active_speech.len() < offset + real_sample_count {
                return Err(anyhow!(
                    "VAD flush invariant violated: Silero active speech buffer has {} samples, but [{}, {}) requires {}",
                    active_speech.len(),
                    piece_start_sample,
                    real_end_sample,
                    offset + real_sample_count
                ));
            }
            let samples = active_speech[offset..offset + real_sample_count].to_vec();
            let start_ms = (piece_start_sample as f64 / VAD_SAMPLE_RATE as f64) * 1000.0;
            let end_ms = (real_end_sample as f64 / VAD_SAMPLE_RATE as f64) * 1000.0;

            debug!("VAD flush: Force-ending speech - start={}ms, end={}ms, duration={}ms, samples={}",
                  start_ms, end_ms, end_ms - start_ms, samples.len());

            let segment = SpeechSegment {
                samples,
                start_timestamp_ms: start_ms,
                end_timestamp_ms: end_ms,
                confidence: 0.8, // Estimated confidence for forced end
            };

            self.speech_segments.push_back(segment);
            self.current_speech.clear();
            self.in_speech = false;
            self.reset_piece(0);
        }

        // Extract all remaining segments
        while let Some(segment) = self.speech_segments.pop_front() {
            completed_segments.push(segment);
        }

        Ok(completed_segments)
    }

    fn process_chunk(&mut self, chunk: &[f32]) -> Result<()> {
        // Track accumulated speech buffer size to detect memory issues
        let current_speech_size = self.current_speech.len();
        if current_speech_size > 1_000_000 {
            // More than ~62 seconds of accumulated speech at 16kHz
            warn!("VAD: Accumulated speech buffer is large: {} samples ({:.1}s) - possible memory issue",
                  current_speech_size, current_speech_size as f64 / 16000.0);
        }

        let transitions = self.session.process(chunk)
            .map_err(|e| anyhow!("VAD processing failed: {}", e))?;

        // Log transitions for debugging
        if !transitions.is_empty() {
            debug!("VAD transitions at sample {}: {} transitions", self.processed_samples, transitions.len());
        }

        // Handle VAD transitions
        for transition in transitions {
            match transition {
                VadTransition::SpeechStart { timestamp_ms } => {
                    // Only log if state changed
                    if !self.last_logged_state {
                        debug!("VAD: Speech started at {}ms", timestamp_ms);
                        self.last_logged_state = true;
                    }
                    self.in_speech = true;
                    // `timestamp_ms` is ALREADY session-absolute: silero computes it as
                    // `processed_duration() - pre_speech_pad`, where `processed_duration()`
                    // is every sample the network has seen this session. Adding our own
                    // session-absolute `processed_samples` to it double-counted the
                    // position, producing a start timestamp of roughly 2x the true one.
                    //
                    // The only reader is the end-of-recording flush below, so the bug
                    // surfaced once per recording, on the final segment — which landed at
                    // ~2x the file duration and sorted to the end of the transcript.
                    self.speech_start_sample = timestamp_ms * VAD_SAMPLE_RATE as usize / 1000;
                    self.current_speech.clear();
                    self.reset_piece(timestamp_ms);
                }
                VadTransition::SpeechEnd { start_timestamp_ms, end_timestamp_ms, samples } => {
                    // Only log if we were previously in speech state
                    if self.last_logged_state {
                        debug!("VAD: Speech ended at {}ms (duration: {}ms)", end_timestamp_ms, end_timestamp_ms - start_timestamp_ms);
                        self.last_logged_state = false;
                    }
                    self.in_speech = false;

                    // Live path after a forced cut: Silero's samples cover the whole
                    // utterance, its start is already sent; only the rest from the last cut
                    if self.cut_in_utterance {
                        let piece_start_ms = self.piece_start_ms;
                        self.reset_piece(0);
                        self.current_speech.clear();
                        let offset = piece_start_ms.saturating_sub(start_timestamp_ms)
                            * VAD_SAMPLE_RATE as usize
                            / 1000;
                        let speech_end_ms = end_timestamp_ms.saturating_sub(POST_SPEECH_PAD_MS);
                        if offset < samples.len()
                            && speech_end_ms >= piece_start_ms + LIVE_MIN_TAIL_SPEECH_MS
                        {
                            info!(
                                "VAD: rest of a cut utterance: {} ms",
                                end_timestamp_ms - piece_start_ms
                            );
                            self.speech_segments.push_back(SpeechSegment {
                                samples: samples[offset..].to_vec(),
                                start_timestamp_ms: piece_start_ms as f64,
                                end_timestamp_ms: end_timestamp_ms as f64,
                                confidence: 0.9,
                            });
                        } else {
                            debug!("VAD: rest of a cut utterance is silence only, not sent");
                        }
                        continue;
                    }

                    // Use samples from VAD transition if available, otherwise use accumulated samples
                    let speech_samples = if !samples.is_empty() {
                        samples
                    } else {
                        self.current_speech.clone()
                    };

                    if !speech_samples.is_empty() {
                        let segment = SpeechSegment {
                            samples: speech_samples,
                            start_timestamp_ms: start_timestamp_ms as f64,
                            end_timestamp_ms: end_timestamp_ms as f64,
                            confidence: 0.9, // VAD confidence
                        };

                        info!("VAD: Completed speech segment: {:.1}ms duration, {} samples",
                              end_timestamp_ms - start_timestamp_ms, segment.samples.len());

                        self.speech_segments.push_back(segment);
                    }

                    self.current_speech.clear();
                }
            }
        }

        // Accumulate speech if we're currently in a speech state
        if self.in_speech {
            self.current_speech.extend_from_slice(chunk);
            if self.live_limits.is_some() {
                let rms = (chunk.iter().map(|x| x * x).sum::<f32>() / chunk.len().max(1) as f32).sqrt();
                self.consider_live_cut(FrameLevel {
                    start_ms: self.processed_samples * 1000 / VAD_SAMPLE_RATE as usize,
                    rms,
                    silent: self.session.current_silence_samples() > 0,
                });
            }
        }

        self.processed_samples += chunk.len();
        Ok(())
    }
}

/// Legacy function for backward compatibility - now uses the optimized approach
pub fn extract_speech_16k(samples_mono_16k: &[f32]) -> Result<Vec<f32>> {
    let mut processor = ContinuousVadProcessor::new(16000, 400)?;

    // Process all audio
    let mut all_segments = processor.process_audio(samples_mono_16k)?;
    let final_segments = processor.flush()?;
    all_segments.extend(final_segments);

    // Concatenate all speech segments
    let mut result = Vec::new();
    let num_segments = all_segments.len();
    for segment in &all_segments {
        result.extend_from_slice(&segment.samples);
    }

    // Apply balanced energy filtering for very short segments
    if result.len() < 1600 { // Less than 100ms at 16kHz
        let input_energy: f32 = samples_mono_16k.iter().map(|&x| x * x).sum::<f32>() / samples_mono_16k.len() as f32;
        let rms = input_energy.sqrt();
        let peak = samples_mono_16k.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);

        // BALANCED FIX: Lowered thresholds to preserve quiet speech while still filtering silence
        // Previous aggressive values (0.08/0.15) were discarding valid quiet speech
        // New values (0.03/0.08) are more balanced - catch quiet speech, reject pure silence
        if rms < 0.2 || peak < 0.20 {
            info!("-----VAD detected silence/noise (RMS: {:.6}, Peak: {:.6}), skipping to prevent hallucinations-----", rms, peak);
            return Ok(Vec::new());
        } else {
            info!("VAD detected speech with sufficient energy (RMS: {:.6}, Peak: {:.6})", rms, peak);
            return Ok(samples_mono_16k.to_vec());
        }
    }

    debug!("VAD: Processed {} samples, extracted {} speech samples from {} segments",
           samples_mono_16k.len(), result.len(), num_segments);

    Ok(result)
}

/// Simple convenience function to get speech chunks from audio
/// Uses the optimized ContinuousVadProcessor with configurable redemption time
pub fn get_speech_chunks(samples_mono_16k: &[f32], redemption_time_ms: u32) -> Result<Vec<SpeechSegment>> {
    get_speech_chunks_with_progress(samples_mono_16k, redemption_time_ms, |_, _| true)
}

/// Get speech chunks with progress callback and cancellation support
/// The callback receives (progress_percent, segments_found) and returns false to cancel
pub fn get_speech_chunks_with_progress<F>(
    samples_mono_16k: &[f32],
    redemption_time_ms: u32,
    mut progress_callback: F,
) -> Result<Vec<SpeechSegment>>
where
    F: FnMut(u32, usize) -> bool,
{
    let mut processor = ContinuousVadProcessor::new(16000, redemption_time_ms)?;

    let total_samples = samples_mono_16k.len();

    // For large files (>1 minute at 16kHz = 960,000 samples), process in chunks with progress logging
    const LARGE_FILE_THRESHOLD: usize = 960_000;
    const CHUNK_SIZE: usize = 160_000; // 10 seconds at 16kHz

    let mut all_segments = Vec::new();

    if total_samples > LARGE_FILE_THRESHOLD {
        info!("VAD: Processing large file ({} samples = {:.1}s), will log progress...",
              total_samples, total_samples as f64 / 16000.0);

        let mut processed = 0;
        let mut last_progress = 0u32;
        let mut chunk_count = 0;
        let total_chunks = (total_samples + CHUNK_SIZE - 1) / CHUNK_SIZE;

        for chunk in samples_mono_16k.chunks(CHUNK_SIZE) {
            chunk_count += 1;

            let start_time = std::time::Instant::now();
            let segments = processor.process_audio(chunk)?;
            let elapsed = start_time.elapsed();

            // Debug log for chunk processing details
            debug!("VAD: Chunk {}/{} processed in {:?}, found {} segments",
                  chunk_count, total_chunks, elapsed, segments.len());

            // Warn if chunk processing took too long (>1 second)
            if elapsed.as_secs() > 1 {
                warn!("VAD: Chunk {} took {:?} - possible performance issue", chunk_count, elapsed);
            }

            all_segments.extend(segments);

            processed += chunk.len();
            let progress = ((processed * 100) / total_samples) as u32;

            // Call progress callback every 5%
            if progress >= last_progress + 5 {
                debug!("VAD: Progress {}% ({} segments found so far)", progress, all_segments.len());

                // Check for cancellation
                if !progress_callback(progress, all_segments.len()) {
                    info!("VAD: Cancelled by callback at {}%", progress);
                    return Err(anyhow!("VAD processing cancelled"));
                }

                last_progress = progress;
            }
        }

        let final_segments = processor.flush()?;
        all_segments.extend(final_segments);

        info!("VAD: Complete! Found {} speech segments", all_segments.len());
    } else {
        // Small file - process all at once
        all_segments = processor.process_audio(samples_mono_16k)?;
        let final_segments = processor.flush()?;
        all_segments.extend(final_segments);
    }

    Ok(all_segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Generate synthetic speech-like audio with alternating speech/silence
    fn generate_test_audio_with_speech(duration_seconds: f32, sample_rate: u32) -> Vec<f32> {
        let total_samples = (duration_seconds * sample_rate as f32) as usize;
        let mut samples = vec![0.0f32; total_samples];

        // Create speech-like patterns: bursts of sine waves with varying amplitude
        // Speech every 10 seconds for 5 seconds
        let speech_interval = 10.0; // seconds between speech starts
        let speech_duration = 5.0;  // seconds of speech

        for i in 0..total_samples {
            let time = i as f32 / sample_rate as f32;
            let cycle_time = time % speech_interval;

            // Speech occurs in the first `speech_duration` seconds of each cycle
            if cycle_time < speech_duration {
                // Generate speech-like signal: multiple frequencies with amplitude modulation
                let freq1 = 200.0 + (time * 50.0).sin() * 100.0; // Varying fundamental
                let freq2 = freq1 * 2.0; // Harmonic
                let freq3 = freq1 * 3.0; // Another harmonic

                let amplitude = 0.3 + 0.1 * (time * 5.0).sin(); // Amplitude modulation
                samples[i] = amplitude * (
                    0.5 * (2.0 * std::f32::consts::PI * freq1 * time).sin() +
                    0.3 * (2.0 * std::f32::consts::PI * freq2 * time).sin() +
                    0.2 * (2.0 * std::f32::consts::PI * freq3 * time).sin()
                );
            }
            // else: silence (already 0.0)
        }

        samples
    }

    #[test]
    fn test_vad_chunked_vs_single_processing() {
        // Generate 60 seconds of audio with speech patterns at 16kHz
        let audio = generate_test_audio_with_speech(60.0, 16000);
        println!("Generated {} samples ({:.1}s)", audio.len(), audio.len() as f32 / 16000.0);

        // Process all at once (like small files)
        let segments_single = get_speech_chunks(&audio, 2000).expect("Single processing failed");
        println!("Single processing found {} segments", segments_single.len());

        // Process in chunks (like large files)
        let segments_chunked = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
            println!("Chunked progress: {}%, {} segments", progress, segments);
            true // Don't cancel
        }).expect("Chunked processing failed");
        println!("Chunked processing found {} segments", segments_chunked.len());

        // Both should find the same number of segments (approximately)
        // Allow some variance due to chunk boundary effects
        let diff = (segments_single.len() as i32 - segments_chunked.len() as i32).abs();
        assert!(diff <= 1,
            "Chunked and single processing found different segment counts: {} vs {} (diff: {})",
            segments_single.len(), segments_chunked.len(), diff);
    }

    #[test]
    fn test_vad_large_file_progress() {
        // Generate 120 seconds (2 minutes) of audio - triggers large file threshold
        let audio = generate_test_audio_with_speech(120.0, 16000);
        let total_samples = audio.len();
        println!("Generated {} samples ({:.1}s)", total_samples, total_samples as f32 / 16000.0);

        // This should trigger the large file path (>960,000 samples)
        assert!(total_samples > 960_000, "Audio should be large enough to trigger chunked processing");

        let mut progress_updates = Vec::new();
        let segments = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
            progress_updates.push((progress, segments));
            true // Don't cancel
        }).expect("Processing failed");

        println!("Found {} segments with {} progress updates", segments.len(), progress_updates.len());

        // The synthetic signal is not real speech, so Silero may merge it into
        // one long segment. This test is specifically for the large-file path:
        // it must still emit speech and report monotonic progress through 100%.
        assert!(!segments.is_empty(), "Expected at least one speech segment");
        assert!(
            segments.iter().all(|segment| !segment.samples.is_empty()
                && segment.end_timestamp_ms > segment.start_timestamp_ms),
            "Expected all speech segments to contain audio with positive duration"
        );

        // Should have received progress updates
        assert!(!progress_updates.is_empty(), "Expected progress updates for large file");
        assert_eq!(
            progress_updates.last().map(|(progress, _)| *progress),
            Some(100),
            "Expected progress to reach 100%"
        );
        assert!(
            progress_updates
                .windows(2)
                .all(|pair| pair[0].0 < pair[1].0),
            "Expected progress updates to increase monotonically: {:?}",
            progress_updates
        );
    }

    #[test]
    fn test_vad_cancellation() {
        let audio = generate_test_audio_with_speech(120.0, 16000);

        // Cancel at 50%
        let result = get_speech_chunks_with_progress(&audio, 2000, |progress, _| {
            progress < 50 // Cancel when reaching 50%
        });

        // Should return error due to cancellation
        assert!(result.is_err(), "Expected cancellation error");
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("cancelled"), "Error should mention cancellation: {}", err_msg);
    }

    #[test]
    fn test_vad_continuous_processor_state_across_chunks() {
        // Test that VAD state is correctly maintained across chunk boundaries
        let mut processor = ContinuousVadProcessor::new(16000, 2000).expect("Failed to create processor");

        // Generate audio with a speech segment that spans a chunk boundary
        let chunk_size = 160_000; // 10 seconds
        let audio = generate_test_audio_with_speech(30.0, 16000); // 30 seconds

        // Process in 10-second chunks
        let mut all_segments = Vec::new();
        for (i, chunk) in audio.chunks(chunk_size).enumerate() {
            let segments = processor.process_audio(chunk).expect("Processing failed");
            println!("Chunk {}: processed {} samples, found {} segments", i, chunk.len(), segments.len());
            all_segments.extend(segments);
        }

        // Flush remaining
        let final_segments = processor.flush().expect("Flush failed");
        all_segments.extend(final_segments);

        println!("Total segments found: {}", all_segments.len());

        // Should find speech segments
        assert!(all_segments.len() >= 1, "Expected at least 1 speech segment");
    }

    #[test]
    fn test_vad_400ms_vs_2000ms_segmentation() {
        // Demonstrates why 2000ms redemption is needed for batch processing:
        // 400ms creates excessive fragmentation, 2000ms bridges natural pauses.
        //
        // Audio pattern: 60s with 5s speech / 5s silence cycles
        // Natural pauses within speech (sentence gaps) are 500ms-1.5s
        let audio = generate_test_audio_with_speech(60.0, 16000);

        let segments_400 = get_speech_chunks(&audio, 400).expect("400ms processing failed");
        let segments_2000 = get_speech_chunks(&audio, 2000).expect("2000ms processing failed");

        println!(
            "400ms redemption: {} segments, 2000ms redemption: {} segments",
            segments_400.len(),
            segments_2000.len()
        );

        // 2000ms should produce fewer or equal segments (bridges more pauses)
        assert!(
            segments_2000.len() <= segments_400.len(),
            "2000ms redemption ({} segments) should not produce more segments than 400ms ({} segments)",
            segments_2000.len(),
            segments_400.len()
        );

        // Verify segments have reasonable durations with 2000ms
        for (i, seg) in segments_2000.iter().enumerate() {
            let duration_ms = seg.end_timestamp_ms - seg.start_timestamp_ms;
            println!("2000ms segment {}: {:.0}ms duration", i, duration_ms);
            // Each segment should be at least 250ms (min_speech_time)
            assert!(duration_ms >= 200.0, "Segment {} too short: {:.0}ms", i, duration_ms);
        }
    }
    /// Leading silence, then speech that runs to the end of the buffer.
    ///
    /// This is the shape that matters for the flush path: an utterance that begins
    /// late in a long session and is still in progress when recording stops.
    fn generate_late_speech_audio(
        silence_seconds: f32,
        speech_seconds: f32,
        sample_rate: u32,
    ) -> Vec<f32> {
        let silence_samples = (silence_seconds * sample_rate as f32) as usize;
        let speech = generate_test_audio_with_speech(speech_seconds, sample_rate);

        let mut samples = vec![0.0f32; silence_samples];
        samples.extend_from_slice(&speech);
        samples
    }

    /// `speech_start_sample` records where the current utterance began, so it can
    /// never point past the number of samples the VAD has actually seen.
    ///
    /// It used to, because it was computed as `processed_samples + timestamp_ms` where
    /// silero's `timestamp_ms` is ALREADY session-absolute
    /// (`processed_duration() - pre_speech_pad`), which doubled the position. The only
    /// reader is the force-end branch in `flush()`, so in production the corruption
    /// escaped as one phantom segment per recording, timestamped past the end of the
    /// audio. The error grows with how late the utterance starts, which is why it took
    /// a long recording to surface.
    #[test]
    fn test_speech_start_sample_never_exceeds_processed_samples() {
        // 20s of silence, then 3s of speech still running when the buffer ends.
        let audio = generate_late_speech_audio(20.0, 3.0, 16000);

        let mut processor =
            ContinuousVadProcessor::new(16000, 2000).expect("Failed to create processor");
        processor
            .process_audio(&audio)
            .expect("process_audio failed");

        assert!(
            processor.in_speech,
            "expected to still be mid-speech at the end of the buffer; the invariant \
             below would not be exercised otherwise"
        );

        assert!(
            processor.speech_start_sample <= processor.processed_samples,
            "speech_start_sample ({}) is past processed_samples ({}) - \
             session-absolute timestamp double-count regression. \
             In seconds: start={:.2}s vs processed={:.2}s",
            processor.speech_start_sample,
            processor.processed_samples,
            processor.speech_start_sample as f64 / VAD_SAMPLE_RATE as f64,
            processor.processed_samples as f64 / VAD_SAMPLE_RATE as f64,
        );
    }

    /// A forced segment's timestamps and samples must describe the same real audio interval.
    #[test]
    fn test_flush_segment_timestamps_stay_within_audio_duration() {
        let audio = generate_late_speech_audio(20.0, 3.0, 16000);
        let audio_duration_ms = (audio.len() as f64 / VAD_SAMPLE_RATE as f64) * 1000.0;

        assert_eq!(audio.len(), 368_000);
        assert_eq!(
            audio.len() % 480,
            320,
            "fixture must require 160 samples of terminal VAD padding"
        );

        let mut processor =
            ContinuousVadProcessor::new(16000, 2000).expect("Failed to create processor");

        let segments = processor
            .process_audio(&audio)
            .expect("process_audio failed");
        assert!(
            segments.is_empty(),
            "process_audio completed a segment, so flush() would not exercise force-end"
        );
        assert!(
            processor.in_speech,
            "expected to still be mid-speech before flush()"
        );

        let flushed = processor.flush().expect("flush failed");
        assert_eq!(
            flushed.len(),
            1,
            "force-end must emit exactly one segment"
        );

        let segment = &flushed[0];
        let start_sample = ((segment.start_timestamp_ms / 1000.0)
            * VAD_SAMPLE_RATE as f64)
            .round() as usize;

        assert!(
            segment.start_timestamp_ms <= audio_duration_ms,
            "segment starts at {:.0}ms, beyond the {:.0}ms of audio supplied",
            segment.start_timestamp_ms,
            audio_duration_ms
        );
        assert_eq!(
            segment.end_timestamp_ms, 23_000.0,
            "forced segment must end at the real audio endpoint"
        );
        assert!(
            segment.end_timestamp_ms <= audio_duration_ms,
            "segment ends at {:.0}ms, beyond the {:.0}ms of audio supplied",
            segment.end_timestamp_ms,
            audio_duration_ms
        );
        assert!(
            segment.end_timestamp_ms >= segment.start_timestamp_ms,
            "segment ends before it starts: {:.0}ms -> {:.0}ms",
            segment.start_timestamp_ms,
            segment.end_timestamp_ms
        );
        assert_eq!(
            segment.samples.as_slice(),
            &audio[start_sample..],
            "forced payload must contain the exact real audio interval named by its timestamps"
        );
        assert_eq!(segment.samples.len(), audio.len() - start_sample);

        let timestamp_sample_count = (((segment.end_timestamp_ms
            - segment.start_timestamp_ms)
            / 1000.0)
            * VAD_SAMPLE_RATE as f64)
            .round() as usize;
        assert_eq!(
            timestamp_sample_count,
            segment.samples.len(),
            "timestamp duration and payload length must describe the same sample interval"
        );

        let payload_end_ms = segment.start_timestamp_ms
            + (segment.samples.len() as f64 / VAD_SAMPLE_RATE as f64) * 1000.0;
        assert!(
            (payload_end_ms - segment.end_timestamp_ms).abs() < 0.001,
            "payload ends at {payload_end_ms:.3}ms, timestamp ends at {:.3}ms",
            segment.end_timestamp_ms
        );

        assert!(
            processor.flush().expect("second flush failed").is_empty(),
            "flush() must not emit the same forced segment twice"
        );
    }

    // ---- Live limits on continuous speech (Shade, 2026-11-22) ----

    const LIVE_REDEMPTION_MS: u32 = 500;

    /// Speech-like babble without pauses: syllables of a voiced vowel (harmonics shaped by
    /// two random formants) after a short noise consonant. Silero hears it as one
    /// continuous utterance (a plain tone is dropped after ~1 s). `gap_ms` of near silence
    /// after each syllable; `level(t)` scales the loudness at time t (s).
    fn babble(duration_seconds: f32, gap_ms: f32, level: impl Fn(f32) -> f32) -> Vec<f32> {
        let total = (duration_seconds * 16000.0) as usize;
        let mut state: u32 = 7;
        let mut rnd = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as f32 / u32::MAX as f32
        };
        let mut out: Vec<f32> = Vec::with_capacity(total);
        while out.len() < total {
            let f0 = 110.0 + 120.0 * rnd();
            let f1 = 300.0 + 500.0 * rnd();
            let f2 = 900.0 + 1400.0 * rnd();
            let syllable = (180.0 * (0.7 + 0.6 * rnd()) * 16.0) as usize;
            for k in 0..40 * 16 {
                out.push((rnd() - 0.5) * 0.15 * (k as f32 / 640.0));
            }
            for k in 0..syllable {
                let t = k as f32 / 16000.0;
                let envelope = (std::f32::consts::PI * k as f32 / syllable as f32).sin();
                let voiced: f32 = (1..=12)
                    .map(|h| {
                        let f = f0 * h as f32;
                        let gain = 1.0 / (1.0 + ((f - f1) / 150.0).powi(2))
                            + 0.6 / (1.0 + ((f - f2) / 200.0).powi(2));
                        gain * (2.0 * std::f32::consts::PI * f * t).sin()
                    })
                    .sum();
                out.push((0.08 * envelope * voiced).clamp(-0.95, 0.95));
            }
            for _ in 0..(gap_ms * 16.0) as usize {
                out.push((rnd() - 0.5) * 0.002);
            }
        }
        out.truncate(total);
        for (i, sample) in out.iter_mut().enumerate() {
            *sample *= level(i as f32 / 16000.0);
        }
        out
    }

    /// Feeds audio the way the live pipeline does (small windows), then stops (flush).
    fn run_live(audio: &[f32], limits: Option<LiveLimits>) -> Vec<SpeechSegment> {
        let mut processor = ContinuousVadProcessor::new(16000, LIVE_REDEMPTION_MS)
            .expect("Failed to create processor");
        if let Some(limits) = limits {
            processor = processor.with_live_limits(limits);
        }
        let mut segments = Vec::new();
        for window in audio.chunks(800) {
            segments.extend(processor.process_audio(window).expect("process_audio failed"));
        }
        segments.extend(processor.flush().expect("flush failed"));
        segments
    }

    fn duration_ms(segment: &SpeechSegment) -> f64 {
        segment.end_timestamp_ms - segment.start_timestamp_ms
    }

    /// Every piece's samples match its timestamps, and pieces of one utterance follow each
    /// other without gaps or overlaps.
    fn assert_contiguous(pieces: &[SpeechSegment]) {
        for piece in pieces {
            let expected = (duration_ms(piece) * 16.0).round() as usize;
            assert_eq!(piece.samples.len(), expected, "samples must match timestamps");
        }
        for pair in pieces.windows(2) {
            assert_eq!(
                pair[0].end_timestamp_ms, pair[1].start_timestamp_ms,
                "pieces must follow each other without gaps or overlaps"
            );
        }
    }

    /// Case: speech with pauses. Pieces shorter than the soft limit are not touched.
    #[test]
    fn live_limits_keep_paused_speech_unchanged() {
        // 4 s of babble, 1.5 s pause, repeated: every piece is closed by its pause
        let mut audio = Vec::new();
        for _ in 0..8 {
            audio.extend(babble(4.0, 20.0, |_| 1.0));
            audio.extend(vec![0.0; 24_000]);
        }
        let before = run_live(&audio, None);
        let after = run_live(&audio, Some(LiveLimits::DEFAULT));
        assert_eq!(before.len(), 8, "the fixture must give one piece per phrase");
        assert_eq!(before.len(), after.len(), "pauses must still close pieces as before");
        for (b, a) in before.iter().zip(&after) {
            assert_eq!(b.start_timestamp_ms, a.start_timestamp_ms);
            assert_eq!(b.end_timestamp_ms, a.end_timestamp_ms);
            assert_eq!(b.samples, a.samples);
        }
        // The old synthetic fixture (5 s bursts) is unchanged too
        let audio = generate_test_audio_with_speech(60.0, 16000);
        let before = run_live(&audio, None);
        let after = run_live(&audio, Some(LiveLimits::DEFAULT));
        assert_eq!(
            before.iter().map(|s| (s.start_timestamp_ms, s.end_timestamp_ms)).collect::<Vec<_>>(),
            after.iter().map(|s| (s.start_timestamp_ms, s.end_timestamp_ms)).collect::<Vec<_>>()
        );
    }

    /// Case: 30 s of speech without pauses. No piece is longer than the hard limit, and
    /// the pieces put together are the audio the old single piece held (only the silence
    /// after the last word may be left out).
    #[test]
    fn continuous_speech_is_cut_within_hard_limit() {
        let mut audio = babble(30.0, 20.0, |_| 1.0);
        audio.extend(vec![0.0; 2 * 16000]); // the pause that finally closes it
        let before = run_live(&audio, None);
        assert_eq!(before.len(), 1, "without limits 30 s of speech is one piece");
        let pieces = run_live(&audio, Some(LiveLimits::DEFAULT));
        assert!(pieces.len() >= 3, "expected the 30 s to be cut, got {} pieces", pieces.len());
        for piece in &pieces {
            assert!(
                duration_ms(piece) <= (LIVE_HARD_MAX_PIECE_MS + POST_SPEECH_PAD_MS) as f64,
                "piece of {:.0} ms is over the hard limit",
                duration_ms(piece)
            );
        }
        assert_contiguous(&pieces);
        assert_eq!(pieces[0].start_timestamp_ms, before[0].start_timestamp_ms);
        let joined: Vec<f32> = pieces.iter().flat_map(|p| p.samples.iter().copied()).collect();
        assert_eq!(
            joined.as_slice(),
            &before[0].samples[..joined.len()],
            "no audio lost or repeated at the cuts"
        );
        let left_out_ms = (before[0].samples.len() - joined.len()) as f64 / 16.0;
        assert!(
            left_out_ms <= (POST_SPEECH_PAD_MS + LIVE_REDEMPTION_MS as usize) as f64,
            "{left_out_ms:.0} ms left out at the end, more than the trailing silence"
        );
    }

    /// Case: silence. No pieces at all.
    #[test]
    fn live_limits_silence_gives_no_pieces() {
        let audio = vec![0.0f32; 30 * 16000];
        assert!(run_live(&audio, Some(LiveLimits::DEFAULT)).is_empty());
    }

    /// Case: noise without speech. No pieces at all.
    #[test]
    fn live_limits_noise_gives_no_pieces() {
        // Deterministic white noise (xorshift), no voice in it
        let mut state: u32 = 0x9E37_79B9;
        let audio: Vec<f32> = (0..30 * 16000)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state as f32 / u32::MAX as f32 - 0.5) * 0.1
            })
            .collect();
        let pieces = run_live(&audio, Some(LiveLimits::DEFAULT));
        assert!(pieces.is_empty(), "noise produced {} pieces", pieces.len());
    }

    /// Case: speech is still going when recording stops. The last piece is not lost, ends
    /// at the real end of the audio, and joins the previous one without a gap.
    #[test]
    fn stop_during_continuous_speech_keeps_last_piece() {
        let audio = babble(23.0, 20.0, |_| 1.0);
        assert_eq!(audio.len() % 480, 320, "fixture must end inside a VAD frame");
        let audio_end_ms = audio.len() as f64 / 16.0;
        let pieces = run_live(&audio, Some(LiveLimits::DEFAULT));
        assert!(pieces.len() >= 3, "expected forced cuts before the stop");
        assert_contiguous(&pieces);
        assert_eq!(pieces.last().unwrap().end_timestamp_ms, audio_end_ms);
        let start = (pieces[0].start_timestamp_ms * 16.0) as usize;
        let joined: Vec<f32> = pieces.iter().flat_map(|p| p.samples.iter().copied()).collect();
        assert_eq!(joined.as_slice(), &audio[start..], "every sample after the start is sent once");
    }

    /// Case: timestamps. Over speech with and without pauses, piece starts only grow, no
    /// piece ends after the next one starts, and nothing ends past the audio.
    #[test]
    fn live_piece_timestamps_are_monotonic() {
        let mut audio = babble(25.0, 20.0, |_| 1.0);
        audio.extend(vec![0.0; 16000]);
        for _ in 0..3 {
            audio.extend(babble(3.0, 20.0, |_| 1.0));
            audio.extend(vec![0.0; 16000]);
        }
        audio.extend(babble(14.0, 20.0, |_| 1.0));
        let pieces = run_live(&audio, Some(LiveLimits::DEFAULT));
        assert!(pieces.len() >= 8, "got {} pieces", pieces.len());
        for pair in pieces.windows(2) {
            assert!(pair[0].start_timestamp_ms < pair[1].start_timestamp_ms);
            assert!(pair[0].end_timestamp_ms <= pair[1].start_timestamp_ms);
        }
        assert!(pieces.last().unwrap().end_timestamp_ms <= audio.len() as f64 / 16.0);
    }

    /// With micro-pauses in speech the first cut comes soon after the soft limit, not at
    /// the hard one.
    #[test]
    fn first_cut_comes_soon_after_soft_limit() {
        // 250 ms between syllables: a micro-pause, shorter than the 500 ms that ends a piece
        let pieces = run_live(&babble(20.0, 250.0, |_| 1.0), Some(LiveLimits::DEFAULT));
        assert!(pieces.len() >= 2, "the babble must stay one utterance and be cut");
        let first = duration_ms(&pieces[0]);
        assert!(
            (LIVE_SOFT_MAX_PIECE_MS as f64..LIVE_SOFT_MAX_PIECE_MS as f64 + 1_000.0).contains(&first),
            "first piece {first:.0} ms"
        );
    }

    fn frames(piece_start_ms: usize, levels: &[(f32, bool)]) -> VecDeque<FrameLevel> {
        levels
            .iter()
            .enumerate()
            .map(|(i, &(rms, silent))| FrameLevel { start_ms: piece_start_ms + i * 30, rms, silent })
            .collect()
    }

    /// The cut goes into a micro-pause: the first run of `min_gap_ms` where Silero hears no
    /// speech after the soft limit, through its middle.
    #[test]
    fn choose_cut_takes_first_gap_after_soft_limit() {
        let limits = LiveLimits::DEFAULT;
        let gap_frames = limits.min_gap_ms / 30;
        let soft_frames = limits.soft_ms / 30;
        let mut levels = vec![(0.3, false); soft_frames + 20];
        for i in 40..40 + gap_frames {
            levels[i] = (0.01, true); // a micro-pause before the soft limit does not count
        }
        let gap = soft_frames + 5;
        for i in gap..gap + gap_frames {
            levels[i] = (0.02, true);
        }
        let expected = (gap * 30 + (gap + gap_frames) * 30) / 2;
        for n in 1..=levels.len() {
            let cut = choose_cut(&frames(0, &levels[..n]), 0, limits);
            if n < gap + gap_frames {
                assert_eq!(cut, None, "no cut before the gap after the soft limit (frame {})", n - 1);
            } else {
                assert_eq!(cut, Some(expected));
                break;
            }
        }
    }

    /// A dip in loudness alone (a closure before «п», «т», «к» inside a word) never cuts
    /// early; a micro-pause cuts once it is `min_gap_ms` long.
    #[test]
    fn choose_cut_skips_short_dips_inside_words() {
        let limits = LiveLimits::DEFAULT;
        let soft_frames = limits.soft_ms / 30;
        let mut levels = vec![(0.3, false); soft_frames + 12];
        for i in soft_frames + 2..soft_frames + 8 {
            levels[i] = (0.01, false); // quiet, but Silero still hears speech: not a gap
        }
        assert_eq!(choose_cut(&frames(0, &levels), 0, limits), None);
        let gap_frames = limits.min_gap_ms / 30;
        for i in 0..gap_frames {
            levels.push((0.3, true));
            let cut = choose_cut(&frames(0, &levels), 0, limits);
            assert_eq!(cut.is_some(), i + 1 == gap_frames, "Silero silence counts once it is long enough");
        }
    }

    /// With no quiet moment at all the piece is cut exactly at the hard limit.
    #[test]
    fn choose_cut_falls_on_hard_limit_without_quiet_moment() {
        let limits = LiveLimits::DEFAULT;
        let hard_frames = limits.hard_ms / 30 + 1;
        let levels: Vec<(f32, bool)> =
            (0..hard_frames).map(|i| (0.3 + 0.05 * (i % 3) as f32, false)).collect();
        for n in 1..hard_frames {
            assert_eq!(choose_cut(&frames(0, &levels[..n]), 0, limits), None);
        }
        assert_eq!(choose_cut(&frames(0, &levels), 0, limits), Some(hard_frames * 30));
    }

    /// Waiting for the hard limit, the quietest frame after the soft limit wins.
    #[test]
    fn choose_cut_takes_quietest_moment_at_hard_limit() {
        let limits = LiveLimits { cut_at_first_gap: false, ..LiveLimits::DEFAULT };
        let hard_frames = limits.hard_ms / 30 + 1;
        let mut levels = vec![(0.3, false); hard_frames];
        levels[100] = (0.01, false); // before the soft limit: ignored
        // A one-frame dip (closure inside a word) loses to a wider, slightly shallower one
        levels[soft_index(limits) + 20] = (0.05, false);
        for i in soft_index(limits) + 59..=soft_index(limits) + 61 {
            levels[i] = (0.08, false);
        }
        assert_eq!(
            choose_cut(&frames(0, &levels), 0, limits),
            Some((soft_index(limits) + 60) * 30 + 15)
        );
    }

    fn soft_index(limits: LiveLimits) -> usize {
        limits.soft_ms / 30 + 1
    }

    /// The batch paths (import, re-recognition) never get limits: same long pieces as before.
    #[test]
    fn batch_path_has_no_live_limits() {
        let processor = ContinuousVadProcessor::new(16000, 2000).expect("processor");
        assert!(processor.live_limits.is_none());
    }
}
