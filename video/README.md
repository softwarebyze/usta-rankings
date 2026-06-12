# Baseline demo video (Remotion)

15-second motion graphic highlighting Baseline features, using **Zachary Ebenfeld** as the example player (career-best ranks from production data).

## Preview

```bash
cd video
npm run studio
```

Opens Remotion Studio at `BaselineDemo` composition (1920×1080, 30fps, 15s).

## Render

```bash
cd video
npm run render          # → out/baseline-demo.mp4
npm run render:gif      # → out/baseline-demo.gif
```

Requires ffmpeg (bundled by Remotion on first render).

## Scenes

1. **Title** — Baseline wordmark
2. **Features** — search, doubles, season overlay, hover context, USTA links
3. **Best cards** — Ebenfeld career-best per bracket (#3 10s … #61 18s)
4. **Chart** — animated ranking trajectory mock

Data source: `docs/VERIFICATION.md` and production DB player id 1.
