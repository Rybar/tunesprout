let audioCtx;
const activeOscillators = {};
const pressedKeys = {};
let filter, delay, feedback, distortion, analyser, canvas, canvasCtx;

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
  delay = audioCtx.createDelay(0.5);
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

  // Create compressor node
  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-50, audioCtx.currentTime);
  compressor.knee.setValueAtTime(40, audioCtx.currentTime);
  compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
  compressor.attack.setValueAtTime(0, audioCtx.currentTime);
  compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

  filter.connect(compressor);

  // Create analyser node
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  filter.connect(analyser);
  
  // Setup canvas for visualizer
  canvas = document.getElementById('visualizer');
  canvasCtx = canvas.getContext('2d');
  drawVisualizer();
}

function updateFilterSettings() {
  const filterType = document.querySelector('input[name="filterType"]:checked').value;
  const filterFrequency = document.getElementById('filterFrequency');
  
  if (filterType === 'lowpass' || filterType === 'highpass') {
    filterFrequency.min = 20;
    filterFrequency.max = 20000;
  } else if (filterType === 'bandpass') {
    filterFrequency.min = 100;
    filterFrequency.max = 10000;
  }
  
  filter.type = filterType;
  filter.frequency.setValueAtTime(parseFloat(filterFrequency.value), audioCtx.currentTime);
}

function updateDelaySettings() {
  const delayTime = parseFloat(document.getElementById('delayTime').value);
  const decayAmount = parseFloat(document.getElementById('delayDecay').value);
  
  delay.delayTime.setValueAtTime(delayTime, audioCtx.currentTime);
  feedback.gain.setValueAtTime(decayAmount, audioCtx.currentTime);
}

function makeDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount * 100 : 50;
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

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);

  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  canvasCtx.fillStyle = 'rgb(0, 0, 0)';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = 'rgb(0, 255, 0)';

  canvasCtx.beginPath();
  const sliceWidth = (canvas.width * 1.0) / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;

    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  canvasCtx.lineTo(canvas.width, canvas.height / 2);
  canvasCtx.stroke();
}

function saveSettings() {
  const settings = {
    volume1: document.getElementById('volume1').value,
    waveform1: document.getElementById('waveform1').value,
    xEnv1: document.getElementById('xenv1').value,
    volume2: document.getElementById('volume2').value,
    waveform2: document.getElementById('waveform2').value,
    xEnv2: document.getElementById('xenv2').value,
    noiseVolume: document.getElementById('noiseVolume').value,
    semitone: document.getElementById('semitone').value,
    detune: document.getElementById('detune').value,
    attack: document.getElementById('attack').value,
    decay: document.getElementById('decay').value,
    sustain: document.getElementById('sustain').value,
    release: document.getElementById('release').value,
    filterType: document.querySelector('input[name="filterType"]:checked').value,
    filterFrequency: document.getElementById('filterFrequency').value,
    delayTime: document.getElementById('delayTime').value,
    delayDecay: document.getElementById('delayDecay').value,
    distortionAmount: document.getElementById('distortionAmount').value
  };

  const json = JSON.stringify(settings, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'synth-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadPresets() {
  const presetsDropdown = document.getElementById('presets');
  presetsDropdown.innerHTML = '';

  for (const preset in presets) {
    const option = document.createElement('option');
    option.value = preset;
    option.textContent = preset;
    presetsDropdown.appendChild(option);
  }
}

function applyPreset(preset) {
  const settings = presets[preset];

  document.getElementById('volume1').value = settings.volume1;
  document.getElementById('waveform1').value = settings.waveform1;
  document.getElementById('xenv1').value = settings.xEnv1;
  document.getElementById('volume2').value = settings.volume2;
  document.getElementById('waveform2').value = settings.waveform2;
  document.getElementById('xenv2').value = settings.xEnv2;
  document.getElementById('noiseVolume').value = settings.noiseVolume;
  document.getElementById('semitone').value = settings.semitone;
  document.getElementById('detune').value = settings.detune;
  document.getElementById('attack').value = settings.attack;
  document.getElementById('decay').value = settings.decay;
  document.getElementById('sustain').value = settings.sustain;
  document.getElementById('release').value = settings.release;
  document.querySelector(`input[name="filterType"][value="${settings.filterType}"]`).checked = true;
  document.getElementById('filterFrequency').value = settings.filterFrequency;
  document.getElementById('delayTime').value = settings.delayTime;
  document.getElementById('delayDecay').value = settings.delayDecay;
  document.getElementById('distortionAmount').value = settings.distortionAmount;

  // Update the displayed values
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
  updateVolumeDisplay('filterFrequency', 'filterFrequencyValue');
  updateVolumeDisplay('delayTime', 'delayTimeValue');
  updateVolumeDisplay('delayDecay', 'delayDecayValue');
  updateVolumeDisplay('distortionAmount', 'distortionAmountValue');

  // Re-initialize the audio context with the new settings
  initAudio();
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

document.getElementById('saveButton').addEventListener('click', saveSettings);
document.getElementById('presets').addEventListener('change', function() {
  applyPreset(this.value);
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

// Load presets on page load
window.addEventListener('DOMContentLoaded', () => {
  loadPresets();
  applyPreset('Default'); // Apply the default preset initially
});
