# OpsDocktor visual identity

OpsDocktor is the **Starcoach OpsDocktor** product for the Liara deployment challenge. Liara remains the official sponsor and challenge attribution in the product copy; these assets identify OpsDocktor only.

## Mark

The mark uses two rounded brackets around a three-node path: captured log → proposed patch → verified result. It is a compact process mark, with no medical, AI-brain, or sponsor-logo imagery. The source is plain SVG with a `0 0 64 64` viewBox, 2.8-unit rounded strokes, and no script, animation, external reference, or network dependency.

- `assets/brand/opsdocktor-logo-primary.svg` — editable indigo and teal primary mark.
- `assets/brand/opsdocktor-logo-mono.svg` — single-color `currentColor` mark.
- `assets/brand/opsdocktor-logo-light.svg` and `opsdocktor-logo-dark.svg` — explicit light and dark palette variants.
- `assets/brand/opsdocktor-lockup.svg` — mark with a separate Starcoach OpsDocktor text wordmark.
- `assets/brand/opsdocktor-favicon.svg` — square favicon-ready source.

The live header embeds the same mark inline next to the separately selectable `Starcoach OpsDocktor` heading, so the page does not request an external image. The favicon source is packaged but not served or linked by the demo: doing that would require a new backend static route, which was outside this visual-only change.

The brackets and three nodes remain recognizable in the actual 34px mobile and 40px desktop header. At 24px the 2.8-unit stroke scales to about 1.05px and 6-unit node diameter to 2.25px; at 32px they scale to 1.4px and 3px. The standalone SVG could not be raster-previewed at those two exact sizes in this environment because no local SVG renderer was installed and the browser declined a data-URL preview. The 24px and 32px checks are therefore geometry-based; exact-size raster inspection remains unverified.

## Semantic palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#F5F7FF` | `#101322` | Page canvas |
| `--surface` | `#FFFFFF` | `#191D31` | Cards |
| `--surface-elevated` | `#EDF0FC` | `#242943` | Controls and raised surfaces |
| `--brand` | `#4338CA` | `#A5B4FC` | Primary actions and selected theme option |
| `--on-brand` | `#FFFFFF` | `#141729` | Text and icons on primary actions |
| `--brand-soft` | `#E8E9FF` | `#292D4C` | Mode badge surface |
| `--accent` | `#0F766E` | `#5EEAD4` | Supporting mark detail only |

The former blue `--accent` action color was separated into `--brand`; teal no longer carries SUCCESS meaning. SUCCESS, warning, failure, and UNKNOWN keep distinct green, amber, red, and amber presentations. REPLAY/MOCK remains a clearly labeled mode badge, visually separate from those result states.

The current palette produces these WCAG contrast ratios from the local token values: light/dark text 14.28:1 / 16.46:1; muted text 6.37:1 / 8.92:1; primary action text 7.90:1 / 8.89:1; warning text 6.92:1 / 8.66:1; success text 6.52:1 / 8.09:1; failure text 6.50:1 / 7.45:1; surface border 3.89:1 / 4.04:1; focus indicator 5.75:1 / 9.59:1. These are calculations from the stated CSS colors, not a screen-reader or assistive-technology audit.

## Interaction and layout

Light, Dark, and System remain three native buttons. System is the initial preference, selection is stored locally when storage is available, OS appearance changes update System, exactly one button has `aria-pressed="true"`, and theme changes make no workflow request. Buttons are 44px tall, focus has a 3px visible outline, and status colors stay independent of the brand color. The existing self-hosted Vazirmatn font and Persian RTL layout remain in use.

At 320×640, 390×844, 768×1024, and 1440×900, the local browser showed the READY screen and a populated repair proposal without a visible horizontal scrollbar. The header action stays above the collapsed timeline; evidence and technical values continue to wrap or isolate directionally. Screenshots were captured inline during local browser inspection but were not saved as files.
