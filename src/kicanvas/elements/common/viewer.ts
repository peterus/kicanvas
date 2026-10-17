/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { attribute, html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import {
    KiCanvasLoadEvent,
    KiCanvasSelectEvent,
} from "../../../viewers/base/events";
import type { Viewer } from "../../../viewers/base/viewer";
import { Preferences, WithPreferences } from "../../preferences";
import type { ProjectPage } from "../../project";
import themes from "../../themes";

/**
 * Basic element for wiring up a Viewer to the DOM.
 */
export abstract class KCViewerElement<
    ViewerT extends Viewer,
> extends WithPreferences(KCUIElement) {
    canvas: HTMLCanvasElement;
    viewer: ViewerT;
    selected: any[] = [];

    @attribute({ type: Boolean })
    loaded: boolean;

    @attribute({ type: String })
    theme: string;

    @attribute({ type: Boolean })
    disableinteraction: boolean;

    override initialContentCallback() {
        (async () => {
            this.viewer = this.addDisposable(this.make_viewer());

            await this.viewer.setup();

            this.addDisposable(
                this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
                    this.loaded = true;
                    this.dispatchEvent(new KiCanvasLoadEvent());
                    // CopperChat: bubbling, composed load signal for hosts
                    // (fires on every page load, e.g. after a sheet switch).
                    this.dispatchEvent(
                        new CustomEvent("kicanvas:viewerload", {
                            bubbles: true,
                            composed: true,
                        }),
                    );
                }),
            );

            // CopperChat: re-dispatch selection as a bubbling, composed DOM
            // event so hosts can listen on <kicanvas-embed> (or document)
            // without walking the shadow DOM to reach the Viewer.
            this.addDisposable(
                this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
                    this.dispatchEvent(new KiCanvasSelectEvent(e.detail));
                }),
            );
        })();
    }

    override async preferenceChangeCallback(preferences: Preferences) {
        // Don't apply preference changes if the theme has been set via an attribute.
        if (this.theme || !this.viewer || !this.viewer.loaded) {
            return;
        }
        this.update_theme();
        this.viewer.paint();
        this.viewer.draw();
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        this.selected = [];
    }

    protected get themeObject() {
        // If the theme attribute is set, override preferences.
        if (this.theme) {
            return themes.by_name(this.theme);
        } else {
            return Preferences.INSTANCE.theme;
        }
    }

    protected abstract update_theme(): void;

    protected abstract make_viewer(): ViewerT;

    async load(src: ProjectPage) {
        this.loaded = false;
        await this.viewer.load(src.document);
    }

    override render() {
        this.canvas = html`<canvas></canvas>` as HTMLCanvasElement;

        return html`<style>
                :host {
                    display: block;
                    touch-action: none;
                    width: 100%;
                    height: 100%;
                }

                canvas {
                    width: 100%;
                    height: 100%;
                }
            </style>
            ${this.canvas}`;
    }
}
