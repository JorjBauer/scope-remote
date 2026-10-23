// One "sheet" per front-panel menu button. Each sheet lists the same
// settings the scope's soft-key menu offers, with a plain explanation, and
// the SCPI used to read and write it.
//
// Item kinds:
//   select  options: [[value, label], ...]
//   toggle  on/off
//   number  free entry with SI prefixes ("10m", "2.5k")
//   slider  integer range
//   readout read-only value
//   action  a button; run(ctx) does the work
//   note    explanatory text
// showIf(values) hides an item unless the sheet's current values match.

const CH = [['CHANnel1', 'CH1'], ['CHANnel2', 'CH2']];
const CH_MATH = [...CH, ['MATH', 'Math']];
const ONOFF = [['1', 'On'], ['0', 'Off']];

// cmd null = a choice kept in the app only (never sent to the scope).
const sel = (key, label, cmd, options, extra = {}) => ({
  kind: 'select', key, label, options, ...(cmd ? { get: `${cmd}?`, set: (v) => `${cmd} ${v}` } : {}), ...extra,
});
const tog = (key, label, cmd, extra = {}) => ({
  kind: 'toggle', key, label, get: `${cmd}?`, set: (v) => `${cmd} ${v ? 1 : 0}`, ...extra,
});
const num = (key, label, cmd, unit, extra = {}) => ({
  kind: 'number', key, label, get: `${cmd}?`, set: (v) => `${cmd} ${v}`, unit, ...extra,
});
const ro = (key, label, cmd, unit = '', extra = {}) => ({ kind: 'readout', key, label, get: cmd, unit, ...extra });
const act = (label, run, extra = {}) => ({ kind: 'action', label, run, ...extra });
const note = (text) => ({ kind: 'note', text });

function channelSheet(n, color) {
  const c = `:CHANnel${n}`;
  return {
    id: `ch${n}`,
    title: `Channel ${n}`,
    color,
    intro: `Settings for the probe plugged into CH${n}.`,
    items: [
      tog('disp', 'Show this channel', `${c}:DISPlay`),
      sel('coup', 'Coupling', `${c}:COUPling`, [['DC', 'DC: show everything'], ['AC', 'AC: hide the DC level'], ['GND', 'GND: flat line at 0 V']], {
        help: 'Use AC to look at small ripple riding on a big DC voltage. Use DC for logic signals and anything where the actual voltage matters.',
      }),
      sel('probe', 'Probe setting', `${c}:PROBe`, [['1', '1x'], ['10', '10x'], ['100', '100x'], ['0.1', '0.1x'], ['1000', '1000x']], {
        help: 'Must match the switch on the probe body, or every voltage reads 10 times wrong.',
      }),
      num('scale', 'Volts per division', `${c}:SCALe`, 'V/div', { help: 'Each grid square is this many volts tall. 8 squares fill the screen.' }),
      num('offset', 'Vertical position (offset)', `${c}:OFFSet`, 'V', { help: 'Slides the trace up or down. 0 puts 0 V on the center line.' }),
      sel('bwl', 'Bandwidth limit', `${c}:BWLimit`, [['OFF', 'Off (full 200 MHz)'], ['20M', '20 MHz (less noise)']], {
        help: 'Turn on to cut high-frequency fuzz, for example when measuring power-supply ripple.',
      }),
      tog('inv', 'Invert (flip upside down)', `${c}:INVert`),
      tog('vern', 'Fine scale steps', `${c}:VERNier`, { help: 'Off: the scale knob jumps 1-2-5. On: it moves in small steps.' }),
      sel('units', 'Units', `${c}:UNITs`, [['VOLTage', 'Volts'], ['AMPere', 'Amps (current probe)'], ['WATT', 'Watts'], ['UNKNown', 'Unknown']]),
    ],
  };
}

export const SHEETS = {
  ch1: channelSheet(1, 'var(--ch1)'),
  ch2: channelSheet(2, 'var(--ch2)'),

  math: {
    id: 'math',
    title: 'Math',
    color: 'var(--math)',
    intro: 'Combine channels (CH1 minus CH2, and so on) or view a frequency spectrum (FFT).',
    items: [
      tog('disp', 'Show math trace', ':MATH:DISPlay'),
      sel('op', 'Operation', ':MATH:OPERator', [
        ['ADD', 'A + B'], ['SUBTract', 'A - B'], ['MULTiply', 'A x B'], ['DIVision', 'A / B'],
        ['FFT', 'FFT (frequency spectrum)'], ['AND', 'A AND B'], ['OR', 'A OR B'], ['XOR', 'A XOR B'], ['NOT', 'NOT A'],
        ['INTG', 'Integrate'], ['DIFF', 'Differentiate'], ['SQRT', 'Square root'], ['LOG', 'log10'], ['LN', 'ln'],
        ['EXP', 'exp'], ['ABS', 'Absolute value'], ['FILTer', 'Filter'],
      ]),
      sel('srca', 'Source A', ':MATH:SOURce1', CH, { showIf: (v) => !/^FFT/.test(v.op) }),
      sel('srcb', 'Source B', ':MATH:SOURce2', CH, { showIf: (v) => /^(ADD|SUBT|MULT|DIV|AND|OR|XOR)/.test(v.op) }),
      sel('fftsrc', 'FFT source', ':MATH:FFT:SOURce', CH, { showIf: (v) => /^FFT/.test(v.op) }),
      sel('fftwin', 'FFT window', ':MATH:FFT:WINDow', [['RECTangle', 'Rectangle'], ['HANNing', 'Hanning (good default)'], ['HAMMing', 'Hamming'], ['BLACkman', 'Blackman'], ['FLATtop', 'Flat top (accurate amplitude)'], ['TRIangle', 'Triangle']], { showIf: (v) => /^FFT/.test(v.op) }),
      sel('fftunit', 'FFT units', ':MATH:FFT:UNIT', [['DB', 'dB'], ['VRMS', 'Vrms']], { showIf: (v) => /^FFT/.test(v.op) }),
      tog('fftsplit', 'Split screen', ':MATH:FFT:SPLit', { showIf: (v) => /^FFT/.test(v.op) }),
      num('ffthscale', 'FFT span per division', ':MATH:FFT:HSCale', 'Hz', { showIf: (v) => /^FFT/.test(v.op) }),
      num('ffthcenter', 'FFT center frequency', ':MATH:FFT:HCENter', 'Hz', { showIf: (v) => /^FFT/.test(v.op) }),
      num('scale', 'Math scale', ':MATH:SCALe', '/div'),
      num('offset', 'Math offset', ':MATH:OFFSet', ''),
      tog('inv', 'Invert', ':MATH:INVert'),
      act('Reset math scale', () => [':MATH:RESet']),
    ],
  },

  ref: {
    id: 'ref',
    title: 'Reference',
    color: 'var(--ref)',
    intro: 'Freeze a copy of a trace on screen so you can compare a later signal against it.',
    items: [
      tog('disp', 'Show reference traces', ':REFerence:DISPlay'),
      sel('src', 'Copy from', ':REFerence1:SOURce', CH_MATH),
      act('Save current trace as Ref 1', () => [':REFerence:DISPlay 1', ':REFerence1:ENABle 1', ':REFerence1:SAVe']),
      tog('en1', 'Ref 1 visible', ':REFerence1:ENABle'),
      act('Clear Ref 1', () => [':REFerence1:RESet']),
    ],
  },

  decode: {
    id: 'decode',
    title: 'Decode',
    color: 'var(--decode)',
    intro: 'Turn a serial signal into readable bytes on screen (UART, I2C, SPI). The Shortcuts drawer has ready-made setups for each.',
    items: [
      sel('n', 'Decoder', null, [['1', 'Decoder 1'], ['2', 'Decoder 2']], { local: true, dflt: '1' }),
      ...decoderItems(1, (v) => v.n !== '2'),
      ...decoderItems(2, (v) => v.n === '2'),
    ],
  },

  horiz: {
    id: 'horiz',
    title: 'Horizontal',
    color: 'var(--accent)',
    intro: 'Time across the screen. 12 divisions wide.',
    items: [
      sel('mode', 'Mode', ':TIMebase:MODE', [['MAIN', 'Normal (Y-T)'], ['ROLL', 'Roll (slow chart recorder)'], ['XY', 'X-Y (CH1 vs CH2)']], {
        help: 'Roll scrolls the trace like a chart recorder; only works at 200 ms/div or slower.',
      }),
      num('scale', 'Time per division', ':TIMebase:MAIN:SCALe', 's/div'),
      num('offset', 'Horizontal position', ':TIMebase:MAIN:OFFSet', 's', { help: 'Moves the trigger point left or right. 0 puts it in the center.' }),
      tog('delay', 'Zoom window (delayed sweep)', ':TIMebase:DELay:ENABle', { help: 'Splits the screen: the bottom half shows a magnified part of the top half.' }),
      num('dscale', 'Zoom time per division', ':TIMebase:DELay:SCALe', 's/div', { showIf: (v) => v.delay === true }),
      num('doffset', 'Zoom position', ':TIMebase:DELay:OFFSet', 's', { showIf: (v) => v.delay === true }),
    ],
  },

  trigger: {
    id: 'trigger',
    title: 'Trigger',
    color: 'var(--trig)',
    intro: 'The trigger decides when the scope starts drawing, so a repeating signal stands still.',
    items: [
      sel('sweep', 'When to draw', ':TRIGger:SWEep', [['AUTO', 'Auto: always draw something'], ['NORMal', 'Normal: only on a trigger'], ['SINGle', 'Single: capture once, then stop']]),
      sel('mode', 'Trigger type', ':TRIGger:MODE', [
        ['EDGE', 'Edge (most common)'], ['PULSe', 'Pulse width'], ['RUNT', 'Runt'], ['WIND', 'Window'], ['NEDG', 'Nth edge'],
        ['SLOPe', 'Slope'], ['VIDeo', 'Video'], ['PATTern', 'Pattern'], ['DELay', 'Delay'], ['TIMeout', 'Timeout'],
        ['DURation', 'Duration'], ['SHOLd', 'Setup/hold'], ['RS232', 'UART / RS232'], ['IIC', 'I2C'], ['SPI', 'SPI'],
      ]),
      sel('esrc', 'Source', ':TRIGger:EDGe:SOURce', [...CH, ['AC', 'AC line']], { showIf: (v) => v.mode === 'EDGE' }),
      sel('eslope', 'Edge', ':TRIGger:EDGe:SLOPe', [['POSitive', 'Rising'], ['NEGative', 'Falling'], ['RFALl', 'Either']], { showIf: (v) => v.mode === 'EDGE' }),
      num('elevel', 'Level', ':TRIGger:EDGe:LEVel', 'V', { showIf: (v) => v.mode === 'EDGE', help: 'The voltage the signal has to cross. Set it about halfway up the signal.' }),
      sel('coup', 'Trigger coupling', ':TRIGger:COUPling', [['DC', 'DC'], ['AC', 'AC'], ['LFReject', 'Reject low freq'], ['HFReject', 'Reject high freq']], { showIf: (v) => v.mode === 'EDGE' }),

      sel('psrc', 'Source', ':TRIGger:PULSe:SOURce', CH, { showIf: (v) => v.mode === 'PULS' }),
      sel('pwhen', 'Trigger when', ':TRIGger:PULSe:WHEN', [['PGReater', 'High pulse longer than'], ['PLESs', 'High pulse shorter than'], ['NGReater', 'Low pulse longer than'], ['NLESs', 'Low pulse shorter than']], { showIf: (v) => v.mode === 'PULS' }),
      num('pwidth', 'Width', ':TRIGger:PULSe:WIDTh', 's', { showIf: (v) => v.mode === 'PULS' }),
      num('plevel', 'Level', ':TRIGger:PULSe:LEVel', 'V', { showIf: (v) => v.mode === 'PULS' }),

      sel('usrc', 'Source', ':TRIGger:RS232:SOURce', CH, { showIf: (v) => v.mode === 'RS232' }),
      sel('uwhen', 'Trigger on', ':TRIGger:RS232:WHEN', [['STARt', 'Start of a byte'], ['DATA', 'A specific byte'], ['ERRor', 'Framing error'], ['PARity', 'Parity error']], { showIf: (v) => v.mode === 'RS232' }),
      num('udata', 'Byte value', ':TRIGger:RS232:DATA', '', { showIf: (v) => v.mode === 'RS232' && v.uwhen === 'DATA' }),
      sel('ubaud', 'Baud rate', ':TRIGger:RS232:BAUD', [2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000].map((b) => [String(b), String(b)]).concat([['USER', 'Other...']]), { showIf: (v) => v.mode === 'RS232' }),
      num('ubuser', 'Other baud rate', ':TRIGger:RS232:BUSer', 'bps', { showIf: (v) => v.mode === 'RS232' && v.ubaud === 'USER' }),
      num('ulevel', 'Level', ':TRIGger:RS232:LEVel', 'V', { showIf: (v) => v.mode === 'RS232' }),

      sel('iscl', 'SCL (clock)', ':TRIGger:IIC:SCL', CH, { showIf: (v) => v.mode === 'IIC' }),
      sel('isda', 'SDA (data)', ':TRIGger:IIC:SDA', CH, { showIf: (v) => v.mode === 'IIC' }),
      sel('iwhen', 'Trigger on', ':TRIGger:IIC:WHEN', [['STARt', 'Start'], ['RESTart', 'Restart'], ['STOP', 'Stop'], ['NACKnowledge', 'Missing ACK'], ['ADDRess', 'Address'], ['DATA', 'Data'], ['ADATa', 'Address + data']], { showIf: (v) => v.mode === 'IIC' }),
      num('iaddr', 'Address', ':TRIGger:IIC:ADDRess', '', { showIf: (v) => v.mode === 'IIC' && /^(ADDR|ADAT)/.test(v.iwhen) }),
      num('iclev', 'SCL level', ':TRIGger:IIC:CLEVel', 'V', { showIf: (v) => v.mode === 'IIC' }),
      num('idlev', 'SDA level', ':TRIGger:IIC:DLEVel', 'V', { showIf: (v) => v.mode === 'IIC' }),

      sel('sscl', 'SCL (clock)', ':TRIGger:SPI:SCL', CH, { showIf: (v) => v.mode === 'SPI' }),
      sel('ssda', 'SDA (data)', ':TRIGger:SPI:SDA', CH, { showIf: (v) => v.mode === 'SPI' }),
      sel('swhen', 'Frame by', ':TRIGger:SPI:WHEN', [['TIMeout', 'Idle timeout'], ['CS', 'Chip select']], { showIf: (v) => v.mode === 'SPI' }),
      num('stmo', 'Timeout', ':TRIGger:SPI:TIMeout', 's', { showIf: (v) => v.mode === 'SPI' }),
      num('sdata', 'Data value', ':TRIGger:SPI:DATA', '', { showIf: (v) => v.mode === 'SPI' }),

      num('holdoff', 'Holdoff', ':TRIGger:HOLDoff', 's', { help: 'Ignore new triggers for this long after one fires. Helps with bursty signals.' }),
      tog('nrej', 'Noise reject', ':TRIGger:NREJect'),
      ro('status', 'Trigger status', ':TRIGger:STATus?', '', { help: 'TD = triggered, WAIT = waiting for a trigger, AUTO = drawing without one.' }),
    ],
  },

  measure: {
    id: 'measure',
    title: 'Measure',
    color: 'var(--accent)',
    intro: 'Pick a measurement and add it to the scope screen (up to 5 at a time). The strip under the screen in this app shows live numbers too.',
    items: [
      sel('src', 'Measure on', ':MEASure:SOURce', CH_MATH),
      sel('item', 'Measurement', null, [
        ['FREQuency', 'Frequency'], ['PERiod', 'Period'], ['VPP', 'Peak-to-peak voltage'], ['VMAX', 'Maximum voltage'],
        ['VMIN', 'Minimum voltage'], ['VAVG', 'Average voltage'], ['VRMS', 'RMS voltage'], ['VAMP', 'Amplitude (top - base)'],
        ['VTOP', 'Top'], ['VBASe', 'Base'], ['PDUTy', 'Duty cycle (+)'], ['NDUTy', 'Duty cycle (-)'], ['PWIDth', 'High pulse width'],
        ['NWIDth', 'Low pulse width'], ['RTIMe', 'Rise time'], ['FTIMe', 'Fall time'], ['OVERshoot', 'Overshoot'], ['PREShoot', 'Preshoot'],
        ['PSLEWrate', 'Rising slew rate'], ['NSLEWrate', 'Falling slew rate'], ['PPULses', 'Count + pulses'], ['NPULses', 'Count - pulses'],
        ['PEDGes', 'Count rising edges'], ['NEDGes', 'Count falling edges'], ['MARea', 'Area'], ['VARIance', 'Variance'],
      ], { local: true, dflt: 'FREQuency' }),
      act('Add to scope screen', (v) => [`:MEASure:ITEM ${v.item},${v.src || 'CHANnel1'}`]),
      act('Delay CH1 to CH2', () => [':MEASure:ITEM RDELay,CHANnel1,CHANnel2']),
      act('Phase CH1 to CH2', () => [':MEASure:ITEM RPHase,CHANnel1,CHANnel2']),
      act('Remove all measurements', () => [':MEASure:CLEar ALL'], { danger: true }),
      tog('all', 'Show every measurement at once', ':MEASure:ADISplay'),
      tog('stat', 'Statistics (min / max / avg)', ':MEASure:STATistic:DISPlay'),
      act('Reset statistics', () => [':MEASure:STATistic:RESet']),
      sel('counter', 'Frequency counter', ':MEASure:COUNter:SOURce', [['OFF', 'Off'], ...CH]),
      ro('counterval', 'Counter reading', ':MEASure:COUNter:VALue?', 'Hz', { showIf: (v) => v.counter && v.counter !== 'OFF' }),
    ],
  },

  acquire: {
    id: 'acquire',
    title: 'Acquire',
    color: 'var(--accent)',
    intro: 'How the scope samples the signal.',
    items: [
      sel('type', 'Mode', ':ACQuire:TYPE', [['NORMal', 'Normal'], ['AVERages', 'Average (smooths noise)'], ['PEAK', 'Peak detect (catch narrow spikes)'], ['HRESolution', 'High resolution']]),
      sel('avg', 'Averages', ':ACQuire:AVERages', [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024].map((n) => [String(n), String(n)]), { showIf: (v) => v.type === 'AVER' }),
      sel('mdepth', 'Memory depth', ':ACQuire:MDEPth', [['AUTO', 'Auto'], ['12000', '12k'], ['120000', '120k'], ['1200000', '1.2M'], ['12000000', '12M'], ['24000000', '24M (one channel)'], ['6000', '6k (two channels)'], ['60000', '60k (two channels)'], ['600000', '600k (two channels)'], ['6000000', '6M (two channels)']], {
        help: 'More memory keeps a fast sample rate at slow time scales, but the screen updates slower.',
      }),
      ro('srate', 'Sample rate', ':ACQuire:SRATe?', 'Sa/s'),
    ],
  },

  storage: {
    id: 'storage',
    title: 'Storage',
    color: 'var(--accent)',
    intro: 'Save to this computer instead of fiddling with a USB stick.',
    items: [
      act('Save screenshot to this computer', async (_v, ctx) => ctx.saveScreenshot()),
      act('Export CH1 + CH2 waveform as CSV', async (_v, ctx) => ctx.exportCsv(['CHANnel1', 'CHANnel2'])),
      act('Export CH1 waveform as CSV', async (_v, ctx) => ctx.exportCsv(['CHANnel1'])),
      act('Save the whole setup as a shortcut', async (_v, ctx) => ctx.saveSetupShortcut()),
      sel('img', 'Image format the scope uses for USB saves', ':STORage:IMAGe:TYPE', [['PNG', 'PNG'], ['BMP24', 'BMP 24-bit'], ['BMP8', 'BMP 8-bit'], ['JPEG', 'JPEG'], ['TIFF', 'TIFF']]),
    ],
  },

  cursor: {
    id: 'cursor',
    title: 'Cursors',
    color: 'var(--accent)',
    intro: 'Two movable lines for measuring time or voltage differences by hand.',
    items: [
      sel('mode', 'Cursor mode', ':CURSor:MODE', [['OFF', 'Off'], ['MANual', 'Manual'], ['TRACk', 'Track (follow the trace)'], ['AUTO', 'Auto (follows measurements)']]),
      sel('type', 'Measure', ':CURSor:MANual:TYPE', [['X', 'Time (vertical lines)'], ['Y', 'Voltage (horizontal lines)']], { showIf: (v) => v.mode === 'MAN' }),
      sel('src', 'On channel', ':CURSor:MANual:SOURce', CH_MATH, { showIf: (v) => v.mode === 'MAN' }),
      { kind: 'slider', key: 'ax', label: 'Cursor A position', get: ':CURSor:MANual:AX?', set: (v) => `:CURSor:MANual:AX ${v}`, min: 5, max: 594, showIf: (v) => v.mode === 'MAN' && v.type === 'X' },
      { kind: 'slider', key: 'bx', label: 'Cursor B position', get: ':CURSor:MANual:BX?', set: (v) => `:CURSor:MANual:BX ${v}`, min: 5, max: 594, showIf: (v) => v.mode === 'MAN' && v.type === 'X' },
      { kind: 'slider', key: 'ay', label: 'Cursor A position', get: ':CURSor:MANual:AY?', set: (v) => `:CURSor:MANual:AY ${v}`, min: 5, max: 394, showIf: (v) => v.mode === 'MAN' && v.type === 'Y' },
      { kind: 'slider', key: 'by', label: 'Cursor B position', get: ':CURSor:MANual:BY?', set: (v) => `:CURSor:MANual:BY ${v}`, min: 5, max: 394, showIf: (v) => v.mode === 'MAN' && v.type === 'Y' },
      ro('dx', 'Time between A and B', ':CURSor:MANual:XDELta?', 's', { showIf: (v) => v.mode === 'MAN' && v.type === 'X' }),
      ro('idx', 'As a frequency (1/time)', ':CURSor:MANual:IXDELta?', 'Hz', { showIf: (v) => v.mode === 'MAN' && v.type === 'X' }),
      ro('dy', 'Voltage between A and B', ':CURSor:MANual:YDELta?', 'V', { showIf: (v) => v.mode === 'MAN' && v.type === 'Y' }),
    ],
  },

  display: {
    id: 'display',
    title: 'Display',
    color: 'var(--accent)',
    intro: 'How traces are drawn.',
    items: [
      sel('type', 'Draw as', ':DISPlay:TYPE', [['VECTors', 'Lines'], ['DOTS', 'Dots (actual samples)']]),
      sel('pers', 'Persistence', ':DISPlay:GRADing:TIME', [['MIN', 'Off'], ['0.1', '0.1 s'], ['0.2', '0.2 s'], ['0.5', '0.5 s'], ['1', '1 s'], ['5', '5 s'], ['10', '10 s'], ['INFinite', 'Infinite (catch rare glitches)']], {
        help: 'Leaves old traces on screen so rare events show up. Press CLEAR to wipe.',
      }),
      { kind: 'slider', key: 'wbr', label: 'Trace brightness', get: ':DISPlay:WBRightness?', set: (v) => `:DISPlay:WBRightness ${v}`, min: 0, max: 100 },
      sel('grid', 'Grid', ':DISPlay:GRID', [['FULL', 'Full'], ['HALF', 'Axes only'], ['NONE', 'None']]),
      { kind: 'slider', key: 'gbr', label: 'Grid brightness', get: ':DISPlay:GBRightness?', set: (v) => `:DISPlay:GBRightness ${v}`, min: 0, max: 100 },
      act('Clear the screen', () => [':DISPlay:CLEar']),
    ],
  },

  utility: {
    id: 'utility',
    title: 'Utility',
    color: 'var(--accent)',
    intro: 'Housekeeping, plus a raw SCPI console for anything this app does not cover.',
    items: [
      ro('idn', 'Instrument', '*IDN?'),
      tog('beep', 'Beeper', ':SYSTem:BEEPer'),
      tog('lock', 'Lock the front-panel keys', ':SYSTem:LOCKed', { help: 'Stops accidental knob bumps while you work from here. Turn off before using the scope by hand.' }),
      tog('autokey', 'Allow the AUTO key', ':SYSTem:AUToscale'),
      act('Check for a firmware update', async (_v, ctx) => ctx.checkFirmware(), {
        help: 'Compares this scope\'s firmware with the newest one on Rigol\'s site. To install it, download from Rigol, copy to a USB stick, and follow their release notes.',
      }),
      act('Read the error queue', async (_v, ctx) => ctx.showErrors()),
      { kind: 'console' },
    ],
  },
};

function decoderItems(n, show) {
  const d = `:DECoder${n}`;
  const on = (f) => (v) => show(v) && f(v);
  const k = (s) => `d${n}${s}`;
  const mode = (m) => on((v) => v[k('mode')] === m);
  return [
    sel(k('mode'), 'Protocol', `${d}:MODE`, [['UART', 'UART (serial, RS232)'], ['IIC', 'I2C'], ['SPI', 'SPI'], ['PARallel', 'Parallel']], { showIf: show }),
    tog(k('disp'), 'Show decoded bytes', `${d}:DISPlay`, { showIf: show }),
    sel(k('fmt'), 'Show bytes as', `${d}:FORMat`, [['HEX', 'Hex'], ['ASCii', 'Text (ASCII)'], ['DEC', 'Decimal'], ['BIN', 'Binary']], { showIf: show }),

    sel(k('utx'), 'TX line', `${d}:UART:TX`, [...CH, ['OFF', 'Off']], { showIf: mode('UART') }),
    sel(k('urx'), 'RX line', `${d}:UART:RX`, [...CH, ['OFF', 'Off']], { showIf: mode('UART') }),
    num(k('ubaud'), 'Baud rate', `${d}:UART:BAUD`, 'bps', { showIf: mode('UART') }),
    sel(k('uwid'), 'Data bits', `${d}:UART:WIDTh`, [['8', '8'], ['7', '7'], ['6', '6'], ['5', '5']], { showIf: mode('UART') }),
    sel(k('upar'), 'Parity', `${d}:UART:PARity`, [['NONE', 'None'], ['EVEN', 'Even'], ['ODD', 'Odd']], { showIf: mode('UART') }),
    sel(k('ustop'), 'Stop bits', `${d}:UART:STOP`, [['1', '1'], ['1.5', '1.5'], ['2', '2']], { showIf: mode('UART') }),
    sel(k('upol'), 'Idle level', `${d}:UART:POLarity`, [['POSitive', 'Idle high (TTL, normal)'], ['NEGative', 'Idle low (inverted)']], { showIf: mode('UART') }),

    sel(k('iclk'), 'SCL (clock)', `${d}:IIC:CLK`, CH, { showIf: mode('IIC') }),
    sel(k('idat'), 'SDA (data)', `${d}:IIC:DATA`, CH, { showIf: mode('IIC') }),
    sel(k('iaddr'), 'Address shown', `${d}:IIC:ADDRess`, [['NORMal', '7-bit address'], ['RW', 'Address with R/W bit']], { showIf: mode('IIC') }),

    sel(k('sclk'), 'Clock', `${d}:SPI:CLK`, CH, { showIf: mode('SPI') }),
    sel(k('smosi'), 'MOSI', `${d}:SPI:MOSI`, [...CH, ['OFF', 'Off']], { showIf: mode('SPI') }),
    sel(k('smiso'), 'MISO', `${d}:SPI:MISO`, [...CH, ['OFF', 'Off']], { showIf: mode('SPI') }),
    sel(k('smode'), 'Frame by', `${d}:SPI:MODE`, [['TIMeout', 'Idle timeout (no CS wire)'], ['CS', 'Chip select']], { showIf: mode('SPI') }),
    num(k('stmo'), 'Idle timeout', `${d}:SPI:TIMeout`, 's', { showIf: mode('SPI') }),
    sel(k('sedge'), 'Sample on', `${d}:SPI:EDGE`, [['RISE', 'Rising clock edge'], ['FALL', 'Falling clock edge']], { showIf: mode('SPI') }),
    sel(k('swid'), 'Bits per word', `${d}:SPI:WIDTh`, [['8', '8'], ['16', '16'], ['24', '24'], ['32', '32']], { showIf: mode('SPI') }),
    sel(k('send'), 'Bit order', `${d}:SPI:ENDian`, [['MSB', 'MSB first'], ['LSB', 'LSB first']], { showIf: mode('SPI') }),
    { ...note('This scope has only two channels, so SPI decode usually watches clock + one data line and frames words by idle time.'), showIf: mode('SPI') },
  ];
}

// Order and grouping of the buttons on the virtual front panel. "sheet"
// opens a menu above; "cmd" runs immediately.
export const PANEL = {
  top: [
    { label: 'Measure', sheet: 'measure' },
    { label: 'Acquire', sheet: 'acquire' },
    { label: 'Storage', sheet: 'storage' },
    { label: 'Cursor', sheet: 'cursor' },
    { label: 'Display', sheet: 'display' },
    { label: 'Utility', sheet: 'utility' },
  ],
};
