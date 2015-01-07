.PHONY: all terminal
SRCS=$(shell find src -name "*.ts")

terminal: $(SRCS)
	tsc --sourcemap --target ES5 src/terminal.ts --out build/terminal.js
	cp build/terminal.js ~/Workspaces/j2me.js/libs/terminal.js