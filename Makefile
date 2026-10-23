# Scope Remote: Rigol DS1202Z-E remote control.
#
#   make            install dependencies
#   make run        start the app
#   make demo       start a simulated scope and the app pointed at it
#   make mock       run just the simulated scope (127.0.0.1:$(MOCK_PORT))
#   make test       run the tests (uses the simulated scope, never a real one)
#   make check      syntax-check every source file
#   make app        build "Scope Remote.app" into dist/
#   make install    copy the built app into /Applications
#   make clean      remove dist/ and demo settings
#   make distclean  also remove node_modules/

NPM       ?= npm
NODE      ?= node
MOCK_PORT ?= 5555
ELECTRON  := node_modules/.bin/electron
PACKAGER  := node_modules/.bin/electron-packager
ARCH      := $(shell uname -m | sed -e 's/x86_64/x64/' -e 's/aarch64/arm64/')
APP       := dist/Scope Remote-darwin-$(ARCH)/Scope Remote.app
SOURCES   := $(shell find src tools test -name '*.js')

.PHONY: all run demo mock test check app install clean distclean

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

$(DEV_STAMP): node_modules tools/local-network.plist
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

app: node_modules
	$(PACKAGER) . "Scope Remote" --platform=darwin --arch=$(ARCH) --out=dist --overwrite \
		--extend-info=tools/local-network.plist \
		--ignore='^/dist' --ignore='^/test' --ignore='^/tools' --ignore='^/\.demo-data' --ignore='^/Makefile'
	codesign --force --deep --sign - "$(APP)"

install: app
	rm -rf "/Applications/Scope Remote.app"
	cp -R "$(APP)" /Applications/

clean:
	rm -rf dist .demo-data

distclean: clean
	rm -rf node_modules
