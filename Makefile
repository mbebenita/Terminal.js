.PHONY: all terminal
SRCS=$(shell find src -name "*.ts")

terminal: $(SRCS)
	./node_modules/typescript/bin/tsc --sourcemap --target ES5 src/terminal.ts --out build/terminal.js