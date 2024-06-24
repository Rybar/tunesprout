let audioCtx;
const activeOscillators = {};
const pressedKeys = {};
let filter, delay, feedback, distortion;

function initAudio() {
  if (audioCtx) {
    audioCtx.close();
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  // Create filter node
  filter = audioCtx.createBiquadFilter();
  updateFilterSettings();
  filter.connect(audioCtx.destination);
  
  // Create delay nodes
  delay = audioCtx.createDelay(2.0);
  feedback = audioCtx.createGain();
  updateDelaySettings();
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(filter);
  
  // Create distortion node
  distortion = audioCtx.createWaveShaper();
  updateDistortionSettings();
  distortion.connect(delay);
  distortion.connect(filter);
}

function updateFilterSettings() {
  const filterType = document.querySelector('input[name="filterType"]:checked').value;
  const filterFrequency = parseFloat(document.getElementById('filterFrequency').value);
  
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFrequency, audioCtx.currentTime);
}

function updateDelaySettings() {
  const delayTime = parseFloat(document.getElementById('delayTime').value);
  const decayAmount = parseFloat(document.getElementById('delayDecay').value);
  
  delay.delayTime.setValueAtTime(delayTime, audioCtx.currentTime);
  feedback.gain.setValueAtTime(decayAmount, audioCtx.currentTime);
}

function makeDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount * 800 : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function updateDistortionSettings() {
  const distortionAmount = parseFloat(document.getElementById('distortionAmount').value);
  distortion.curve = makeDistortionCurve(distortionAmount);
  distortion.oversample = '4x';
}

function createOscillator(frequency, detune, semitone, volume, waveform, xEnvAmount) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  const baseFrequency = frequency * Math.pow(2, semitone / 12);

  setWaveform(osc, waveform);

  osc.frequency.setValueAtTime(baseFrequency, audioCtx.currentTime);
  osc.detune.value = detune;
  gain.gain.setValueAtTime(0, audioCtx.currentTime);

  osc.connect(gain).connect(distortion);
  gain.connect(filter);
  osc.start();

  return { osc, gain, volume, baseFrequency, xEnvAmount };
}

function createNoise(volume) {
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0, audioCtx.currentTime);

  noise.connect(noiseGain).connect(distortion);
  noiseGain.connect(filter);
  noise.start();

  return { noiseGain, volume };
}

function setWaveform(oscillator, type) {
  oscillator.type = type;
}

function triggerADSR(gainNode, type, startTime, volume, oscillator) {
  const attack = parseFloat(document.getElementById('attack').value);
  const decay = parseFloat(document.getElementById('decay').value);
  const sustain = parseFloat(document.getElementById('sustain').value);
  const release = parseFloat(document.getElementById('release').value);

  gainNode.gain.cancelScheduledValues(startTime);

  if (type === 'start') {
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + attack);
    gainNode.gain.linearRampToValueAtTime(volume * sustain, startTime + attack + decay);
    if (oscillator) {
      const xEnvScale = oscillator.xEnvAmount / 100;
      oscillator.osc.frequency.cancelScheduledValues(startTime);
      oscillator.osc.frequency.setValueAtTime(oscillator.baseFrequency * (1 + xEnvScale), startTime);
      oscillator.osc.frequency.linearRampToValueAtTime(oscillator.baseFrequency, startTime + attack);
      oscillator.osc.frequency.linearRampToValueAtTime(oscillator.baseFrequency * (1 + xEnvScale * sustain), startTime + attack + decay);
    }
  } else if (type === 'stop') {
    gainNode.gain.setValueAtTime(gainNode.gain.value, startTime);
    gainNode.gain.linearRampToValueAtTime(0, startTime + release);
    if (oscillator) {
      oscillator.osc.frequency.cancelScheduledValues(startTime);
      oscillator.osc.frequency.setValueAtTime(oscillator.osc.frequency.value, startTime);
      oscillator.osc.frequency.linearRampToValueAtTime(oscillator.baseFrequency, startTime + release);
    }
  }
}

const noteFrequencies = {
  'Q': 261.63,  // C
  '2': 277.18,  // C#
  'W': 293.66,  // D
  '3': 311.13,  // D#
  'E': 329.63,  // E
  'R': 349.23,  // F
  '5': 369.99,  // F#
  'T': 392.00,  // G
  '6': 415.30,  // G#
  'Y': 440.00,  // A
  '7': 466.16,  // A#
  'U': 493.88,  // B
  'I': 523.25,  // C (one octave higher)
  'Z': 130.81,  // C
  'S': 138.59,  // C#
  'X': 146.83,  // D
  'D': 155.56,  // D#
  'C': 164.81,  // E
  'V': 174.61,  // F
  'G': 185.00,  // F#
  'B': 196.00,  // G
  'H': 207.65,  // G#
  'N': 220.00,  // A
  'J': 233.08,  // A#
  'M': 246.94,  // B
  ',': 261.63   // C
};

function playNote(key) {
  const frequency = noteFrequencies[key];
  if (!frequency || pressedKeys[key]) return;

  const semitone = parseFloat(document.getElementById('semitone').value);
  const detune = parseFloat(document.getElementById('detune').value);
  const volume1 = parseFloat(document.getElementById('volume1').value);
  const volume2 = parseFloat(document.getElementById('volume2').value);
  const noiseVolume = parseFloat(document.getElementById('noiseVolume').value);
  const waveform1 = document.getElementById('waveform1').value;
  const waveform2 = document.getElementById('waveform2').value;
  const xEnv1 = parseFloat(document.getElementById('xenv1').value);
  const xEnv2 = parseFloat(document.getElementById('xenv2').value);

  const osc1 = createOscillator(frequency, 0, 0, volume1, waveform1, xEnv1);
  const osc2 = createOscillator(frequency, detune, semitone, volume2, waveform2, xEnv2);
  const { noiseGain } = createNoise(noiseVolume);

  const now = audioCtx.currentTime;
  triggerADSR(osc1.gain, 'start', now, volume1, osc1);
  triggerADSR(osc2.gain, 'start', now, volume2, osc2);
  triggerADSR(noiseGain, 'start', now, noiseVolume);

  activeOscillators[key] = { osc1, osc2, noiseGain };
  pressedKeys[key] = true;
}

function stopNote(key) {
  const active = activeOscillators[key];
  if (!active) return;

  const now = audioCtx.currentTime;
  triggerADSR(active.osc1.gain, 'stop', now, active.osc1.volume, active.osc1);
  triggerADSR(active.osc2.gain, 'stop', now, active.osc2.volume, active.osc2);
  triggerADSR(active.noiseGain, 'stop', now, active.noiseGain.volume);

  active.osc1.osc.stop(now + parseFloat(document.getElementById('release').value));
  active.osc2.osc.stop(now + parseFloat(document.getElementById('release').value));

  delete activeOscillators[key];
  delete pressedKeys[key];
}

function setupKeyListeners() {
  document.addEventListener('keydown', (event) => {
    if (!pressedKeys[event.key.toUpperCase()]) {
      playNote(event.key.toUpperCase());
    }
  });

  document.addEventListener('keyup', (event) => {
    stopNote(event.key.toUpperCase());
  });
}

function updateVolumeDisplay(sliderId, displayId) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  display.textContent = slider.value;
  slider.addEventListener('input', () => {
    display.textContent = slider.value;
  });
}

document.getElementById('startButton').addEventListener('click', function() {
  initAudio();
  setupKeyListeners();
  updateVolumeDisplay('volume1', 'volume1Value');
  updateVolumeDisplay('volume2', 'volume2Value');
  updateVolumeDisplay('noiseVolume', 'noiseVolumeValue');
  updateVolumeDisplay('xenv1', 'xenv1Value');
  updateVolumeDisplay('xenv2', 'xenv2Value');
  updateVolumeDisplay('semitone', 'semitoneValue');
  updateVolumeDisplay('detune', 'detuneValue');
  updateVolumeDisplay('attack', 'attackValue');
  updateVolumeDisplay('decay', 'decayValue');
  updateVolumeDisplay('sustain', 'sustainValue');
  updateVolumeDisplay('release', 'releaseValue');
  updateVolumeDisplay('distortionAmount', 'distortionAmountValue');
  updateFilterSettings();
  updateDelaySettings();
  updateDistortionSettings();
});

document.querySelectorAll('input[name="filterType"]').forEach(radio => {
  radio.addEventListener('change', updateFilterSettings);
});

document.getElementById('filterFrequency').addEventListener('input', () => {
  document.getElementById('filterFrequencyValue').textContent = document.getElementById('filterFrequency').value;
  updateFilterSettings();
});

document.getElementById('delayTime').addEventListener('input', () => {
  document.getElementById('delayTimeValue').textContent = document.getElementById('delayTime').value;
  updateDelaySettings();
});

document.getElementById('delayDecay').addEventListener('input', () => {
  document.getElementById('delayDecayValue').textContent = document.getElementById('delayDecay').value;
  updateDelaySettings();
});

document.getElementById('distortionAmount').addEventListener('input', () => {
  document.getElementById('distortionAmountValue').textContent = document.getElementById('distortionAmount').value;
  updateDistortionSettings();
});

document.getElementById('volume1').addEventListener('input', initAudio);
document.getElementById('waveform1').addEventListener('change', initAudio);
document.getElementById('volume2').addEventListener('input', initAudio);
document.getElementById('waveform2').addEventListener('change', initAudio);
document.getElementById('noiseVolume').addEventListener('input', initAudio);
document.getElementById('semitone').addEventListener('input', initAudio);
document.getElementById('detune').addEventListener('input', initAudio);
