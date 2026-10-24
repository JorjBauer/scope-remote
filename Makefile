# Scope Remote: Rigol DS1202Z-E remote control.
#
#   make            install dependencies
#   make run        start the app
#   make demo       start a simulated scope and the app pointed at it
#   make mock       run just the simulated scope (127.0.0.1:$(MOCK_PORT))
#   make test       run the tests (uses the simulated scope, never a real one)
#   make check      syntax-check every source file
#   make app        build the app for this computer into dist/
#   make dist       build every release zip into dist/release/
#   make release    publish dist/release/ as a GitHub release (see tools/release.sh)
#   make install    copy the built app into /Applications (macOS)
#   make clean      remove dist/ and demo settings
#   make distclean  also remove node_modules/

NPM       ?= npm
NODE      ?= node
MOCK_PORT ?= 5555
ELECTRON  := node_modules/.bin/electron
PACKAGER  := node_modules/.bin/electron-packager
ARCH      := $(shell uname -m | sed -e 's/x86_64/x64/' -e 's/aarch64/arm64/')
HOST_OS   := $(shell uname -s | sed -e 's/Darwin/darwin/' -e 's/Linux/linux/' -e 's/MINGW.*/win32/' -e 's/MSYS.*/win32/')
PRODUCT   := Scope Remote
VERSION   := $(shell $(NODE) -p "require('./package.json').version")
APP       := dist/$(PRODUCT)-darwin-$(ARCH)/$(PRODUCT).app
SOURCES   := $(shell find src tools test -name '*.js')

# What `make dist` builds, as platform-arch in Electron's names.
RELEASES  := darwin-x64 darwin-arm64 win32-x64 linux-x64

.PHONY: all run demo mock test check app dist release install clean distclean

all: node_modules

node_modules: package.json
	$(NPM) install
	@touch node_modules

# macOS only lets an app onto the LAN after the user allows it under Privacy
# & Security, Local Network. The stock Electron.app is unsigned and has no
# usage string, so it never gets the prompt and connections to the scope just
# fail (a script run from Terminal is fine, because Terminal is allowed).
# Add the string and sign it ad hoc so it can be asked.
DEV_APP   := node_modules/electron/dist/Electron.app
DEV_STAMP := node_modules/.local-network-ok

# The electron package fetches its binary in a postinstall script. If that
# never ran (node_modules copied from another host, npm run with
# --ignore-scripts, an interrupted install) there is no Electron.app at all.
# install.js writes path.txt once the binary is in place.
ELECTRON_BIN := node_modules/electron/path.txt

$(ELECTRON_BIN): node_modules
	$(NODE) node_modules/electron/install.js

$(DEV_STAMP): $(ELECTRON_BIN) tools/local-network.plist
	/usr/libexec/PlistBuddy -c 'Delete :NSLocalNetworkUsageDescription' "$(DEV_APP)/Contents/Info.plist" 2>/dev/null || true
	/usr/libexec/PlistBuddy -c 'Merge tools/local-network.plist' "$(DEV_APP)/Contents/Info.plist"
	codesign --force --deep --sign - "$(DEV_APP)"
	@touch $@

run: $(DEV_STAMP)
	$(ELECTRON) .

mock:
	$(NODE) tools/mock-scope.js $(MOCK_PORT)

# The demo keeps its settings in .demo-data/ so it never auto-connects to a
# real scope address saved by `make run`.
demo: $(DEV_STAMP)
	@$(NODE) tools/mock-scope.js $(MOCK_PORT) --quiet & mock=$$!; \
	trap 'kill $$mock 2>/dev/null' EXIT INT TERM; \
	sleep 0.5; \
	SCOPE_HOST=127.0.0.1:$(MOCK_PORT) SCOPE_USERDATA=.demo-data $(ELECTRON) .

test:
	$(NODE) --test test/*.test.js

check:
	@for f in $(SOURCES); do $(NODE) --check "$$f" || exit 1; done
	@echo "syntax ok"

# Packaging. pkg-<platform>-<arch> builds one app into
# dist/Scope Remote-<platform>-<arch>/, and rel-<platform>-<arch> zips it
# into dist/release/ for a GitHub release. Electron for each platform is
# downloaded (and cached) by the packager, so any host can build them all.
PKG_FLAGS := --out=dist --overwrite \
	--ignore='^/dist' --ignore='^/test' --ignore='^/tools' --ignore='^/\.demo-data' --ignore='^/Makefile'

app: pkg-$(HOST_OS)-$(ARCH)

dist: $(addprefix rel-,$(RELEASES))

# None of these are signed with a developer identity. The Macs are signed
# ad hoc, which is no certificate at all, because an Apple Silicon Mac
# won't launch an arm64 binary without some signature, and macOS only asks
# for Local Network access on behalf of a signed app (see DEV_APP above).
# This rule comes first so make 3.81 picks it over pkg-% for darwin.
pkg-darwin-%: node_modules
	$(PACKAGER) . "$(PRODUCT)" --platform=darwin --arch=$* --extend-info=tools/local-network.plist $(PKG_FLAGS)
	$(NODE) tools/macho-uuid.js "dist/$(PRODUCT)-darwin-$*/$(PRODUCT).app/Contents/MacOS/$(PRODUCT)" "$(PRODUCT)"
	codesign --force --deep --sign - "dist/$(PRODUCT)-darwin-$*/$(PRODUCT).app"

pkg-%: node_modules
	$(PACKAGER) . "$(PRODUCT)" --platform=$(word 1,$(subst -, ,$*)) --arch=$(word 2,$(subst -, ,$*)) $(PKG_FLAGS)

# ditto keeps the Mac bundle's symlinks and signature intact, and tar keeps
# the Linux executable bits; Windows gets a plain zip.
# The pkg- and rel- targets are never real files; this stops make deleting
# them as intermediates once dist is done.
.SECONDARY:

REL = dist/release/scope-remote-$(VERSION)-$(1)-$*

rel-darwin-%: pkg-darwin-%
	@mkdir -p dist/release
	rm -f "$(call REL,darwin).zip"
	ditto -c -k --keepParent "dist/$(PRODUCT)-darwin-$*/$(PRODUCT).app" "$(call REL,darwin).zip"

rel-linux-%: pkg-linux-%
	@mkdir -p dist/release
	tar -C dist -czf "$(call REL,linux).tar.gz" "$(PRODUCT)-linux-$*"

rel-win32-%: pkg-win32-%
	@mkdir -p dist/release
	rm -f "$(call REL,win32).zip"
	cd dist && zip -qry "$(abspath $(call REL,win32)).zip" "$(PRODUCT)-win32-$*"

release:
	sh tools/release.sh check
	rm -rf dist/release
	$(MAKE) test dist
	sh tools/release.sh

install: pkg-darwin-$(ARCH)
	rm -rf "/Applications/Scope Remote.app"
	cp -R "$(APP)" /Applications/

clean:
	rm -rf dist .demo-data

distclean: clean
	rm -rf node_modules
