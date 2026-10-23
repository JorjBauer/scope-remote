// Ready-made setups for the things that are hard to remember on the scope.
//
// Each recipe has a few plain questions (params) and builds a list of SCPI
// commands from the answers. "look" says what to look at afterward.
// Only two channels on the DS1202Z-E, so two-wire buses use both.

import { ceil125 } from './util.js';

const CHAN = { key: 'ch', label: 'Probe on', type: 'select', options: [['1', 'CH1'], ['2', 'CH2']], dflt: '1' };
const LOGIC = {
  key: 'v', label: 'Logic level', type: 'select', dflt: '3.3',
  options: [['1.8', '1.8 V'], ['2.5', '2.5 V'], ['3.3', '3.3 V'], ['5', '5 V'], ['12', '12 V']],
};
const tbOptions = (list) => list.map(([v, l]) => [String(v), l]);

// Volts/div so that a signal of v volts fills about 'divs' squares.
function scaleFor(v, divs = 5) {
  return ceil125(Math.abs(v) / divs);
}

// Basic channel setup. Probe ratio first: it changes what scales are legal.
function chan(n, probe, { scale, offset = 0, coup = 'DC', bwl = 'OFF' }) {
  return [
    `:CHANnel${n}:DISPlay 1`,
    `:CHANnel${n}:PROBe ${probe}`,
    `:CHANnel${n}:COUPling ${coup}`,
    `:CHANnel${n}:BWLimit ${bwl}`,
    `:CHANnel${n}:VERNier 0`,
    `:CHANnel${n}:INVert 0`,
    `:CHANnel${n}:SCALe ${scale}`,
    `:CHANnel${n}:OFFSet ${+offset.toPrecision(4)}`,
  ];
}

// Put a v-volt logic signal on one channel with 0 V near the bottom.
function logicChan(n, probe, v) {
  const scale = scaleFor(v, 5);
  return chan(n, probe, { scale, offset: -3 * scale });
}

// Two logic channels stacked: top half and bottom half of the screen.
function stacked(probe, v) {
  const scale = scaleFor(v, 3);
  return [
    ...chan(1, probe, { scale, offset: 0.5 * scale }),
    ...chan(2, probe, { scale, offset: -3.5 * scale }),
  ];
}

function timebase(scale, offset = 0) {
  return [':TIMebase:MODE MAIN', ':TIMebase:DELay:ENABle 0', `:TIMebase:MAIN:SCALe ${scale}`, `:TIMebase:MAIN:OFFSet ${+offset.toPrecision(4)}`];
}

function edge(n, level, slope = 'POSitive', sweep = 'AUTO') {
  return [
    ':TRIGger:MODE EDGE',
    `:TRIGger:EDGe:SOURce CHANnel${n}`,
    `:TRIGger:EDGe:SLOPe ${slope}`,
    `:TRIGger:EDGe:LEVel ${+level.toPrecision(4)}`,
    ':TRIGger:COUPling DC',
    `:TRIGger:SWEep ${sweep}`,
  ];
}

function measures(list) {
  return [':MEASure:CLEar ALL', ...list.map((m) => `:MEASure:ITEM ${m}`)];
}

const plain = [':MATH:DISPlay 0', ':DECoder1:DISPlay 0', ':DECoder2:DISPlay 0', ':CURSor:MODE OFF', ':ACQuire:TYPE NORMal', ':DISPlay:GRADing:TIME MIN'];
const other = (n) => (n === '1' ? 2 : 1);

export const RECIPES = [
  {
    id: 'auto',
    group: 'Start here',
    title: 'Just show me the signal',
    summary: 'Let the scope pick volts, time and trigger for whatever is connected, then show frequency and peak-to-peak.',
    params: [],
    build: () => [':AUToscale', '@wait 2000', ...measures(['FREQuency,CHANnel1', 'VPP,CHANnel1', 'FREQuency,CHANnel2', 'VPP,CHANnel2'])],
    look: 'If nothing shows up, the signal may be too small or too slow for AUTO. Try "Measure a logic signal" or "Slow signal (roll mode)".',
  },
  {
    id: 'clean',
    group: 'Start here',
    title: 'Clean slate (keep probes)',
    summary: 'Turn off math, decoders, cursors, persistence, averaging and measurements without a full factory reset.',
    params: [],
    build: () => [...plain, ':MEASure:CLEar ALL', ':REFerence:DISPlay 0', ':TIMebase:MODE MAIN', ':TIMebase:DELay:ENABle 0', ':TRIGger:MODE EDGE', ':TRIGger:SWEep AUTO', ':RUN'],
    look: 'Your channel scales and probe settings are left alone.',
  },
  {
    id: 'reset',
    group: 'Start here',
    title: 'Factory default',
    summary: 'Same as the Default button: everything back to how it shipped. Probe settings go back to 10x.',
    params: [],
    confirm: 'Reset every setting on the scope to factory default?',
    build: () => ['*RST', '@wait 2500'],
    look: 'CH1 on at 1 V/div, 1 µs/div, edge trigger on CH1.',
  },
  {
    id: 'probecomp',
    group: 'Start here',
    title: 'Check probe compensation',
    summary: 'Hook the probe tip to the scope\'s square-wave test tab (and ground clip to the ground tab), then tune the probe.',
    params: [CHAN],
    build: (p, c) => [...plain, ...chan(p.ch, 10, { scale: 1, offset: -1.5 }), ...timebase(500e-6), ...edge(p.ch, 1.5), ...measures([`FREQuency,CHANnel${p.ch}`, `VPP,CHANnel${p.ch}`]), ':RUN'],
    look: 'Probe switch on 10x. The corners of the square wave should be flat and sharp. Rounded = turn the small screw on the probe one way; spiky = the other way.',
  },

  {
    id: 'logic',
    group: 'Everyday measuring',
    title: 'Measure a logic signal',
    summary: 'A digital pin (clock, PWM, GPIO): sensible volts/div, stable trigger halfway up, frequency and duty cycle.',
    params: [CHAN, LOGIC, {
      key: 'tb', label: 'Roughly how fast', type: 'select', dflt: '0.0002',
      options: tbOptions([[0.02, '~10 Hz'], [0.002, '~100 Hz'], [0.0002, '~1 kHz'], [0.00002, '~10 kHz'], [0.000002, '~100 kHz'], [0.0000002, '~1 MHz'], [0.00000002, '~10 MHz']]),
    }],
    build: (p, c) => {
      const v = +p.v;
      return [...plain, ...logicChan(p.ch, c.probe, v), ...timebase(+p.tb), ...edge(p.ch, v / 2),
        ...measures([`FREQuency,CHANnel${p.ch}`, `PDUTy,CHANnel${p.ch}`, `VMAX,CHANnel${p.ch}`, `VMIN,CHANnel${p.ch}`, `RTIMe,CHANnel${p.ch}`]), ':RUN'];
    },
    look: 'Frequency and duty cycle appear at the bottom of the scope screen and in the strip below the screen here. If the trace jitters sideways, nudge the trigger level.',
  },
  {
    id: 'pwm',
    group: 'Everyday measuring',
    title: 'PWM / servo pulse',
    summary: 'Frequency, duty cycle and high-time of a PWM output, with about three cycles on screen.',
    params: [CHAN, LOGIC, { key: 'f', label: 'PWM frequency', type: 'number', unit: 'Hz', dflt: '50' }],
    build: (p, c) => {
      const v = +p.v;
      const f = +p.f || 50;
      return [...plain, ...logicChan(p.ch, c.probe, v), ...timebase(ceil125(0.25 / f)), ...edge(p.ch, v / 2),
        ...measures([`FREQuency,CHANnel${p.ch}`, `PDUTy,CHANnel${p.ch}`, `PWIDth,CHANnel${p.ch}`, `VMAX,CHANnel${p.ch}`]), ':RUN'];
    },
    look: 'Hobby servos: 50 Hz, high time 1 ms to 2 ms (1.5 ms = center).',
  },
  {
    id: 'analog',
    group: 'Everyday measuring',
    title: 'Audio / analog waveform',
    summary: 'AC-coupled view of a waveform centered on screen, with peak-to-peak, RMS and frequency.',
    params: [CHAN,
      { key: 'amp', label: 'Roughly how big (peak-to-peak)', type: 'select', dflt: '1', options: [['0.05', '50 mV'], ['0.2', '200 mV'], ['1', '1 V'], ['5', '5 V'], ['20', '20 V']] },
      { key: 'tb', label: 'Frequency', type: 'select', dflt: '0.0005', options: tbOptions([[0.005, '~50 Hz'], [0.0005, '~1 kHz'], [0.00005, '~10 kHz'], [0.000005, '~100 kHz']]) },
    ],
    build: (p, c) => [...plain, ...chan(p.ch, c.probe, { scale: scaleFor(+p.amp, 4), coup: 'AC' }), ...timebase(+p.tb), ...edge(p.ch, 0),
      ...measures([`VPP,CHANnel${p.ch}`, `VRMS,CHANnel${p.ch}`, `FREQuency,CHANnel${p.ch}`]), ':RUN'],
    look: 'AC coupling hides any DC level. Switch the channel to DC (CH menu) if you need it.',
  },
  {
    id: 'two',
    group: 'Everyday measuring',
    title: 'Compare two signals (delay and phase)',
    summary: 'Both channels on, auto-scaled, with the delay and phase from CH1 to CH2.',
    params: [],
    build: () => [...plain, ':CHANnel1:DISPlay 1', ':CHANnel2:DISPlay 1', ':AUToscale', '@wait 2000',
      ...measures(['FREQuency,CHANnel1', 'FREQuency,CHANnel2', 'RDELay,CHANnel1,CHANnel2', 'RPHase,CHANnel1,CHANnel2', 'VPP,CHANnel2'])],
    look: 'Delay is from a rising edge on CH1 to the next rising edge on CH2. Positive phase means CH2 lags.',
  },
  {
    id: 'rise',
    group: 'Everyday measuring',
    title: 'Rise and fall time',
    summary: 'Fast time scale, other channel off for the full 1 GSa/s, rise/fall time and overshoot.',
    params: [CHAN, LOGIC, {
      key: 'tb', label: 'Time per division', type: 'select', dflt: '0.00000001',
      options: tbOptions([[5e-9, '5 ns'], [1e-8, '10 ns'], [5e-8, '50 ns'], [2e-7, '200 ns'], [1e-6, '1 µs']]),
    }],
    build: (p, c) => {
      const v = +p.v;
      return [...plain, `:CHANnel${other(p.ch)}:DISPlay 0`, ...logicChan(p.ch, c.probe, v), ':ACQuire:MDEPth AUTO', ...timebase(+p.tb), ...edge(p.ch, v / 2, 'POSitive', 'NORMal'),
        ...measures([`RTIMe,CHANnel${p.ch}`, `FTIMe,CHANnel${p.ch}`, `OVERshoot,CHANnel${p.ch}`, `PREShoot,CHANnel${p.ch}`]), ':RUN'];
    },
    look: 'Use the short ground spring, not the long clip, or you measure the ground lead. Readings below about 5 ns are limited by this 200 MHz scope.',
  },

  {
    id: 'ripple',
    group: 'Power supplies',
    title: 'Power rail ripple and noise',
    summary: 'AC coupling, 20 MHz bandwidth limit and a sensitive scale, to see the wiggle on a DC rail.',
    params: [CHAN, {
      key: 'src', label: 'What kind of supply', type: 'select', dflt: 'smps',
      options: [['smps', 'Switching regulator / buck / boost'], ['mains', 'Transformer + rectifier (mains hum)']],
    }],
    build: (p, c) => {
      const scale = c.probe >= 10 ? 0.01 : 0.005;
      const tb = p.src === 'mains' ? 0.005 : 0.000002;
      return [...plain, ...chan(p.ch, c.probe, { scale, coup: 'AC', bwl: '20M' }), ...timebase(tb), ...edge(p.ch, 0),
        ...measures([`VPP,CHANnel${p.ch}`, `VRMS,CHANnel${p.ch}`, `FREQuency,CHANnel${p.ch}`]), ':RUN'];
    },
    look: 'Peak-to-peak is the ripple number. Use the probe\'s ground spring right at the capacitor; a long ground clip picks up switching noise and makes ripple look worse. 1x probe setting shows small ripple better.',
  },
  {
    id: 'startup',
    group: 'Power supplies',
    title: 'Power-up (catch the rail turning on)',
    summary: 'Arms a single capture that fires as the rail rises, so you see the startup ramp and any overshoot.',
    params: [CHAN,
      { key: 'v', label: 'Rail voltage', type: 'number', unit: 'V', dflt: '3.3' },
      { key: 'tb', label: 'Time per division', type: 'select', dflt: '0.001', options: tbOptions([[1e-4, '100 µs'], [1e-3, '1 ms'], [1e-2, '10 ms'], [1e-1, '100 ms']]) },
    ],
    build: (p, c) => {
      const v = +p.v || 3.3;
      const tb = +p.tb;
      return [...plain, ...logicChan(p.ch, c.probe, v), ...timebase(tb, 4 * tb), ...edge(p.ch, v / 2, 'POSitive', 'SINGle'),
        ...measures([`RTIMe,CHANnel${p.ch}`, `VMAX,CHANnel${p.ch}`, `OVERshoot,CHANnel${p.ch}`]), ':SINGle'];
    },
    look: 'The scope shows WAIT. Now switch the board on. To try again press SINGLE.',
  },

  {
    id: 'single',
    group: 'Catching events',
    title: 'Catch a one-time event',
    summary: 'Wait for a signal to cross a voltage, capture once, and freeze it on screen.',
    params: [CHAN, LOGIC,
      { key: 'slope', label: 'Catch when it', type: 'select', dflt: 'POSitive', options: [['POSitive', 'goes up'], ['NEGative', 'goes down'], ['RFALl', 'changes either way']] },
      { key: 'tb', label: 'Time per division', type: 'select', dflt: '0.0001', options: tbOptions([[1e-6, '1 µs'], [1e-5, '10 µs'], [1e-4, '100 µs'], [1e-3, '1 ms'], [1e-2, '10 ms'], [1e-1, '100 ms']]) },
      { key: 'pos', label: 'Show mostly', type: 'select', dflt: 'after', options: [['after', 'what happens after'], ['center', 'before and after equally'], ['before', 'what led up to it']] },
    ],
    build: (p, c) => {
      const v = +p.v;
      const tb = +p.tb;
      const off = p.pos === 'after' ? 4 * tb : p.pos === 'before' ? -4 * tb : 0;
      return [...plain, ...logicChan(p.ch, c.probe, v), ...timebase(tb, off), ...edge(p.ch, v / 2, p.slope, 'SINGle'), ':SINGle'];
    },
    look: 'Status shows WAIT until it happens, then STOP with the capture frozen. Press SINGLE to arm again.',
  },
  {
    id: 'glitch',
    group: 'Catching events',
    title: 'Hunt for glitches',
    summary: 'Only trigger on pulses shorter than normal, with peak detect and infinite persistence so even rare spikes stay on screen.',
    params: [CHAN, LOGIC,
      { key: 'w', label: 'Pulses shorter than this are glitches', type: 'number', unit: 's', dflt: '100n' },
    ],
    build: (p, c) => {
      const v = +p.v;
      const w = Math.max(8e-9, +p.w || 1e-7);
      return [...plain, ...logicChan(p.ch, c.probe, v), ...timebase(ceil125(w * 2)), ':ACQuire:TYPE PEAK', ':DISPlay:GRADing:TIME INFinite',
        ':TRIGger:MODE PULSe', `:TRIGger:PULSe:SOURce CHANnel${p.ch}`, ':TRIGger:PULSe:WHEN PLESs', `:TRIGger:PULSe:WIDTh ${w}`,
        `:TRIGger:PULSe:LEVel ${v / 2}`, ':TRIGger:SWEep NORMal', ':CLEar', ':RUN'];
    },
    look: 'Leave it running. Anything that appears is a pulse shorter than your limit. CLEAR wipes the persistence. Run "Clean slate" afterward to put the trigger back to normal.',
  },
  {
    id: 'roll',
    group: 'Catching events',
    title: 'Slow signal (roll mode)',
    summary: 'Scrolls like a chart recorder. For sensors, batteries, anything that changes over seconds.',
    params: [CHAN,
      { key: 'v', label: 'Highest voltage expected', type: 'number', unit: 'V', dflt: '5' },
      { key: 'tb', label: 'Time per division', type: 'select', dflt: '1', options: tbOptions([[0.2, '200 ms'], [0.5, '500 ms'], [1, '1 s'], [5, '5 s'], [10, '10 s'], [50, '50 s']]) },
    ],
    build: (p, c) => [...plain, ...logicChan(p.ch, c.probe, +p.v || 5), ':TIMebase:MODE ROLL', `:TIMebase:MAIN:SCALe ${p.tb}`, ':RUN'],
    look: 'Press RUN/STOP to freeze. Run "Clean slate" to leave roll mode.',
  },
  {
    id: 'avg',
    group: 'Catching events',
    title: 'Noisy repeating signal (averaging)',
    summary: 'Average many captures so random noise melts away and the real waveform shows.',
    params: [{ key: 'n', label: 'Captures to average', type: 'select', dflt: '64', options: [['16', '16 (responds fast)'], ['64', '64'], ['256', '256 (very smooth)']] }],
    build: (p) => [':ACQuire:TYPE AVERages', `:ACQuire:AVERages ${p.n}`, ':TRIGger:SWEep NORMal', ':RUN'],
    look: 'Needs a stable trigger, otherwise the average smears into nothing. Set Acquire back to Normal when done.',
  },

  {
    id: 'uart',
    group: 'Decode a bus',
    title: 'Decode UART / serial',
    summary: 'Shows the bytes on a TX (or RX) line as text or hex, triggered on the start of a byte.',
    params: [CHAN, LOGIC,
      { key: 'baud', label: 'Baud rate', type: 'select', dflt: '115200', options: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000].map((b) => [String(b), String(b)]) },
      { key: 'fmt', label: 'Show bytes as', type: 'select', dflt: 'ASCii', options: [['ASCii', 'Text'], ['HEX', 'Hex']] },
      { key: 'frame', label: 'Frame', type: 'select', dflt: '8N1', options: [['8N1', '8N1 (almost everything)'], ['8E1', '8E1'], ['8O1', '8O1'], ['7E1', '7E1'], ['8N2', '8N2']] },
    ],
    build: (p, c) => {
      const v = +p.v;
      const baud = +p.baud;
      const bits = p.frame[0];
      const parity = { N: 'NONE', E: 'EVEN', O: 'ODD' }[p.frame[1]];
      const stop = p.frame[2];
      // About ten characters across the screen.
      const tb = ceil125(8.3 / baud);
      return [...plain, ...logicChan(p.ch, c.probe, v), ...timebase(tb, 4 * tb),
        ':DECoder1:MODE UART', `:DECoder1:UART:TX CHANnel${p.ch}`, ':DECoder1:UART:RX OFF', `:DECoder1:UART:BAUD ${baud}`,
        `:DECoder1:UART:WIDTh ${bits}`, `:DECoder1:UART:PARity ${parity}`, `:DECoder1:UART:STOP ${stop}`,
        ':DECoder1:UART:POLarity POSitive', ':DECoder1:UART:ENDian LSB', ':DECoder1:THREshold:AUTO 1',
        `:DECoder1:FORMat ${p.fmt}`, ':DECoder1:DISPlay 1',
        ':TRIGger:MODE RS232', `:TRIGger:RS232:SOURce CHANnel${p.ch}`, ':TRIGger:RS232:WHEN STARt', `:TRIGger:RS232:BAUD ${baud}`,
        `:TRIGger:RS232:LEVel ${v / 2}`, ':TRIGger:SWEep NORMal', ':RUN'];
    },
    look: 'Decoded bytes appear in a bar under the trace. Press SINGLE to freeze one burst. Garbled? The baud rate or frame is wrong, or you are on an inverted RS232 line (Decode menu: idle level).',
  },
  {
    id: 'i2c',
    group: 'Decode a bus',
    title: 'Decode I2C',
    summary: 'SCL on CH1, SDA on CH2. Shows addresses and data, triggered on each START.',
    params: [LOGIC, { key: 'f', label: 'Bus speed', type: 'select', dflt: '100000', options: [['100000', '100 kHz (standard)'], ['400000', '400 kHz (fast)'], ['1000000', '1 MHz (fast plus)']] }],
    build: (p, c) => {
      const v = +p.v;
      const tb = ceil125(2.5 / +p.f);
      return [...plain, ...stacked(c.probe, v), ...timebase(tb, 4 * tb),
        ':DECoder1:MODE IIC', ':DECoder1:IIC:CLK CHANnel1', ':DECoder1:IIC:DATA CHANnel2', ':DECoder1:IIC:ADDRess NORMal',
        ':DECoder1:THREshold:AUTO 1', ':DECoder1:FORMat HEX', ':DECoder1:DISPlay 1',
        ':TRIGger:MODE IIC', ':TRIGger:IIC:SCL CHANnel1', ':TRIGger:IIC:SDA CHANnel2', ':TRIGger:IIC:WHEN STARt',
        `:TRIGger:IIC:CLEVel ${v / 2}`, `:TRIGger:IIC:DLEVel ${v / 2}`, ':TRIGger:SWEep NORMal', ':RUN'];
    },
    look: 'Each address shows with its read/write direction. Nothing decodes? Check that SCL really is on CH1, and that the bus has pull-ups. Zoom out the time knob to see a whole transaction.',
  },
  {
    id: 'spi',
    group: 'Decode a bus',
    title: 'Decode SPI (clock + one data line)',
    summary: 'Clock on CH1, MOSI or MISO on CH2. With two channels there is no CS wire, so words are framed by idle gaps.',
    params: [LOGIC,
      { key: 'f', label: 'SPI clock', type: 'select', dflt: '1000000', options: [['100000', '100 kHz'], ['1000000', '1 MHz'], ['4000000', '4 MHz'], ['10000000', '10 MHz']] },
      { key: 'mode', label: 'SPI mode', type: 'select', dflt: '0', options: [['0', 'Mode 0 (most common)'], ['1', 'Mode 1'], ['2', 'Mode 2'], ['3', 'Mode 3']] },
      { key: 'w', label: 'Bits per word', type: 'select', dflt: '8', options: [['8', '8'], ['16', '16'], ['32', '32']] },
    ],
    build: (p, c) => {
      const v = +p.v;
      const f = +p.f;
      const tb = ceil125(2.7 / f);
      // Idle gap longer than a few clocks means "new word".
      const tmo = Math.max(1e-7, 4 / f);
      // Modes 0 and 3 sample on the rising edge, 1 and 2 on the falling edge.
      const edgeSel = p.mode === '0' || p.mode === '3' ? 'RISE' : 'FALL';
      return [...plain, ...stacked(c.probe, v), ...timebase(tb, 4 * tb),
        ':DECoder1:MODE SPI', ':DECoder1:SPI:CLK CHANnel1', ':DECoder1:SPI:MOSI CHANnel2', ':DECoder1:SPI:MISO OFF',
        ':DECoder1:SPI:MODE TIMeout', `:DECoder1:SPI:TIMeout ${+tmo.toPrecision(3)}`, `:DECoder1:SPI:EDGE ${edgeSel}`,
        ':DECoder1:SPI:POLarity POSitive', `:DECoder1:SPI:WIDTh ${p.w}`, ':DECoder1:SPI:ENDian MSB',
        ':DECoder1:THREshold:AUTO 1', ':DECoder1:FORMat HEX', ':DECoder1:DISPlay 1',
        ...edge(1, v / 2, edgeSel === 'RISE' ? 'POSitive' : 'NEGative', 'NORMal'), `:TRIGger:HOLDoff ${+(tb * 12).toPrecision(3)}`, ':RUN'];
    },
    look: 'Press SINGLE to freeze a burst. If words look shifted, the idle timeout is wrong for your bus; change it in the Decode menu.',
  },

  {
    id: 'fft',
    group: 'Analysis',
    title: 'Frequency spectrum (FFT)',
    summary: 'Show which frequencies are in a signal: harmonics, switching noise, hum.',
    params: [CHAN, { key: 'win', label: 'Window', type: 'select', dflt: 'HANNing', options: [['HANNing', 'Hanning (good default)'], ['FLATtop', 'Flat top (accurate levels)'], ['RECTangle', 'Rectangle (transients)']] }],
    build: (p) => [':MATH:DISPlay 1', ':MATH:OPERator FFT', `:MATH:FFT:SOURce CHANnel${p.ch}`, `:MATH:FFT:WINDow ${p.win}`, ':MATH:FFT:UNIT DB', ':MATH:FFT:SPLit 1', ':RUN'],
    look: 'Bottom half is the spectrum. A slower time/div gives finer frequency detail; a faster one shows higher frequencies. Turn off in the MATH menu.',
  },
  {
    id: 'xy',
    group: 'Analysis',
    title: 'X-Y mode',
    summary: 'Plot CH1 against CH2 (Lissajous figures, component curve tracing).',
    params: [],
    build: () => [':CHANnel1:DISPlay 1', ':CHANnel2:DISPlay 1', ':TIMebase:MODE XY', ':RUN'],
    look: 'Run "Clean slate" or set Horizontal mode back to Normal when done.',
  },
];
