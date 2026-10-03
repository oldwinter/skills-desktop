# Check the refined interfaces

Run commands from the repository root after `npm ci`.

## Website

Install `agent-browser` and its Chromium runtime. Start the website in a
separate terminal:

```sh
npm run dev --workspace @skills-desktop/website -- --host 127.0.0.1 --port 4173
node tests/ui-craft/website.mjs
```

Set `UI_CRAFT_URL` to check another local server, including a production preview.
The check uses its own browser session and closes it on completion. It checks
English and Chinese at 1440, 1024, and 390 pixels, image loading, anchors,
WCAG-tagged axe rules, demo selection, mobile menu focus restoration, CLI tab
keyboard navigation, and clipboard feedback. It follows no external download
links and submits no data.

## Packaged desktop

Build and package for the current platform:

```sh
npm run build
npm run package --workspace @skills-desktop/desktop
node tests/ui-craft/desktop.mjs
npm run qa:packaged-ui
```

On a headless Linux host, run the last two commands through `xvfb-run -a`.
The checks reuse the isolated packaged QA fixture and its stub CLI. They do not
read or mutate the developer's installed skills.

The craft check visits all eight routes at 1440, 1024, and 390 pixels. It checks
horizontal overflow, visible headings, non-collapsing search controls, and
unclipped evidence inside the inspector's single scroll area. It also checks
inventory accessibility in light, dark, and high-contrast modes. The existing
packaged suite covers bilingual preferences, native review, keyboard workflows,
forced colors, reduced motion, empty and error states, and renderer errors.

Both craft checks write screenshots and measurements to the ignored
`visual-qa/dual-ui/` directory. Review the images as well as command results;
automated checks do not establish aesthetic quality or award eligibility.
