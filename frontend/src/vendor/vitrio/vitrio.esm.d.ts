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
/** All tunable glass parameters. */
export interface LiquidGlassParams {
    /** Glass width in CSS px. */
    width: number;
    /** Glass height in CSS px. */
    height: number;
    /** Corner radius in CSS px. */
    radius: number;
    /** Refraction strength (max edge displacement in px). */
    scale: number;
    /** Bezel width: how far the curved surface reaches inward from the edge, in px. */
    depth: number;
    /** Surface profile exponent: ~2 spherical, ~4 squircle (Apple-like). */
    curvature: number;
    /** Lens shape: +1 convex (magnify), 0 flat, -1 concave (shrink). */
    convexity: number;
    /** Chromatic aberration amount. */
    chroma: number;
    /** Frost / backdrop blur in px (0 = clear). */
    blur: number;
    /** Outer/inner glow strength (0..1). */
    glow: number;
    /** Specular highlight strength (0..1). */
    edge: number;
    /** Specular light angle in degrees. */
    specAngle: number;
    /** Tint opacity (0..1). */
    tint: number;
    /** Tint colour (any CSS colour). */
    tintColor: string;
}
/** Extra glass size around an attached anchor, in px (one value or per-axis). */
export type AttachPadding = number | {
    x: number;
    y: number;
};
/** Constructor options: every parameter, plus placement/behaviour. */
export interface LiquidGlassOptions extends Partial<LiquidGlassParams> {
    /** Element to refract. It is cloned (clone mode), so the effect works cross-browser. */
    background?: Element | null;
    /** z-index of the lens layer; the draggable glass sits at z + 1. Default 100. */
    zIndex?: number;
    /** Whether the glass can be dragged with a pointer. Default true. */
    draggable?: boolean;
    /** Initial screen X of the glass top-left. Defaults to centered. */
    x?: number;
    /** Initial screen Y of the glass top-left. Defaults to centered. */
    y?: number;
    /**
     * Anchor element: the glass continuously follows the anchor's screen rect
     * (position AND size, tracked every frame), so it stays glued to ordinary
     * layout-flow UI — including CSS transitions and animated positions.
     * Overrides x/y/width/height and disables dragging.
     */
    attachTo?: Element | null;
    /** Extra glass size around the attached anchor's rect, in px. Default 0. */
    attachPadding?: AttachPadding;
    /**
     * Lightweight rendering while the glass is in motion. Browsers re-rasterize the SVG
     * filter chain on every frame the filtered content moves; Blink keeps up at 60 fps,
     * Gecko does not. With lite motion, continuous movement (dragging, attach-follow,
     * scrolling) pauses the refraction filter and approximates the lens with a cheap
     * compositor-only transform; full refraction is restored once the glass rests.
     * `'auto'` (default) enables it on filter-rendering engines other than Blink (i.e.
     * Gecko). WebKit ignores this option: it always renders the cheap approximation
     * (Safari cannot render feImage, the primitive that feeds the displacement map).
     */
    liteMotion?: boolean | 'auto';
}
/** Default parameters (based on a "strong refraction" look, with tint 0 and a light chroma). */
export declare const DEFAULTS: LiquidGlassParams;
/** LiquidGlass — programmatic API. */
export declare class LiquidGlass {
    /** Built-in default parameters. */
    static DEFAULTS: LiquidGlassParams;
    /** Current parameters (mutate via `set()`). */
    readonly params: LiquidGlassParams;
    /** Screen X of the glass top-left. */
    lensX: number;
    /** Screen Y of the glass top-left. */
    lensY: number;
    /** The element being refracted (cloned). */
    background: Element | null;
    private uid;
    private zIndex;
    private draggable;
    private _anchor;
    private _padX;
    private _padY;
    private _attachRaf;
    private margin;
    private bgX;
    private bgY;
    private _seq;
    private _dragMode;
    private _raf;
    private _syncRaf;
    private _liteOn;
    private _lite;
    private _liteT;
    private _lastMoveT;
    private canvas;
    private ctx;
    private specCanvas;
    private specCtx;
    private svg;
    private filterFull;
    private filterDrag;
    private feImage;
    private feImageDrag;
    private specImg;
    private dispR;
    private dispG;
    private dispB;
    private dispDrag;
    private lensEl;
    private lensInner;
    private glassEl;
    private _onSync;
    constructor(opts?: LiquidGlassOptions);
    private _build;
    private _cloneBackground;
    private _syncBg;
    /** Re-clone the background, rebuild the maps and re-align. Call after the background changes. */
    refresh(): this;
    private generateMap;
    private _setImg;
    private updateScales;
    private commit;
    private setDragMode;
    private placeLens;
    private _kickLite;
    private _liteTransform;
    private _applyVars;
    /** Update one or more parameters. Rebuilds the maps only when needed. */
    set(partial: Partial<LiquidGlassParams>): this;
    /** Get a copy of all parameters. */
    get(): LiquidGlassParams;
    /** Get a single parameter. */
    get<K extends keyof LiquidGlassParams>(key: K): LiquidGlassParams[K];
    /** Move the glass. x/y are the screen coordinates of its top-left corner. */
    moveTo(x: number, y: number): this;
    /**
     * Pin the glass to an anchor element. Its screen rect is re-read every frame, so the
     * glass follows layout changes, scrolling and CSS transitions of the anchor. The glass
     * size becomes anchor size + 2 * padding (maps rebuild only when the size changes).
     * Pass null to detach (the glass stays where it is).
     */
    attach(el: Element | null, padding?: AttachPadding): this;
    private _syncAttach;
    /** Swap the background element being refracted. */
    setBackground(el: Element | null): this;
    /** Remove all DOM, filters and listeners created by this instance. */
    destroy(): void;
    private _bindEvents;
}
/** Instance shape of the <liquid-glass> custom element. */
export interface LiquidGlassHTMLElement extends HTMLElement {
    /** The underlying LiquidGlass instance (null until connected). */
    glass: LiquidGlass | null;
}
/** The <liquid-glass> custom element constructor (null in non-DOM environments). */
export declare let LiquidGlassElement: (new () => LiquidGlassHTMLElement) | null;
export default LiquidGlass;
declare global {
    interface HTMLElementTagNameMap {
        'liquid-glass': LiquidGlassHTMLElement;
    }
    interface Window {
        LiquidGlass: typeof LiquidGlass;
        LiquidGlassElement: (new () => LiquidGlassHTMLElement) | null;
    }
}
