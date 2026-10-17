/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { BBox, Camera2, Vec2 } from "../math";
import { Preferences } from "../../kicanvas/preferences";

const line_delta_multiplier = 8;
const page_delta_multiplier = 24;
const zoom_speed = 0.005;
const pan_speed = 1;

export type PanAndZoomCallback = () => void;
const prefs = Preferences.INSTANCE;

/**
 * Interactive Pan and Zoom helper
 */
export class PanAndZoom {
    #rect: DOMRect;

    /**
     * Create an interactive pan and zoom helper
     * @param {HTMLElement} target - the element to attach to and listen for mouse events
     * @param {Camera2} camera - the camera that will be updated when panning and zooming
     * @param {*} callback - optional callback when pan and zoom happens
     * @param {number} min_zoom
     * @param {number} max_zoom
     */
    constructor(
        public readonly target: HTMLElement,
        public camera: Camera2,
        public callback: PanAndZoomCallback,
        public min_zoom = 0.5,
        public max_zoom = 10,
        public bounds?: BBox,
    ) {
        this.target.addEventListener(
            "wheel",
            (e: WheelEvent) => this.#on_wheel(e),
            { passive: false },
        );

        this.#setup_touch();

        let dragStartPosition: Vec2 | null = null;
        let dragging = false;

        this.target.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.button === 1 || e.button === 2) {
                e.preventDefault();
                dragging = true;
                dragStartPosition = new Vec2(e.clientX, e.clientY);
            }
        });

        this.target.addEventListener("mousemove", (e: MouseEvent) => {
            if (dragging && dragStartPosition !== null) {
                const currentPosition = new Vec2(e.clientX, e.clientY);
                const delta = currentPosition.sub(dragStartPosition);
                this.#handle_pan(-delta.x, -delta.y);
                dragStartPosition = currentPosition;
            }
        });

        this.target.addEventListener("mouseup", (e: MouseEvent) => {
            if (e.button === 1 || e.button === 2) {
                dragging = false;
                dragStartPosition = null;
            }
        });

        // Prevent the browser's default context menu.
        this.target.addEventListener("contextmenu", (e) => {
            e.preventDefault();
        });
    }

    /**
     * Touch gestures. Previously it zoomed by fixed steps, only while
     * the finger distance changed slowly, and ignored the pinch centre. Here:
     * pinch zooms by the finger distance ratio about the pinch midpoint, two
     * fingers pan, one finger pans, and a double tap zooms in 2x about the tap.
     * touchstart is not cancelled so single taps still produce click events
     * (selection).
     */
    #setup_touch() {
        const tap_slop = 10;
        const tap_ms = 300;
        const double_tap_ms = 350;
        const double_tap_slop = 30;

        let pinch: { distance: number; zoom: number; world: Vec2 } | null =
            null;
        let last: Vec2 | null = null;
        let tap: { time: number; pos: Vec2; moved: boolean } | null = null;
        let last_tap: { time: number; pos: Vec2 } | null = null;

        const local = (t: Touch) => {
            const r = this.target.getBoundingClientRect();
            return new Vec2(t.clientX - r.left, t.clientY - r.top);
        };
        const two = (e: TouchEvent) => {
            const a = local(e.touches[0]!);
            const b = local(e.touches[1]!);
            return {
                mid: new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2),
                distance: Math.hypot(a.x - b.x, a.y - b.y),
            };
        };
        const reset = () => {
            pinch = null;
            last = null;
            tap = null;
        };

        this.target.addEventListener("touchstart", (e: TouchEvent) => {
            if (e.touches.length >= 2) {
                const { mid, distance } = two(e);
                pinch = {
                    distance,
                    zoom: this.camera.zoom,
                    world: this.camera.screen_to_world(mid),
                };
                last = null;
                tap = null;
            } else if (e.touches.length === 1) {
                last = local(e.touches[0]!);
                tap = { time: e.timeStamp, pos: last, moved: false };
            }
        });

        this.target.addEventListener(
            "touchmove",
            (e: TouchEvent) => {
                e.preventDefault();
                if (e.touches.length >= 2 && pinch) {
                    const { mid, distance } = two(e);
                    if (pinch.distance > 0) {
                        this.camera.zoom = this.#clamp_zoom(
                            (pinch.zoom * distance) / pinch.distance,
                        );
                    }
                    // Keep the world point that started under the midpoint
                    // under the current midpoint (also pans with two fingers).
                    const now = this.camera.screen_to_world(mid);
                    this.camera.center.set(
                        this.camera.center.add(pinch.world.sub(now)),
                    );
                    this.callback?.();
                } else if (e.touches.length === 1 && last) {
                    const p = local(e.touches[0]!);
                    this.#handle_pan(last.x - p.x, last.y - p.y);
                    last = p;
                    if (
                        tap &&
                        Math.hypot(p.x - tap.pos.x, p.y - tap.pos.y) > tap_slop
                    ) {
                        tap.moved = true;
                    }
                }
            },
            { passive: false },
        );

        this.target.addEventListener("touchend", (e: TouchEvent) => {
            if (e.touches.length === 0) {
                if (tap && !tap.moved && e.timeStamp - tap.time < tap_ms) {
                    const pos = tap.pos;
                    if (
                        last_tap &&
                        e.timeStamp - last_tap.time < double_tap_ms &&
                        Math.hypot(
                            pos.x - last_tap.pos.x,
                            pos.y - last_tap.pos.y,
                        ) < double_tap_slop
                    ) {
                        this.zoom_about(2, pos);
                        last_tap = null;
                    } else {
                        last_tap = { time: e.timeStamp, pos };
                    }
                }
                reset();
            } else if (e.touches.length === 1) {
                // Pinch ended with one finger left: continue as a pan.
                reset();
                last = local(e.touches[0]!);
            }
        });

        this.target.addEventListener("touchcancel", reset);
    }

    #clamp_zoom(zoom: number) {
        return Math.min(this.max_zoom, Math.max(zoom, this.min_zoom));
    }

    /** Zoom by `factor` keeping the screen point `screen` fixed. */
    zoom_about(factor: number, screen: Vec2) {
        const before = this.camera.screen_to_world(screen);
        this.camera.zoom = this.#clamp_zoom(this.camera.zoom * factor);
        const after = this.camera.screen_to_world(screen);
        this.camera.center.set(this.camera.center.add(before.sub(after)));
        this.callback?.();
    }

    #on_wheel(e: WheelEvent) {
        e.preventDefault();

        let dx = e.deltaX;
        let dy = e.deltaY;

        // shift modifier flips the X and Y axes (horizontal scroll)
        if (!prefs.alignControlsWithKiCad) {
            if (dx == 0 && e.shiftKey) {
                [dx, dy] = [dy, dx];
            }
        } else {
            if (dx == 0 && e.ctrlKey) {
                [dx, dy] = [dy, dx];
            }
        }

        // work around line/page scrolling
        if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
            dx *= line_delta_multiplier;
            dy *= line_delta_multiplier;
        } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
            dx *= page_delta_multiplier;
            dy *= page_delta_multiplier;
        }

        // work around browsers setting a huge scroll distance
        dx = Math.sign(dx) * Math.min(page_delta_multiplier, Math.abs(dx));
        dy = Math.sign(dy) * Math.min(page_delta_multiplier, Math.abs(dy));

        if (!prefs.alignControlsWithKiCad) {
            // pinch zoom
            if (e.ctrlKey) {
                this.#rect = this.target.getBoundingClientRect();
                this.#handle_zoom(dy, this.#relative_mouse_pos(e));
            }
            // pan
            else {
                this.#handle_pan(dx, dy);
            }
        } else {
            if (e.shiftKey || e.ctrlKey) {
                this.#handle_pan(-dx, dy);
            }
            // pinch zoom
            else {
                this.#rect = this.target.getBoundingClientRect();
                this.#handle_zoom(dy, this.#relative_mouse_pos(e));
            }
        }

        this.target.dispatchEvent(
            new MouseEvent("panzoom", {
                clientX: e.clientX,
                clientY: e.clientY,
            }),
        );
    }

    #relative_mouse_pos(e: MouseEvent) {
        return new Vec2(
            e.clientX - this.#rect.left,
            e.clientY - this.#rect.top,
        );
    }

    #handle_pan(dx: number, dy: number) {
        const delta = new Vec2(dx * pan_speed, dy * pan_speed).multiply(
            1 / this.camera.zoom,
        );

        this.camera.translate(delta);

        if (this.callback) {
            this.callback();
        }
    }

    #handle_zoom(delta: number, mouse?: Vec2) {
        // Anchor at the mouse (previously it measured both points
        // after zooming, so the anchor never applied).
        const factor = Math.exp(delta * -zoom_speed);
        if (mouse != null) {
            this.zoom_about(factor, mouse);
            return;
        }
        this.camera.zoom = this.#clamp_zoom(this.camera.zoom * factor);

        if (this.callback) {
            this.callback();
        }
    }
}
