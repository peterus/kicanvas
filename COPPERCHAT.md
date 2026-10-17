# The `copperchat` branch

This fork of [theacodes/kicanvas](https://github.com/theacodes/kicanvas) carries the changes
[CopperChat](https://github.com/peterus/copperchat) needs on top of upstream. `main` mirrors
upstream untouched; `copperchat` is upstream `b031159` plus one commit per change. CopperChat
pins a full commit SHA of this branch and builds `build/kicanvas.js` from it
(`frontend/scripts/vendor-kicanvas.sh`); its CI rebuilds the bundle and fails on any byte
difference.

The commits come in two groups.

## (a) Upstream candidates — generic fixes

Good for any KiCanvas user, mostly KiCad 11 compatibility. Each also exists as a topic branch
based on upstream `main` (`upstream/<name>`), ready to be proposed upstream. No pull request
has been opened.

| Commit | Topic branch | Why it is generic |
|---|---|---|
| fix(board): read KiCad 11 footprint placement from `(transform …)` | `upstream/kicad11-footprint-transform` | KiCad 11 boards do not render without it. |
| fix(board): support KiCad 11 nets referenced by name | `upstream/kicad11-nets-by-name` | KiCad 11 drops the net table; net highlight throws without it. |
| perf(parser): log unknown elements at debug level, build the message lazily | `upstream/quiet-parser-warnings` | Every new KiCad 11 token cost an eager stringify of the enclosing expression; an 85 MB board loads in ~23 s instead of ~130 s. |
| fix(schematic): load the sheet instance (page), not only its file | `upstream/schematic-sheet-instances` | References in hierarchical schematics with a sheet placed twice are wrong upstream. |
| fix(viewport): usable touch pan/zoom and cursor-anchored wheel zoom | `upstream/touch-pan-zoom` | Upstream pinch zoom barely works and the wheel zoom anchor is computed but never applied. `zoom_about()` is a small API addition. |

## (b) CopperChat integration — kept in the fork

Host-embedding hooks and policy choices that suit CopperChat but are not obvious upstream
defaults. They could be offered upstream later as opt-in features, but are not prepared as
topic branches.

| Commit | Why it stays here |
|---|---|
| feat(embed): re-dispatch `kicanvas:select` as a bubbling, composed event | Event API for the host page (tap → `@REF` mention); upstream would want to design this API itself. |
| feat(embed): expose the loaded project as `embed.project` | Exposes internal project/page objects as public embed API for CopperChat's sheet tree and search. |
| feat(embed): do not load the Google Fonts stylesheet at runtime | CopperChat is self-hosted/offline and provides the fonts; upstream relies on the hosted fonts. |
| feat(embed): host integration hooks (viewerload, live theme, no bottom toolbar) | `kicanvas:viewerload`, live theme forwarding and `controlslist="nobottomtoolbar"` exist for CopperChat's own chrome. |
| feat(board): a tap on a part selects the part | Changes upstream's selection policy (footprints win over nets) for phone `@REF` picking. |

## Updating

Rebase `copperchat` onto a newer upstream commit (or add commits), push, then move the pin in
CopperChat (`frontend/public/vendor/kicanvas/KICANVAS_COMMIT`), run
`frontend/scripts/vendor-kicanvas.sh`, commit the rebuilt bundle and run the viewer e2e suite.
Never force-push over a SHA that a CopperChat commit pins — push a new branch head instead, or
keep the old commit reachable with a tag (`copperchat-<date>`).
