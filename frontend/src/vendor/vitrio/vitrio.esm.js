// src/vitrio.ts
var SVGNS = "http://www.w3.org/2000/svg";
var XLINK = "http://www.w3.org/1999/xlink";
var clamp = (v, a, b) => Math.min(Math.max(v, a), b);
function roundedRectSDF(px, py, hw, hh, r) {
  const qx = Math.abs(px) - hw + r;
  const qy = Math.abs(py) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
var DEFAULTS = {
  width: 360,
  height: 220,
  radius: 48,
  scale: 46,
  depth: 40,
  curvature: 2.2,
  convexity: 1,
  chroma: 0.1,
  blur: 0,
  glow: 0.18,
  edge: 0.7,
  specAngle: 135,
  tint: 0,
  tintColor: "#ffffff"
};
var LIVE = /* @__PURE__ */ new Set([
  "blur",
  "glow",
  "tint",
  "tintColor"
]);
var _uid = 0;
var _ns = "lqg" + Math.random().toString(36).slice(2, 6) + "-";
var BLINK = typeof navigator !== "undefined" && /Chrome\/\d/.test(navigator.userAgent);
var WEBKIT = !BLINK && typeof navigator !== "undefined" && /AppleWebKit/i.test(navigator.userAgent);
var LITE_SETTLE_MS = 120;
var LITE_BURST_MS = 160;
var _styleEl = null;
function injectStyle() {
  if (_styleEl || typeof document === "undefined") return;
  const existing = document.getElementById("liquid-glass-style");
  if (existing instanceof HTMLStyleElement) {
    _styleEl = existing;
    return;
  }
  _styleEl = document.createElement("style");
  _styleEl.id = "liquid-glass-style";
  _styleEl.textContent = `.lqg-lens{position:fixed;top:0;left:0;overflow:hidden;pointer-events:none;}.lqg-lens-inner{position:absolute;top:0;left:0;}.lqg-glass{position:fixed;top:0;left:0;box-sizing:border-box;pointer-events:none;overflow:hidden;-webkit-backdrop-filter:blur(var(--lqg-blur,0px));backdrop-filter:blur(var(--lqg-blur,0px));background:color-mix(in srgb, var(--lqg-tint-color,#fff) calc(var(--lqg-tint,0) * 100%), transparent);box-shadow:0 10px 40px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.25),inset 0 0 0 1px rgba(255,255,255,.06),0 0 calc(var(--lqg-glow,0) * 60px) rgba(255,255,255, calc(var(--lqg-glow,0) * .55));touch-action:none;will-change:transform;}.lqg-glass.lqg-draggable{pointer-events:auto;cursor:grab;}.lqg-glass.lqg-draggable:active{cursor:grabbing;}.lqg-spec{position:absolute;pointer-events:none;mix-blend-mode:screen;user-select:none;}`;
  (document.head || document.documentElement).appendChild(_styleEl);
}
var LiquidGlass = class {
  constructor(opts = {}) {
    /** Screen X of the glass top-left. */
    this.lensX = 0;
    /** Screen Y of the glass top-left. */
    this.lensY = 0;
    this._anchor = null;
    this._padX = 0;
    this._padY = 0;
    this._attachRaf = 0;
    this.margin = 60;
    this.bgX = 0;
    this.bgY = 0;
    this._seq = 0;
    this._dragMode = false;
    this._raf = 0;
    this._syncRaf = 0;
    this._lite = false;
    this._liteT = 0;
    this._lastMoveT = -1e9;
    injectStyle();
    this.uid = _ns + ++_uid;
    this.background = opts.background || null;
    this.zIndex = opts.zIndex != null ? opts.zIndex : 100;
    this.draggable = opts.draggable !== false && !opts.attachTo;
    this._liteOn = !WEBKIT && (opts.liteMotion === true || opts.liteMotion !== false && !BLINK);
    this.params = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const v = opts[k];
      if (v != null) this.params[k] = v;
    }
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.specCanvas = document.createElement("canvas");
    this.specCtx = this.specCanvas.getContext("2d", { willReadFrequently: true });
    this._build();
    this._bindEvents();
    const x = opts.x != null ? opts.x : (window.innerWidth - this.params.width) / 2;
    const y = opts.y != null ? opts.y : (window.innerHeight - this.params.height) / 2;
    this.lensX = x;
    this.lensY = y;
    this.refresh();
    if (opts.attachTo) this.attach(opts.attachTo, opts.attachPadding);
  }
  static {
    /** Built-in default parameters. */
    this.DEFAULTS = DEFAULTS;
  }
  /* ---------- Build DOM and the per-instance SVG filters (unique ids) ----------
     Built with createElementNS, not innerHTML: WebKit never renders feImage nodes that
     were produced by the HTML parser's foreign-content path, and programmatic nodes are
     what lets _setImg swap in fresh feImages with the href already set (see there). */
  _build() {
    const u = this.uid;
    const fe = (name, attrs) => {
      const el = document.createElementNS(SVGNS, name);
      for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
      return el;
    };
    const cm = (ch) => {
      const m = ["0 0 0 0 0", "0 0 0 0 0", "0 0 0 0 0", "0 0 0 1 0"];
      m[ch] = ch === 0 ? "1 0 0 0 0" : ch === 1 ? "0 1 0 0 0" : "0 0 1 0 0";
      return m.join("  ");
    };
    const FILTER = { x: "0", y: "0", width: "100%", height: "100%", "color-interpolation-filters": "sRGB" };
    const IMG = { x: "0", y: "0", preserveAspectRatio: "none", result: "map" };
    const DISP = { in: "SourceGraphic", in2: "map", xChannelSelector: "R", yChannelSelector: "G" };
    const svg = fe("svg", { "aria-hidden": "true" });
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    const defs = fe("defs", {});
    this.feImage = fe("feImage", IMG);
    this.filterFull = fe("filter", { id: u + "-full", ...FILTER });
    this.dispR = fe("feDisplacementMap", { ...DISP, result: "dr" });
    this.dispG = fe("feDisplacementMap", { ...DISP, result: "dg" });
    this.dispB = fe("feDisplacementMap", { ...DISP, result: "db" });
    this.filterFull.append(
      this.feImage,
      this.dispR,
      fe("feColorMatrix", { in: "dr", type: "matrix", values: cm(0), result: "cr" }),
      this.dispG,
      fe("feColorMatrix", { in: "dg", type: "matrix", values: cm(1), result: "cg" }),
      this.dispB,
      fe("feColorMatrix", { in: "db", type: "matrix", values: cm(2), result: "cb" }),
      fe("feBlend", { in: "cr", in2: "cg", mode: "screen", result: "rg" }),
      fe("feBlend", { in: "rg", in2: "cb", mode: "screen" })
    );
    this.feImageDrag = fe("feImage", IMG);
    this.dispDrag = fe("feDisplacementMap", DISP);
    this.filterDrag = fe("filter", { id: u + "-drag", ...FILTER });
    this.filterDrag.append(this.feImageDrag, this.dispDrag);
    defs.append(this.filterFull, this.filterDrag);
    svg.appendChild(defs);
    document.body.appendChild(svg);
    this.svg = svg;
    this.lensEl = document.createElement("div");
    this.lensEl.className = "lqg-lens";
    this.lensEl.style.zIndex = String(this.zIndex);
    this.lensInner = document.createElement("div");
    this.lensInner.className = "lqg-lens-inner";
    this.lensEl.appendChild(this.lensInner);
    this.glassEl = document.createElement("div");
    this.glassEl.className = "lqg-glass" + (this.draggable ? " lqg-draggable" : "");
    this.glassEl.style.zIndex = String(this.zIndex + 1);
    this.specImg = document.createElement("img");
    this.specImg.className = "lqg-spec";
    this.specImg.alt = "";
    this.glassEl.appendChild(this.specImg);
    document.body.appendChild(this.lensEl);
    document.body.appendChild(this.glassEl);
    this._applyVars();
  }
  /* ---------- Background clone + alignment ---------- */
  _cloneBackground() {
    this.lensInner.innerHTML = "";
    const bg = this.background;
    if (!bg) return;
    const clone = bg.cloneNode(true);
    clone.style.position = "absolute";
    clone.style.inset = "0";
    clone.style.margin = "0";
    clone.setAttribute("aria-hidden", "true");
    this.lensInner.appendChild(clone);
  }
  _syncBg() {
    if (this.background) {
      const r = this.background.getBoundingClientRect();
      this.bgX = r.left;
      this.bgY = r.top;
      this.lensInner.style.width = r.width + "px";
      this.lensInner.style.height = r.height + "px";
    } else {
      this.bgX = 0;
      this.bgY = 0;
      this.lensInner.style.width = window.innerWidth + "px";
      this.lensInner.style.height = window.innerHeight + "px";
    }
  }
  /** Re-clone the background, rebuild the maps and re-align. Call after the background changes. */
  refresh() {
    this._cloneBackground();
    this._syncBg();
    this.generateMap();
    return this;
  }
  /* ---------- Displacement + specular maps (height-field optical model) ---------- */
  generateMap() {
    const p = this.params;
    const W = p.width, H = p.height;
    const M = Math.max(16, Math.ceil(p.scale * (1 + clamp(p.chroma, 0, 0.95))) + 12);
    this.margin = M;
    const OW = W + 2 * M, OH = H + 2 * M;
    const hw = W / 2, hh = H / 2;
    const rr = Math.min(p.radius, hw, hh);
    const bezel = Math.max(1, p.depth);
    const k = Math.max(1.2, p.curvature);
    const blend = (clamp(p.convexity, -1, 1) + 1) / 2;
    const profile = (t) => {
      t = clamp(t, 0, 1);
      const q = 1 - t;
      const convex = Math.pow(1 - Math.pow(q, k), 1 / k);
      return 1 - convex + (convex - (1 - convex)) * blend;
    };
    const dpp = 0.5 / bezel;
    const res = BLINK || WEBKIT ? Math.min(1, 360 / Math.max(OW, OH)) : 1;
    const mw = Math.max(2, Math.round(OW * res));
    const mh = Math.max(2, Math.round(OH * res));
    const cv = this.canvas;
    cv.width = mw;
    cv.height = mh;
    const img = this.ctx.createImageData(mw, mh);
    const data = img.data;
    const N = mw * mh;
    const rx = new Float32Array(N), ry = new Float32Array(N), sp = new Float32Array(N);
    let maxAbs = 1e-6, maxSpec = 1e-6;
    const la = p.specAngle * Math.PI / 180;
    const Lx = Math.cos(la), Ly = -Math.sin(la);
    const SHININESS = 4;
    const e = Math.max(0.75, 0.75 / res);
    const sdf = (x, y) => roundedRectSDF(x, y, hw, hh, rr);
    let idx = 0;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++, idx++) {
        const px = (x + 0.5) / mw * OW - OW / 2;
        const py = (y + 0.5) / mh * OH - OH / 2;
        const d = sdf(px, py);
        const din = -d;
        let mag = 0;
        if (din >= 0 && din <= bezel) {
          const t = din / bezel;
          mag = (profile(t + dpp) - profile(t - dpp)) / (2 * dpp);
        }
        let gx = sdf(px + e, py) - sdf(px - e, py);
        let gy = sdf(px, py + e) - sdf(px, py - e);
        const gl = Math.hypot(gx, gy) || 1;
        gx /= gl;
        gy /= gl;
        const align = gx * Lx + gy * Ly;
        const sv = Math.abs(mag) * (Math.pow(Math.max(0, align), SHININESS) + 0.3 * Math.pow(Math.max(0, -align), SHININESS));
        sp[idx] = sv;
        if (sv > maxSpec) maxSpec = sv;
        const dx = -gx * mag, dy = -gy * mag;
        rx[idx] = dx;
        ry[idx] = dy;
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        if (m > maxAbs) maxAbs = m;
      }
    }
    let url = "";
    if (!WEBKIT) {
      for (let i = 0; i < N; i++) {
        data[i * 4] = clamp(rx[i] / maxAbs * 0.5 + 0.5, 0, 1) * 255;
        data[i * 4 + 1] = clamp(ry[i] / maxAbs * 0.5 + 0.5, 0, 1) * 255;
        data[i * 4 + 2] = 128;
        data[i * 4 + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
      url = cv.toDataURL();
    }
    this.specCanvas.width = mw;
    this.specCanvas.height = mh;
    const simg = this.specCtx.createImageData(mw, mh);
    const sd = simg.data;
    for (let i = 0; i < N; i++) {
      const a = clamp(Math.pow(sp[i] / maxSpec, 0.9) * p.edge, 0, 1);
      sd[i * 4] = 255;
      sd[i * 4 + 1] = 255;
      sd[i * 4 + 2] = 255;
      sd[i * 4 + 3] = a * 255;
    }
    this.specCtx.putImageData(simg, 0, 0);
    const specUrl = this.specCanvas.toDataURL();
    this.lensEl.style.width = OW + "px";
    this.lensEl.style.height = OH + "px";
    this.lensEl.style.clipPath = `inset(${M}px round ${rr}px)`;
    this.specImg.src = specUrl;
    const si = this.specImg.style;
    si.left = -M + "px";
    si.top = -M + "px";
    si.width = OW + "px";
    si.height = OH + "px";
    this.placeLens();
    this.updateScales();
    if (!WEBKIT) {
      this.feImage = this._setImg(this.feImage, OW, OH, url);
      this.feImageDrag = this._setImg(this.feImageDrag, OW, OH, url);
      this.commit();
    }
  }
  /* WebKit only loads an feImage whose href is already set when the node enters the
     document — mutating href on a live feImage never triggers a load, leaving the filter
     output empty (glass invisible in Safari). So each map update swaps in a freshly
     created node with the data URI baked in. Blink/Gecko are fine either way. */
  _setImg(old, w, h, href) {
    const fe = document.createElementNS(SVGNS, "feImage");
    fe.setAttribute("x", "0");
    fe.setAttribute("y", "0");
    fe.setAttribute("width", String(w));
    fe.setAttribute("height", String(h));
    fe.setAttribute("preserveAspectRatio", "none");
    fe.setAttribute("result", old.getAttribute("result"));
    fe.setAttribute("href", href);
    fe.setAttributeNS(XLINK, "href", href);
    old.parentNode.replaceChild(fe, old);
    return fe;
  }
  updateScales() {
    const s = this.params.scale, c = clamp(this.params.chroma, 0, 0.95), base = 2 * s;
    this.dispR.setAttribute("scale", (base * (1 + c)).toFixed(2));
    this.dispG.setAttribute("scale", base.toFixed(2));
    this.dispB.setAttribute("scale", (base * (1 - c)).toFixed(2));
    this.dispDrag.setAttribute("scale", base.toFixed(2));
  }
  /* (Re)attach the filter under a fresh id (some engines cache filter output by id).
     While lite motion is engaged the filter stays off — it is re-committed on settle.
     WebKit never gets a filter: its lens runs the transform approximation instead. */
  commit() {
    if (WEBKIT) return;
    this._seq++;
    const el = this._dragMode ? this.filterDrag : this.filterFull;
    const id = (this._dragMode ? this.uid + "-drag-" : this.uid + "-full-") + this._seq;
    el.setAttribute("id", id);
    this.lensEl.style.filter = this._lite ? "none" : "url(#" + id + ")";
  }
  setDragMode(on) {
    this._dragMode = on;
    this.commit();
  }
  /* Position the lens window and align the cloned background to the real one. Integer-snapped
     so the clone shares the pixel grid with the original (avoids text shimmer). */
  placeLens() {
    const M = this.margin;
    const lx = Math.round(this.lensX) - M, ly = Math.round(this.lensY) - M;
    this.lensEl.style.left = lx + "px";
    this.lensEl.style.top = ly + "px";
    this.lensInner.style.left = this.bgX - lx + "px";
    this.lensInner.style.top = this.bgY - ly + "px";
    const p = this.params;
    const g = this.glassEl.style;
    g.width = p.width + "px";
    g.height = p.height + "px";
    g.borderRadius = Math.min(p.radius, p.width / 2, p.height / 2) + "px";
    g.transform = `translate(${Math.round(this.lensX)}px, ${Math.round(this.lensY)}px)`;
    if (this._lite || WEBKIT) this._liteTransform();
  }
  /* ---------- Lite motion: pause refraction while the glass is moving ----------
     Re-rasterizing the filter every frame is what makes motion stutter on WebKit/Gecko.
     During continuous movement we drop the filter and stand in a transform-based
     magnification — transform and transform-origin are compositor-only, so the cached
     lens layer just gets re-composited, never re-rendered. */
  /* Called on every position change. Two moves within LITE_BURST_MS = continuous motion. */
  _kickLite() {
    if (!this._liteOn) return;
    const now = performance.now();
    const burst = now - this._lastMoveT < LITE_BURST_MS;
    this._lastMoveT = now;
    if (!burst && !this._lite) return;
    if (!this._lite) {
      this._lite = true;
      this.lensEl.style.filter = "none";
      this._liteTransform();
    }
    clearTimeout(this._liteT);
    this._liteT = window.setTimeout(() => {
      this._lite = false;
      this.lensInner.style.transform = "";
      this.lensInner.style.transformOrigin = "";
      this.commit();
    }, LITE_SETTLE_MS);
  }
  /* Uniform scale chosen so the content sampled at the lens edge matches what the real
     refraction shows there (edge displacement = scale px inward), which makes the
     filter <-> transform switch hard to notice. Sign follows convexity.
     On WebKit this transform IS the lens (feImage-less approximation), permanently. */
  _liteTransform() {
    const p = this.params;
    const s = Math.min(p.scale, Math.min(p.width, p.height) * 0.45);
    const c = clamp(p.convexity, -1, 1) * (WEBKIT ? 0.55 : 1);
    const kx = 1 + (p.width / Math.max(1, p.width - 2 * s) - 1) * c;
    const ky = 1 + (p.height / Math.max(1, p.height - 2 * s) - 1) * c;
    const st = this.lensInner.style;
    st.transformOrigin = `${this.lensX + p.width / 2 - this.bgX}px ${this.lensY + p.height / 2 - this.bgY}px`;
    const kMin = WEBKIT ? 0.7 : 0.6, kMax = WEBKIT ? 1.35 : 1.6;
    st.transform = `scale(${clamp(kx, kMin, kMax).toFixed(4)}, ${clamp(ky, kMin, kMax).toFixed(4)})`;
  }
  _applyVars() {
    const g = this.glassEl.style, p = this.params;
    g.setProperty("--lqg-blur", p.blur + "px");
    g.setProperty("--lqg-glow", String(p.glow));
    g.setProperty("--lqg-tint", String(p.tint));
    g.setProperty("--lqg-tint-color", p.tintColor);
  }
  /* ---------- Public API ---------- */
  /** Update one or more parameters. Rebuilds the maps only when needed. */
  set(partial) {
    let regen = false;
    for (const key of Object.keys(partial)) {
      if (!(key in this.params)) continue;
      const v = partial[key];
      if (v === void 0) continue;
      this.params[key] = v;
      if (!LIVE.has(key)) regen = true;
    }
    this._applyVars();
    if (regen) {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this.generateMap());
    } else {
      this.placeLens();
      this.updateScales();
      this.commit();
    }
    return this;
  }
  get(key) {
    return key ? this.params[key] : { ...this.params };
  }
  /** Move the glass. x/y are the screen coordinates of its top-left corner. */
  moveTo(x, y) {
    if (x !== this.lensX || y !== this.lensY) this._kickLite();
    this.lensX = x;
    this.lensY = y;
    this.placeLens();
    return this;
  }
  /**
   * Pin the glass to an anchor element. Its screen rect is re-read every frame, so the
   * glass follows layout changes, scrolling and CSS transitions of the anchor. The glass
   * size becomes anchor size + 2 * padding (maps rebuild only when the size changes).
   * Pass null to detach (the glass stays where it is).
   */
  attach(el, padding) {
    if (padding != null) {
      const p = typeof padding === "number" ? { x: padding, y: padding } : padding;
      this._padX = p.x;
      this._padY = p.y;
    }
    this._anchor = el;
    cancelAnimationFrame(this._attachRaf);
    this._attachRaf = 0;
    if (el) {
      const loop = () => {
        this._syncAttach();
        this._attachRaf = requestAnimationFrame(loop);
      };
      loop();
    }
    return this;
  }
  /* One attach-tracking step: follow the anchor rect; cheap unless something changed. */
  _syncAttach() {
    const a = this._anchor;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width + 2 * this._padX));
    const h = Math.max(2, Math.round(r.height + 2 * this._padY));
    const x = Math.round(r.left - this._padX);
    const y = Math.round(r.top - this._padY);
    if (w !== this.params.width || h !== this.params.height) {
      this._kickLite();
      this.lensX = x;
      this.lensY = y;
      this.set({ width: w, height: h });
    } else if (x !== Math.round(this.lensX) || y !== Math.round(this.lensY)) {
      this.moveTo(x, y);
    }
  }
  /** Swap the background element being refracted. */
  setBackground(el) {
    this.background = el;
    this.refresh();
    return this;
  }
  /** Remove all DOM, filters and listeners created by this instance. */
  destroy() {
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._syncRaf);
    cancelAnimationFrame(this._attachRaf);
    this._anchor = null;
    clearTimeout(this._liteT);
    window.removeEventListener("scroll", this._onSync, true);
    window.removeEventListener("resize", this._onSync);
    this.glassEl.remove();
    this.lensEl.remove();
    this.svg.remove();
  }
  /* ---------- Events ---------- */
  _bindEvents() {
    this._onSync = () => {
      if (this._syncRaf) return;
      this._syncRaf = requestAnimationFrame(() => {
        this._syncRaf = 0;
        const px2 = this.bgX, py2 = this.bgY;
        this._syncBg();
        if (this.bgX !== px2 || this.bgY !== py2) this._kickLite();
        this.placeLens();
      });
    };
    window.addEventListener("scroll", this._onSync, true);
    window.addEventListener("resize", this._onSync);
    if (!this.draggable) return;
    let dragging = false, ox = 0, oy = 0, px = 0, py = 0, raf = 0;
    this.glassEl.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      dragging = true;
      ox = ev.clientX - this.lensX;
      oy = ev.clientY - this.lensY;
      this.glassEl.setPointerCapture(ev.pointerId);
      this.setDragMode(true);
    });
    this.glassEl.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      px = ev.clientX - ox;
      py = ev.clientY - oy;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        this.moveTo(px, py);
      });
    });
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        this.moveTo(px, py);
      }
      this.setDragMode(false);
    };
    this.glassEl.addEventListener("pointerup", up);
    this.glassEl.addEventListener("pointercancel", up);
  }
};
var ATTRS = {
  width: "width",
  height: "height",
  radius: "radius",
  scale: "scale",
  depth: "depth",
  curvature: "curvature",
  convexity: "convexity",
  chroma: "chroma",
  blur: "blur",
  glow: "glow",
  edge: "edge",
  "spec-angle": "specAngle",
  tint: "tint",
  "tint-color": "tintColor"
};
var LiquidGlassElement = null;
if (typeof HTMLElement !== "undefined") {
  class LiquidGlassElementImpl extends HTMLElement {
    constructor() {
      super(...arguments);
      this.glass = null;
    }
    static get observedAttributes() {
      return Object.keys(ATTRS).concat(["background", "draggable", "x", "y", "z-index", "attach-to", "attach-padding", "lite-motion"]);
    }
    connectedCallback() {
      if (this.glass) return;
      this.style.display = "none";
      const at = (n) => this.getAttribute(n);
      const num = (n) => {
        const v = at(n);
        return v == null ? void 0 : parseFloat(v);
      };
      const bgSel = at("background");
      const atSel = at("attach-to");
      const zIdx = at("z-index");
      const lm = at("lite-motion");
      const opts = {
        background: bgSel ? document.querySelector(bgSel) : null,
        attachTo: atSel ? document.querySelector(atSel) : null,
        attachPadding: num("attach-padding"),
        liteMotion: lm == null || lm === "auto" ? "auto" : lm !== "false",
        draggable: at("draggable") !== "false",
        zIndex: zIdx != null ? parseInt(zIdx, 10) : void 0,
        x: num("x"),
        y: num("y"),
        tintColor: at("tint-color") || void 0
      };
      for (const attr of Object.keys(ATTRS)) {
        if (attr === "tint-color") continue;
        const v = num(attr);
        if (v !== void 0) opts[ATTRS[attr]] = v;
      }
      this.glass = new LiquidGlass(opts);
    }
    disconnectedCallback() {
      if (this.glass) {
        this.glass.destroy();
        this.glass = null;
      }
    }
    attributeChangedCallback(name, _old, val) {
      if (!this.glass) return;
      if (name === "background") {
        this.glass.setBackground(val ? document.querySelector(val) : null);
        return;
      }
      if (name === "attach-to" || name === "attach-padding") {
        const sel = this.getAttribute("attach-to");
        const pad = this.getAttribute("attach-padding");
        this.glass.attach(sel ? document.querySelector(sel) : null, pad != null ? parseFloat(pad) : void 0);
        return;
      }
      if (name === "x" || name === "y") {
        const x = this.getAttribute("x"), y = this.getAttribute("y");
        this.glass.moveTo(x != null ? parseFloat(x) : this.glass.lensX, y != null ? parseFloat(y) : this.glass.lensY);
        return;
      }
      if (val == null || !(name in ATTRS)) return;
      this.glass.set({ [ATTRS[name]]: name === "tint-color" ? val : parseFloat(val) });
    }
  }
  LiquidGlassElement = LiquidGlassElementImpl;
  if (typeof customElements !== "undefined" && !customElements.get("liquid-glass")) {
    customElements.define("liquid-glass", LiquidGlassElementImpl);
  }
}
var vitrio_default = LiquidGlass;
export {
  DEFAULTS,
  LiquidGlass,
  LiquidGlassElement,
  vitrio_default as default
};
/*!
 * vitrio — Cross-browser liquid-glass refraction (Chrome / Safari / Firefox)
 *
 * Built on the SVG feDisplacementMap primitive: a displacement map is generated on the
 * fly from a "height field" optical model, bending the real background pixels — convex
 * surfaces magnify, concave shrink — with chromatic aberration and a normal-based
 * specular highlight.
 *
 * Refraction source = clone mode: the background element you point it at is cloned and
 * refracted, which keeps it working across Chrome, Safari and Firefox.
 *
 * --- Usage A: JavaScript class ---
 *   import LiquidGlass from 'vitrio';
 *   const glass = new LiquidGlass({
 *     background: document.querySelector('#scene'), // element to refract (it gets cloned)
 *     width: 360, height: 220, radius: 48,
 *     scale: 46, chroma: 0.1, tint: 0,              // see DEFAULTS for the full list
 *   });
 *   glass.set({ scale: 60 }); // update params
 *   glass.moveTo(x, y);       // move (screen position of the glass top-left)
 *   glass.refresh();          // re-clone after the background changes
 *   glass.destroy();          // tear down
 *
 * --- Usage B: Web Component ---
 *   import 'vitrio';  // registers <liquid-glass>
 *   <liquid-glass background="#scene" width="360" height="220"
 *                  scale="46" chroma="0.1" tint="0"></liquid-glass>
 *
 * @license MIT
 */
//# sourceMappingURL=vitrio.esm.js.map
