module Terminal {
  function unexpected(message: string) {
    console.error(message);
  }

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function timeFormatter(x) {
    return x.toFixed(2) + "ms";
  }

  function byteFormatter(x) {
    return numberWithCommas(Math.round(x / 1024)) + "KB";
  }

  function createProgramFromSource(gl, vertex, fragment) {
    var key = vertex + "-" + fragment;
    var program = createProgram(gl, [
      createShader(gl, gl.VERTEX_SHADER, vertex),
      createShader(gl, gl.FRAGMENT_SHADER, fragment)
    ]);
    queryProgramAttributesAndUniforms(gl, program);
    return program;
  }

  function createProgram(gl, shaders) {
    var program = gl.createProgram();
    shaders.forEach(function (shader) {
      gl.attachShader(program, shader);
    });
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var lastError = gl.getProgramInfoLog(program);
      unexpected("Cannot link program: " + lastError);
      gl.deleteProgram(program);
    }
    return program;
  }

  function createShader(gl, shaderType, shaderSource) {
    var shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var lastError = gl.getShaderInfoLog(shader);
      unexpected("Cannot compile shader: " + lastError);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function queryProgramAttributesAndUniforms(gl, program) {
    program.uniforms = {};
    program.attributes = {};

    for (var i = 0, j = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i < j; i++) {
      var attribute = gl.getActiveAttrib(program, i);
      program.attributes[attribute.name] = attribute;
      attribute.location = gl.getAttribLocation(program, attribute.name);
    }
    for (var i = 0, j = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i < j; i++) {
      var uniform = gl.getActiveUniform(program, i);
      program.uniforms[uniform.name] = uniform;
      uniform.location = gl.getUniformLocation(program, uniform.name);
    }
  }

  function create2DProjection(width, height, depth) {
    // Note: This matrix flips the Y axis so 0 is at the top.
    return new Float32Array([
      2 / width, 0, 0, 0,
      0, -2 / height, 0, 0,
      0, 0, 2 / depth, 0,
      -1, 1, 0, 1,
    ]);
  }

  export const enum CharacterCode {
    NewLine = 10
  }

  export class Cursor {
    constructor(public x: number, public y: number) {
      // ...
    }
  }

  export class Buffer {
    /**
     * Start position of each line.
     */
    starts: Uint32Array;
    buffer: Uint8Array;
    styles: Uint8Array;
    colors: Uint16Array;

    /**
     * Number of rows.
     */
    h: number;

    /**
     * Maximum number of columns.
     */
    columns: number;

    /**
     * Number of columns.
     */
    get w() {
      return Math.max(this.previousMaxLineWidth, this.i - this.starts[this.h - 1]);
    }

    /**
     * Buffer index.
     */
    i: number;

    /**
     * Active 16 bit color.
     */
    color: number;

    /**
     * Active style.
     */
    style: FontStyle;

    /**
     * Maximum width so far.
     */
    previousMaxLineWidth: number

    version: number;

    constructor(columns = 1024 * 1024) {
      this.color = 0xFFFF;
      this.style = FontStyle.Normal;
      this.clear();
      this.starts = new Uint32Array(32);
      this.buffer = new Uint8Array(1024 * 1024);
      this.styles = new Uint8Array(1024 * 1024);
      this.colors = new Uint16Array(1024 * 1024);
      this.columns = columns | 0;
    }

    public clear() {
      this.h = 1;
      this.i = 0;
      this.version = 0;
      this.previousMaxLineWidth = 0;
    }

    public writeCharCode(x: number) {
      if (this.i - this.starts[this.h - 1] >= this.columns) {
        this.newLine();
      }
      if (this.buffer.length === this.i) {
        var buffer = new Uint8Array(this.buffer.length * 2);
        buffer.set(this.buffer, 0);
        this.buffer = buffer;
        var styles = new Uint8Array(this.styles.length * 2);
        styles.set(this.styles, 0);
        this.styles = styles;
        var colors = new Uint16Array(this.colors.length * 2);
        colors.set(this.colors, 0);
        this.colors = colors;
      }
      this.styles[this.i] = this.style;
      this.colors[this.i] = this.color;
      this.buffer[this.i] = x;
      this.i ++;
      this.version ++;
    }

    public writeString(s: string) {
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c === CharacterCode.NewLine) {
          this.newLine();
          continue;
        }
        this.writeCharCode(c);
      }
    }

    public newLine() {
      if (this.starts.length === this.h) {
        var starts = new Uint32Array(this.starts.length * 2);
        starts.set(this.starts, 0);
        this.starts = starts;
      }
      this.previousMaxLineWidth = Math.max(this.previousMaxLineWidth, this.i - this.starts[this.h - 1]);
      this.starts[this.h++] = this.i;
      this.version ++;
    }
  }

  export const enum FontStyle {
    Normal = 0,
    Bold = 1,
    Italic = 2,
    BoldItalic = 3
  }

  export class Screen {
    private static vertexShader =
      "uniform mat4 uTransformMatrix3D;                         " +
      "attribute vec4 aPosition;                                " +
      "attribute vec2 aCoordinate;                              " +
      "varying vec2 vCoordinate;                                " +
      "varying vec2 vCoordinate2;                               " +
      "void main() {                                            " +
      "  gl_Position = uTransformMatrix3D * aPosition;          " +
      "  vCoordinate = aCoordinate;                             " +
      "  vCoordinate2 = aCoordinate;                            " +
      "}";

    private static fragmentShader =
      "precision mediump float;                                 " +
      "uniform sampler2D uTileSampler;                          " +
      "uniform sampler2D uTileMapSampler;                       " +
      "uniform sampler2D uColorPaletteSampler;                  " +
      "varying vec2 vCoordinate;                                " +
      "varying vec2 vCoordinate2;                               " +
      "uniform float uTime;                                     " +
      "uniform vec2 uTileSize;                                  " +
      "uniform vec2 uScaledTileSize;                            " +
      "void main() {                                            " +
      "  float time = uTime;                                    " +
      "  vec4 tile = texture2D(uTileMapSampler, vCoordinate);   " +
      "  if (tile.x == 0.0 && tile.y == 0.0) { discard; }       " +
      "  vec2 tileOffset = floor(tile.xy * 256.0) * uTileSize;  " +
      "  vec2 tileCoordinate = tileOffset + mod(vCoordinate, uScaledTileSize) * (uTileSize / uScaledTileSize);" +
      "  vec4 color = texture2D(uTileSampler, tileCoordinate) * texture2D(uColorPaletteSampler, tile.zw);   " +
      "  color.rgb *= color.a;" +
      "  gl_FragColor = color;" +
      "}";

    private gl: WebGLRenderingContext;
    private cx: CanvasRenderingContext2D;
    private ratio: number;
    private program;

    private spriteCanvas: HTMLCanvasElement;

    private tileW: number;
    private tileH: number;
    private tileHPadding: number;
    private tileColumns: number;

    private tileTexture;
    private tileMapTexture;
    private colorPaletteTexture;
    private screenBufferView: Uint32Array;

    /**
     * Holds selection ranges [(x + 1) << 16 | (y + 1), length];
     */
    private selectionBuffer: Int32Array;

    private vertexBuffer;
    private dirty: boolean;

    /**
     * Raw screen buffer.
     */
    public screenBuffer: Uint8Array;

    public canvas: HTMLCanvasElement;
    public canvasOverlay: HTMLCanvasElement;

    /**
     * Number of columns.
     */
    public w: number;

    /**
     * Number of rows.
     */
    public h: number;

    /**
     * Current cursor x position.
     */
    public x: number;

    /**
     * Current cursor y position.
     */
    public y: number;

    /**
     * Current color.
     */
    public color: number;

    /**
     * Current background color.
     */
    public backgroundColor: number = 0;

    /**
     * Current font style.
     */
    public style: FontStyle = FontStyle.Normal;

    private static glyphCount = 256;

    constructor(public container: HTMLDivElement, public fontSize: number = 10) {
      this.canvas = document.createElement("canvas");
      this.canvas.style.position = "absolute";
      container.appendChild(this.canvas);
      var gl = this.gl = <any>this.canvas.getContext("webgl", { alpha: false });

      this.canvasOverlay = document.createElement("canvas");
      this.canvasOverlay.style.position = "absolute";
      (<any>(this.canvasOverlay.style)).mixBlendMode = "screen";
      (<any>(this.canvasOverlay.style)).pointerEvents = "none";


      container.appendChild(this.canvasOverlay);
      this.cx = <any>this.canvasOverlay.getContext("2d");

      gl.clearColor(0.0, 0.0, 0.0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.x = this.y = 0;
      this.color = 0xFFFF;
      this.initialize();
      this.initializeColorPaletteTexture();
      this.listenForContainerSizeChanges();
      this.enterRenderLoop();
    }

    private initialize() {
      var gl = this.gl;
      this.program = createProgramFromSource(gl, Screen.vertexShader, Screen.fragmentShader);
      gl.useProgram(this.program);
      this.vertexBuffer = gl.createBuffer();
      this.tileTexture = gl.createTexture();
      this.tileMapTexture = gl.createTexture();
      this.colorPaletteTexture = gl.createTexture();
      this.invalidate();
    }

    private initializeColorPaletteTexture() {
      var gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.colorPaletteTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var colorPalette = new Uint8Array(256 * 256 * 4);
      var j = 0;
      for (var i = 0; i < 256 * 256; i++) {
        var r = (i >> 11) & 0x1F;
        var g = (i >>  5) & 0x3F;
        var b = (i >>  0) & 0x1F;
        colorPalette[j++] = (r / 32) * 256;
        colorPalette[j++] = (g / 64) * 256;
        colorPalette[j++] = (b / 32) * 256;
        colorPalette[j++] = 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, colorPalette);
    }

    private listenForContainerSizeChanges() {
      var pollInterval = 10;
      var w = this.containerWidth;
      var h = this.containerHeight;
      this.onContainerSizeChanged();
      var self = this;
      setInterval(function () {
        if (w !== self.containerWidth || h !== self.containerHeight) {
          self.onContainerSizeChanged();
          w = self.containerWidth;
          h = self.containerHeight;
        }
      }, pollInterval);
    }

    private onContainerSizeChanged() {
      var cw = this.containerWidth;
      var ch = this.containerHeight;
      var devicePixelRatio = window.devicePixelRatio || 1;
      var backingStoreRatio = 1;
      if (devicePixelRatio !== backingStoreRatio) {
        this.ratio = devicePixelRatio / backingStoreRatio;
        this.canvasOverlay.width = this.canvas.width = cw * this.ratio;
        this.canvasOverlay.height = this.canvas.height = ch * this.ratio;
        this.canvasOverlay.style.width = this.canvas.style.width = cw + 'px';
        this.canvasOverlay.style.height = this.canvas.style.height = ch + 'px';
      } else {
        this.ratio = 1;
        this.canvasOverlay.width = this.canvas.width = cw;
        this.canvasOverlay.height = this.canvas.height = ch;
      }
      this.resize();
    }

    private get containerWidth(): number {
      return this.container.clientWidth;
    }

    private get containerHeight(): number {
      return this.container.clientHeight;
    }

    private resize() {
      this.initializeSpriteSheet();
      var gl = this.gl;
      var program = this.program;
      var screenW = this.w = this.canvas.width / this.tileW | 0;
      var screenH = this.h = this.canvas.height / this.tileH | 0;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.screenBuffer = new Uint8Array(screenW * screenH * 4);
      this.screenBufferView = new Uint32Array(this.screenBuffer.buffer);
      this.selectionBuffer = new Int32Array(1024);
      gl.bindTexture(gl.TEXTURE_2D, this.tileMapTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, screenW, screenH, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.screenBuffer);
      var matrix = create2DProjection(this.canvas.width, this.canvas.height, 2000);
      gl.uniformMatrix4fv(this.program.uniforms.uTransformMatrix3D.location, false, matrix);
      var w = this.canvas.width;
      var h = this.canvas.height;
      var f32 = new Float32Array([
        // x, y, u, v
        0, 0, 0, 0,
        w, 0, 1, 0,
        w, h, 1, 1,
        0, 0, 0, 0,
        w, h, 1, 1,
        0, h, 0, 1
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, f32, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(program.attributes.aPosition.location);
      gl.enableVertexAttribArray(program.attributes.aCoordinate.location);
      gl.vertexAttribPointer(program.attributes.aPosition.location, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(program.attributes.aCoordinate.location, 2, gl.FLOAT, false, 16, 8);
      gl.uniform2f(program.uniforms.uTileSize.location, this.tileW / this.spriteCanvas.width, this.tileH / this.spriteCanvas.height);
      gl.uniform2f(program.uniforms.uScaledTileSize.location, 1 / screenW, 1 / screenH);
      this.x = this.y = 0;
    }

    private initializeSpriteSheet() {
      var fontSize = this.fontSize * this.ratio;
      this.spriteCanvas = document.createElement("canvas");
      var context = this.spriteCanvas.getContext("2d");
      this.spriteCanvas.width = 2048;
      this.spriteCanvas.height = 2048;
      // context.fillStyle = "#000000";
      // context.fillRect(0, 0, this.spriteCanvas.width, this.spriteCanvas.height);
      context.clearRect(0, 0, this.spriteCanvas.width, this.spriteCanvas.height);
      context.fillStyle = "white";
      var baseFont = fontSize + 'px Input Mono Condensed, Consolas, Courier, monospace'
      context.font = baseFont;
      context.textBaseline = "bottom";
      var metrics = context.measureText("A");
      var tileW = this.tileW = Math.ceil(metrics.width);
      var tileHPadding = this.tileHPadding = Math.ceil((fontSize / 4 | 0) * this.ratio);
      var tileH = this.tileH = tileHPadding + fontSize;
      var tileColumns = this.tileColumns = this.spriteCanvas.width / tileW | 0;
      var j = 0;
      var fontVariants = ["", "bold ", "italic ", "italic bold "];
      for (var k = 0; k < fontVariants.length; k++) {
        context.font = fontVariants[k] + baseFont;
        for (var i = 0; i < Screen.glyphCount; i++) {
          var x = (j % tileColumns) | 0;
          var y = (j / tileColumns) | 0;
          var c = String.fromCharCode(i)
          context.fillText(c, x * tileW, fontSize + tileHPadding + y * tileH);
          j++;
        }
      }
      var gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tileTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.spriteCanvas);
      // document.getElementById("debug").appendChild(this.spriteCanvas);
    }

    private uploadScreenTexture() {
      var gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tileMapTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.screenBuffer);
    }

    private renderCanvas() {
      var gl = this.gl;
      var program = this.program;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tileTexture);
      gl.uniform1i(program.uniforms.uTileSampler.location, 0);
      gl.activeTexture(gl.TEXTURE0 + 1);
      gl.bindTexture(gl.TEXTURE_2D, this.tileMapTexture);
      gl.uniform1i(program.uniforms.uTileMapSampler.location, 1);
      if (program.uniforms.uColorPaletteSampler) {
        gl.activeTexture(gl.TEXTURE0 + 2);
        gl.bindTexture(gl.TEXTURE_2D, this.colorPaletteTexture);
        gl.uniform1i(program.uniforms.uColorPaletteSampler.location, 2);
      }
      gl.uniform1f(program.uniforms.uTime.location, performance.now() / 1000);
      var r = (this.backgroundColor >> 16 & 0xff) / 256;
      var g = (this.backgroundColor >>  8 & 0xff) / 256;
      var b = (this.backgroundColor       & 0xff) / 256;
      gl.clearColor(r, g, b, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    private renderCanvasOverlay() {
      this.cx.clearRect(0, 0, this.canvasOverlay.width, this.canvasOverlay.height);
      this.renderSelectionBuffer();
    }

    public select(x: number, y: number, l: number) {
      var buffer = this.selectionBuffer;
      for (var i = 0; i < buffer.length; i += 2) {
        if (buffer[i] === 0) {
          buffer[i] = ((x + 1) << 16) | (y + 1);
          buffer[i + 1] = l;
          break;
        }
      }
    }

    public clearAllSelections() {
      var buffer = this.selectionBuffer;
      for (var i = 0; i < buffer.length; i += 2) {
        if (buffer[i]) {
          buffer[i] = 0;
        } else {
          break;
        }
      }
    }

    private renderSelectionBuffer() {
      var buffer = this.selectionBuffer;
      for (var i = 0; i < buffer.length && buffer[i]; i += 2) {
        var x = (buffer[i] >>  16) - 1;
        var y = (buffer[i] & 0xFF) - 1;
        var l = buffer[i + 1];

        var x0 = x * this.tileW;
        var y0 = y * this.tileH; //  - (this.tileHPadding / 2) | 0;
        var dx = l * this.tileW;
        var dy = this.tileH;
        this.cx.fillStyle = "rgba(0, 100, 0, 1)";
        this.cx.fillRect(x0, y0, dx, dy);
      }
    }
    private enterRenderLoop() {
      var self = this;
      var gl = this.gl;
      var program = this.program;
      function tick() {
        if (self.dirty) {
          self.uploadScreenTexture();
          self.renderCanvas();
          self.renderCanvasOverlay();
          self.dirty = false;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    public moveTo(x: number, y: number) {
      this.x = clamp(x | 0, 0, this.w);
      this.y = clamp(y | 0, 0, this.h);
    }

    public invalidate() {
      this.dirty = true;
    }

    public clear() {
      var view = this.screenBufferView;
      for (var i = 0; i < view.length; i++) {
        view[i] = 0;
      }
      this.invalidate();
    }

    //public scroll(n) {
    //  var h = this.h;
    //  var w = this.w;
    //  var view = this.screenBufferView;
    //  for (var y = 0; y < h; y++) {
    //    if (y >= h - n) {
    //      for (var x = 0; x < w; x++) {
    //        view[y * w + x] = 0;
    //      }
    //    } else {
    //      for (var x = 0; x < w; x++) {
    //        view[y * w + x] = view[(y + n) * w + x];
    //      }
    //    }
    //  }
    //}

    public writeCharCode(c: number) {
      var w = this.w;
      var h = this.h;
      if (this.x >= w || this.x < 0 ||
          this.y >= h || this.y < 0) {
        return;
      }
      this.invalidate();
      var buffer = this.screenBuffer;
      var i = (this.w * this.y + this.x) * 4;
      c += Screen.glyphCount * this.style;
      var x = (c % this.tileColumns) | 0;
      var y = (c / this.tileColumns) | 0;
      buffer[i++] = x;
      buffer[i++] = y;
      buffer[i++] = this.color;
      buffer[i++] = this.color >> 8;
      if (this.x < this.w) {
        this.x++;
      }
    }

    /**
     * Writes a string starting at the current cursor position. If the string
     * contains new line characters new lines will be inserted.
     * @param s String to write.
     */
    public writeString(s: string) {
      for (var i = 0; i < s.length; i++) {
        this.writeCharCode(s.charCodeAt(i));
      }
    }

    private putChar(c: number, x: number, y: number, color: number, style: FontStyle) {
      x = clamp(x | 0, 0, this.w);
      y = clamp(y | 0, 0, this.h);
      var i = (y * this.w + x) * 4;
      var buffer = this.screenBuffer;
      c += Screen.glyphCount * style;
      buffer[i++] = (c % this.tileColumns) | 0;
      buffer[i++] = (c / this.tileColumns) | 0;
      buffer[i++] = color;
      buffer[i++] = color >> 8;
    }

    public writeBuffer(buffer: Buffer, sx: number, sy: number, sw: number = 1024, sh: number = 1024) {
      var dx = this.x;
      var dy = this.y;
      sx = clamp(sx | 0, 0, buffer.w - 1);
      sy = clamp(sy | 0, 0, buffer.h - 1);
      sw = clamp(sw | 0, 0, buffer.w - sx);
      sh = clamp(sh | 0, 0, buffer.h - sy);
      var w = Math.min(sw, this.w - dx);
      var h = Math.min(sh, this.h - dy);
      for (var y = 0; y < h; y++) {
        var s = buffer.starts[sy + y];
        var e = sy + y + 1 === buffer.h ? buffer.i : buffer.starts[sy + y + 1];
        var l = Math.min(e - s - sx, w);
        for (var x = 0; x < l; x++) {
          var p = s + sx + x;
          if (p > buffer.i) {
            break;
          }
          var c = buffer.buffer[p];
          var color = buffer.colors[p]
          var style = buffer.styles[p]
          this.putChar(c, dx + x, dy + y, color, style);
        }
      }
      this.invalidate();
    }
  }

  function getTargetMousePos(event: MouseEvent, target: HTMLElement): any {
    var rect = target.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  export class View {
    screen: Screen;
    buffer: Buffer;
    version: number;
    x: number;
    y: number;

    constructor(screen: Screen, buffer: Buffer) {
      this.x = 0;
      this.y = 0;
      this.screen = screen;
      this.buffer = buffer;
      this.version = 0;
      this.enterRenderLoop();
      var boundOnMouseWheel = this.onMouseWheel.bind(this);
      screen.canvas.addEventListener(("onwheel" in document ? "wheel" : "mousewheel"), boundOnMouseWheel, false);
    }

    private onMouseWheel(event: any) {
      if (!event.altKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();

        var deltaX = event.deltaX;
        var deltaY = event.deltaY;

        if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
          deltaX /= 40;
          deltaY /= 40;
        } else if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
          deltaX *= 10;
          deltaY *= 10;
        }

        var x = clamp(deltaX, -1, 1);
        var y = clamp(deltaY, -1, 1);

        if (event.metaKey) {
          x *= 10;
        }

        if (event.metaKey) {
          y *= 100;
        }

        this.scroll(x, y);
      }
    }

    public scroll(x: number, y: number) {
      this.y = clamp(this.y + y, 0, this.buffer.h - this.screen.h);
      this.x = clamp(this.x + x, 0, this.buffer.w - this.screen.w);
      this.version = 0;
    }

    public scrollToBottom() {
      this.x = 0;
      this.y = clamp(this.buffer.h - this.screen.h, 0, this.buffer.h - 1);
      this.render();
    }

    private render() {
      this.screen.clear();
      this.screen.moveTo(0, 0);
      this.screen.writeBuffer(this.buffer, this.x | 0, this.y | 0, undefined, this.screen.h - 2);
      this.screen.color = makeColor(256, 256, 0);
      this.screen.moveTo(0, this.screen.h - 1);
      this.screen.writeString("Buffer: " + byteFormatter(this.buffer.i) + " Lines: " + numberWithCommas(this.buffer.h));
    }

    private enterRenderLoop() {
      var self = this;
      function tick() {
        if (self.version !== self.buffer.version) {
          self.render();
          self.version = self.buffer.version;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
  }

  export function makeColor(r: number, g: number, b: number) {
    r = clamp(r | 0, 0, 255);
    g = clamp(g | 0, 0, 255);
    b = clamp(b | 0, 0, 255);
    return ((r / 256 * 32) & 0x1F) << 11 |
           ((g / 256 * 64) & 0x3F) <<  5 |
           ((b / 256 * 32) & 0x1F) <<  0;
  }

  function removeNewLineCharacter(s) {
    if (s.indexOf("\n") >= 0) {
      return s.split("\n").join("_");
    }
    return s;
  }

  var maxDepth = 4;
  var maxArray = 8;
  var keyColor = makeColor(0, 255, 0);
  var metaColor = makeColor(0, 255, 0);
  var textColor = makeColor(255, 255, 255);
  var stringColor = textColor;
  var numberColor = makeColor(0, 255, 255);
  var logColor = makeColor(255, 255, 255);
  var warnColor = makeColor(255, 255, 0);
  var errorColor = makeColor(255, 0, 0);

  export class Con {
    private buffer: Buffer
    private groupDepth: number = 0;
    private timers: any;
    constructor(buffer: Buffer) {
      this.buffer = buffer;
      this.timers = Object.create(null);
    }
    private logValue(x: any, depth: number) {
      var b = this.buffer;
      var c = b.color;
      if (typeof x === "number") {
        b.color = numberColor;
        b.writeString(String(x));
      } else if (typeof x === "string") {
        b.color = stringColor;
        if (x.indexOf("\n") >= 0) {
          var t = x.split("\n");
          for (var i = 0; i < t.length; i++) {
            if (i > 0) {
              this.buffer.newLine();
              this.writeGutter(" ", textColor);
            }
            b.writeString(t[i]);
          }
        } else {
          b.writeString(x);
        }
      } else if (typeof x === "object") {
        if (depth < maxDepth) {
          if (Array.isArray(x) || ArrayBuffer.isView(x)) {
            b.color = textColor;
            b.writeString("[");
            var s = Math.min(x.length, maxArray);
            for (var i = 0; i < s; i++) {
              this.logValue(x[i], depth + 1);
              if (i < x.length - 1) {
                b.writeString(", ");
              }
            }
            if (x.length > 8) {
              b.writeString("...");
            }
            b.writeString("]");
            if (x.length > 8 && depth === 0) {
              b.color = metaColor;
              b.writeString(" " + x.constructor.name + "[" + x.length + "]");
            }
          } else {
            b.color = textColor;
            b.writeString("{");
            var keys = Object.keys(x);
            for (var i = 0; i < keys.length; i++) {
              b.color = keyColor;
              b.style = FontStyle.Italic;
              b.writeString(removeNewLineCharacter(keys[i]));
              b.color = textColor;
              b.style = FontStyle.Normal;
              b.writeString(": ");
              this.logValue(x[keys[i]], depth + 1);
              if (i < keys.length - 1) {
                b.writeString(", ");
              }
            }
            b.writeString("}");
          }
        } else {
          b.color = textColor;
          if (Array.isArray(x)) {
            b.writeString("[Array]");
          } else {
            b.writeString("[Object]");
          }
        }
      }
      b.color = c;
    }
    //assert(test?: boolean, message?: string, ...optionalParams: any[]): void;
    //info(message?: any, ...optionalParams: any[]): void;
    writeGutter(prefix, color) {
      this.buffer.color = color;
      this.buffer.writeString(prefix)
      for (var i = 0; i < this.groupDepth; i++) {
        this.buffer.writeString("  ");
      }
    }
    log(message?: any, ...optionalParams: any[]): void {
      this.writeGutter(" ", logColor);
      for (var i = 0; i < arguments.length; i++) {
        this.logValue(arguments[i], 0);
        if (i < arguments.length - 1) {
          this.buffer.writeString(" ");
        }
      }
      this.buffer.newLine();
    }
    warn(message?: any, ...optionalParams: any[]): void {
      this.writeGutter("~", warnColor);
      for (var i = 0; i < arguments.length; i++) {
        this.logValue(arguments[i], 0);
        if (i < arguments.length - 1) {
          this.buffer.writeString(" ");
        }
      }
      this.buffer.newLine();
    }
    error(message?: any, ...optionalParams: any[]): void {
      this.writeGutter("!", errorColor);
      for (var i = 0; i < arguments.length; i++) {
        this.logValue(arguments[i], 0);
        if (i < arguments.length - 1) {
          this.buffer.writeString(" ");
        }
      }
      this.buffer.newLine();
    }
    put(message: any): void {
      // this.writeGutter(" ", logColor);
      for (var i = 0; i < arguments.length; i++) {
        this.logValue(arguments[i], 0);
        if (i < arguments.length - 1) {
          this.buffer.writeString(" ");
        }
      }
    }
    //profile(reportName?: string): void;
    //assert(test?: boolean, message?: string, ...optionalParams: any[]): void;
    //msIsIndependentlyComposed(element: Element): boolean;
    //clear(): void;
    //dir(value?: any, ...optionalParams: any[]): void;
    //profileEnd(): void;
    //count(countTitle?: string): void;

    time(timerName?: string): void {
      this.timers[timerName] = performance.now();
    }
    timeEnd(timerName?: string): void {
      var s = this.timers[timerName];
      if (s === undefined) {
        this.log("Timer: " + timerName + " not started.");
      }
      this.log(timerName + ": " + timeFormatter(performance.now() - s));
    }
    trace(): void {
      var stack = (<any>new Error()).stack.split("\n");
      for (var i = 0; i < stack.length; i++) {
        this.log(stack[i]);
      }
    }
    group(groupTitle: string = ""): void {
      if (groupTitle) {
        this.writeGutter(" ", textColor);
        this.buffer.writeString("> " + groupTitle);
        this.buffer.newLine();
      }
      this.groupDepth ++;
    }
    groupEnd(): void {
      this.groupDepth --;
      if (this.groupDepth < 0) {
        this.groupDepth = 0;
      }
    }
    //dirxml(value: any): void;
    //debug(message?: string, ...optionalParams: any[]): void;
    //groupCollapsed(groupTitle?: string): void;
    //select(element: Element): void;
  }
}
