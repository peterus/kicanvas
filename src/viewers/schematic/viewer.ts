/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { first } from "../../base/iterator";
import { BBox } from "../../base/math";
import { is_string } from "../../base/types";
import { Color, Polygon, Polyline, Renderer } from "../../graphics";
import { Canvas2DRenderer } from "../../graphics/canvas2d";
import type { SchematicTheme } from "../../kicad";
import {
    KicadSch,
    SchematicSheet,
    SchematicSymbol,
} from "../../kicad/schematic";
import type { ProjectPage } from "../../kicanvas/project";
import { DocumentViewer } from "../base/document-viewer";
import { LayerSet } from "./layers";
import { SchematicPainter } from "./painter";

/** CopperChat: what a highlight marks; picks the colour. */
export type HighlightKind = "added" | "modified" | "removed" | "focus";

/** CopperChat: a raw highlight box in schematic coordinates (mm). */
export interface HighlightBox {
    x: number;
    y: number;
    w: number;
    h: number;
    kind?: HighlightKind;
}

interface Highlight {
    bbox: BBox;
    kind: HighlightKind;
}

const HIGHLIGHT_KINDS: readonly HighlightKind[] = [
    "added",
    "modified",
    "removed",
    "focus",
];

/** Highlight colours for light and dark backgrounds (added green, modified orange, removed red). */
const HIGHLIGHT_COLORS: Record<
    "light" | "dark",
    Record<HighlightKind, string>
> = {
    light: {
        added: "#00a33c",
        modified: "#f07800",
        removed: "#d81e1e",
        focus: "#0a64dc",
    },
    dark: {
        added: "#50fa7b",
        modified: "#ffb054",
        removed: "#ff5c5c",
        focus: "#5cc8ff",
    },
};

function as_kind(kind: unknown): HighlightKind {
    return HIGHLIGHT_KINDS.includes(kind as HighlightKind)
        ? (kind as HighlightKind)
        : "focus";
}

export class SchematicViewer extends DocumentViewer<
    KicadSch,
    SchematicPainter,
    LayerSet,
    SchematicTheme
> {
    get schematic(): KicadSch {
        return this.document;
    }

    override create_renderer(canvas: HTMLCanvasElement): Renderer {
        const renderer = new Canvas2DRenderer(canvas);
        renderer.state.fill = this.theme.note;
        renderer.state.stroke = this.theme.note;
        renderer.state.stroke_width = 0.1524;
        return renderer;
    }

    override async load(src: KicadSch | ProjectPage) {
        // CopperChat: highlights are in the previous page's coordinates; the
        // host re-applies them after kicanvas:viewerload.
        this.#highlights = [];

        if (src instanceof KicadSch) {
            return await super.load(src);
        }

        this.document = null!;

        const doc = src.document as KicadSch;
        doc.update_hierarchical_data(src.sheet_path);

        return await super.load(doc);
    }

    protected override create_painter() {
        return new SchematicPainter(this.renderer, this.layers, this.theme);
    }

    protected override create_layer_set() {
        return new LayerSet(this.theme);
    }

    public override select(
        item: SchematicSymbol | SchematicSheet | string | BBox | null,
    ): void {
        // If item is a string, find the symbol by uuid or reference.
        if (is_string(item)) {
            item =
                this.schematic.find_symbol(item) ??
                this.schematic.find_sheet(item);
        }

        // If it's a symbol or sheet, find the bounding box for it.
        if (item instanceof SchematicSymbol || item instanceof SchematicSheet) {
            const bboxes = this.layers.query_item_bboxes(item);
            item = first(bboxes) ?? null;
        }

        super.select(item);
    }

    // --- CopperChat: highlight overlay ------------------------------------

    #highlights: Highlight[] = [];

    /**
     * Adds highlights for symbols and sheets, by reference (of the loaded
     * sheet instance) or UUID. Items not on the loaded page are reported in
     * `missing`; the host switches pages itself. Highlights accumulate until
     * `clear_highlight()` or the next `load()`.
     */
    public highlight(
        targets: string[],
        kind: HighlightKind = "focus",
    ): { found: string[]; missing: string[] } {
        const found: string[] = [];
        const missing: string[] = [];
        if (!this.schematic) {
            return { found, missing: [...targets] };
        }
        const k = as_kind(kind);
        for (const name of targets) {
            const item = is_string(name)
                ? (this.schematic.find_symbol(name) ??
                  this.schematic.find_sheet(name))
                : null;
            const bb = item ? first(this.layers.query_item_bboxes(item)) : null;
            if (bb) {
                this.#highlights.push({ bbox: bb.copy(), kind: k });
                found.push(name);
            } else {
                missing.push(name);
            }
        }
        this.paint_highlight();
        return { found, missing };
    }

    /**
     * Adds raw boxes (mm, schematic coordinates) for items without a symbol
     * object: wires, labels, junctions, deleted items (a diff entry's box).
     * Returns the number of boxes added (non-finite or negative sizes skipped).
     */
    public highlight_boxes(boxes: HighlightBox[]): number {
        let added = 0;
        for (const b of boxes) {
            const ok =
                [b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v)) &&
                b.w >= 0 &&
                b.h >= 0;
            if (!ok) {
                continue;
            }
            this.#highlights.push({
                bbox: new BBox(b.x, b.y, b.w, b.h),
                kind: as_kind(b.kind),
            });
            added++;
        }
        this.paint_highlight();
        return added;
    }

    public clear_highlight() {
        this.#highlights = [];
        this.paint_highlight();
    }

    /** Fits the camera to all highlights (no-op without highlights). */
    public zoom_to_highlight() {
        if (!this.#highlights.length) {
            return;
        }
        const bb = BBox.combine(this.#highlights.map((h) => h.bbox));
        this.viewport.camera.bbox = bb.grow(
            Math.max(10, bb.w * 0.15, bb.h * 0.15),
        );
        this.draw();
    }

    public get highlighted_count() {
        return this.#highlights.length;
    }

    /** The highlight colour of `kind` for the current theme. */
    public highlight_color(kind: HighlightKind): Color {
        const bg = this.theme?.background;
        const dark =
            bg instanceof Color
                ? 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b < 0.5
                : false;
        return Color.from_css(HIGHLIGHT_COLORS[dark ? "dark" : "light"][kind]);
    }

    public override paint() {
        super.paint();
        // paint() recreates the layers (theme change, flip): redraw highlights.
        this.paint_highlight(false);
    }

    protected paint_highlight(draw = true) {
        const layer = this.layers?.highlight_layer;
        if (!layer) {
            return;
        }
        layer.clear();
        if (this.#highlights.length) {
            this.renderer.start_layer(layer.name);
            // removed first, so added/modified boxes at the same spot stay on top
            const order = [...this.#highlights].sort(
                (a, b) =>
                    Number(b.kind === "removed") - Number(a.kind === "removed"),
            );
            for (const { bbox, kind } of order) {
                const bb = bbox.copy().grow(0.6);
                const color = this.highlight_color(kind);
                const fill = color.copy();
                fill.a = kind === "removed" ? 0.1 : 0.22;
                this.renderer.polygon(Polygon.from_BBox(bb, fill));
                this.renderer.line(Polyline.from_BBox(bb, 0.35, color));
            }
            layer.graphics = this.renderer.end_layer();
            layer.graphics.composite_operation = "source-over";
        }
        if (draw) {
            this.draw();
        }
    }
}
