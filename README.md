# Scope Remote

A small Electron app that shows and drives a Rigol DS1202Z-E over the network, from my desk instead of from its front panel.

I can never remember where things live in the scope's soft-key menus. (Is UART decode under Decode or Trigger? Both, it turns out. And they have to agree?) So this mirrors the whole front panel with plain-language menus, and adds a drawer of "Shortcuts": the setups I keep having to look up, like "decode UART at 115200" or "measure the ripple on this rail".

It talks to the scope on your LAN, and can optionally check firmware (see below).

## Building and running

Everything goes through the Makefile.

```
make            # npm install (Electron and the packager)
make run        # start the app
make demo       # start a simulated scope plus the app pointed at it
make test       # tests, all against the simulated scope
make check      # syntax-check every source file
make app        # build the app for this computer into dist/
make dist       # build every release archive into dist/release/
make install    # copy the Mac app into /Applications
```

As of this writing it's built and tested with Node 26.5 and Electron 45.0 on macOS 26.7 (Intel and ARM). Nothing in it is Mac-only except `make install`, and `make dist` (which needs `codesign` and `ditto` for the Mac builds, even if not signing for distribution; MacOS permissions hinge on being signed).

## Releases

`make dist` builds all four of these from one machine, downloading Electron for each platform the first time:

```
dist/release/scope-remote-<version>-darwin-x64.zip      Intel Mac
dist/release/scope-remote-<version>-darwin-arm64.zip    Apple Silicon Mac
dist/release/scope-remote-<version>-win32-x64.zip       Windows
dist/release/scope-remote-<version>-linux-x64.tar.gz    Linux
```

The version comes from `package.json`. To build just one, `make rel-linux-x64` (or any of the other names), or `make pkg-linux-x64` for the unzipped app. Other architectures work the same way, such as `make rel-linux-arm64`; add them to `RELEASES` in the Makefile to put them in `make dist`.

None of these are signed with a developer certificate, so each OS complains the first time:

- **macOS** says it can't verify the app. Open it once, then go to System Settings, Privacy & Security, and press Open Anyway. (Or `xattr -dr com.apple.quarantine "/Applications/Scope Remote.app"`.) The Mac apps are signed ad hoc, which isn't a certificate: Apple Silicon won't run an unsigned arm64 app at all, and macOS won't ask for Local Network access for one.
- **Windows** SmartScreen says it protected your PC. Press More info, then Run anyway.
- **Linux** may refuse to start with a message about `chrome-sandbox`, on distributions that limit user namespaces (recent Ubuntu does). Either make the helper setuid root (`sudo chown root chrome-sandbox && sudo chmod 4755 chrome-sandbox`) or run it with `--no-sandbox`.

## Connecting to the scope

1. Plug the scope into your network with an Ethernet cable.
2. On the scope: **Utility**, then **IO Setting**, then **LAN Conf.** Turn on DHCP if the address says 0.0.0.0.
3. Type that IP into the box at the top of the app and press Connect. It remembers the address and reconnects next time.

Or, press Find. It broadcasts the same VXI-11 portmapper query that VISA uses to list instruments, and puts the first scope that answers into the box. It doesn't connect by itself; press Connect when it's the right one. A broadcast only reaches your own subnet; this is a local network scan of "are there any scopes here?"

The app speaks SCPI over a raw TCP socket on port 5555, so there's no VISA or driver to install. If you need another port, type `address:port`.

## What's in the window

- **The live screen** on the left, grabbed with `:DISPlay:DATA?` as fast as the scope will hand it over. Under it are status chips (channels, timebase, trigger, sample rate) and live measurements for each channel that's on. The gear next to the measurements picks which ones.
- **The front panel** in the middle, laid out like the real one. RUN/STOP, SINGLE, AUTO, CLEAR and FORCE do what they say. The knobs scroll, drag, or click. "+" on a scale knob always means zoom in, which is not what the real knobs do, but I can't keep that straight either. Double-click a knob to "push" it (center the trace, or set the trigger level to 50%). Hold Shift for fine steps.
- **The menu sheet** on the right. Every panel button opens its menu here with the same choices as the scope's soft keys, in plain words, with a line of help where I thought it was needed. Utility has a raw SCPI console for anything I didn't cover.
- **Shortcuts** (top left, or Tab). Each one asks a couple of plain questions (logic level, baud rate, and so on), shows you the exact commands it will send, applies them, and tells you what to look at afterward. You can star the ones you use. "Save what the scope is doing now" stores the scope's whole setup blob (`:SYSTem:SETup?`) under a name, so you can get back to it later with one click.

Storage in the app means this computer, not a USB stick: screenshots and CSV waveform exports go straight to a file.

Keys: Space run/stop, S single, A auto, C clear, F force, P screenshot, Tab shortcuts, Esc close.

## Firmware check

After it connects (at most once a day), the app reads Rigol North America's firmware page (https://www.rigolna.com/firmware/), finds the DS1000Z-E row (that family includes the DS1202Z-E), and compares it with the version the scope reports in `*IDN?`. If Rigol has something newer, a badge shows up next to the scope's name. Clicking it opens that page in your browser.

It only reads that one public page and never installs anything; updating is still done with a USB stick on the scope. You can turn the automatic check off in Settings, and there's a manual button under Utility. If Rigol rearranges that page the check will just say it couldn't find the row.

## The simulated scope

`tools/mock-scope.js` pretends to be a DS1202Z-E on 127.0.0.1. It remembers whatever it's told, answers queries, and draws a fake screen whose traces follow the volts/div, offset, timebase and trigger settings (CH1 is a 1 kHz 0 to 3.3 V square wave, CH2 a 1 kHz sine). `make demo` runs it with the app, using its own settings folder (`.demo-data/`) so the demo never auto-connects to your real scope.

The mock checks every query against `tools/scpi-headers.txt`, the list of commands in Rigol's DS1000Z-E Programming Guide. The real scope just stays silent when it gets a query it doesn't know, and the app would sit there until it timed out. The mock does the same and logs it loudly, and `make test` also scans the app's source for any SCPI header that isn't in that list.

## Caveats

- I wrote this against the programming guide and the simulator. The command names all come from Rigol's guide, but timing and the odd firmware quirk may need adjusting on the real scope.
- Screen grabs are around 1.1 MB as BMP. PNG is much smaller, but the scope has to compress it first. Settings lets you pick the format, and the frame rate shows under the screen so you can see which is faster on your network. If a format fails, the app drops back to BMP24 by itself.
- The trigger LEVEL knob drives the edge trigger level. For the other trigger types (pulse, UART, I2C, SPI), set the level in the Trigger menu.
- The DS1202Z-E only has two channels, so the SPI shortcut decodes clock plus one data line and frames words by idle time, with no chip select. That works for most buses but not all of them.
- The scope doesn't offer a remote "press this soft key" command, so the app can't follow along if you're also poking at the scope's own menus. It re-reads its settings every second or so, though, so knob turns on the real scope do show up.

## Where things are

```
src/main/       Electron main process: SCPI socket, file saves, settings, firmware check
src/renderer/   the window: panel, menus, shortcuts drawer
tools/          the simulated scope and the documented command list
test/           node:test tests
```

Settings and saved setups live in a JSON file in the app's user-data folder. Settings shows the exact path.
