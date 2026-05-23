# Tilecraft — Positioning

**Date:** 2026-05-23

## Pitch
The easiest way to put a beautiful, branded map on a Framer or Webflow site. No Google Cloud, no API keys, no JSON.

## Audience
Framer + Webflow designers. Visual-first, code-curious, allergic to backend setup.

## Beginner → Pro ladder
| Tier | What they do | What they get |
|---|---|---|
| Beginner | Pick preset → set address → pick brand color | Framer / Webflow embed |
| Intermediate | Tweak 4–6 controls (water, roads, land, labels, density) | Same + saved URL |
| Pro *(v2)* | Full MapLibre layer editor + expressions | Same + raw style JSON |

Same canvas, "Pro mode" toggle. Not separate apps.

## Hard rules
1. Zero accounts to ship a working embed.
2. Zero user-supplied API keys, ever.
3. One canvas, two modes.
4. Copy-paste output is the success metric.
5. Mobile preview is a tab, not an afterthought.

## v1 scope
- ~25 hand-built MapLibre presets (dark/light/minimal/retro/blueprint/mono/brand-color generators)
- Address search, brand color picker, density slider, label toggle
- Two exports: Framer Code Component URL, Webflow `<script>` snippet
- URL-encoded state + localStorage history

## Not v1
Accounts. Markers/POI. Pro layer editor. Snazzy→MapLibre converter. Custom fonts/sprites. Mobile SDK exports.

## Where we win
*Beginner-friendly* and *native Framer/Webflow output*. Two cells nobody else owns.
