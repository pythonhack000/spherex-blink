# SPHEREx Blink

A public web tool for the NASA Space Apps 2026 challenge "Planet X and SPHEREx".
Enter a sky position and watch SPHEREx images of that patch play like a little video,
so moving objects stand out, the way Pluto was found on a blink comparator.

## What it does

- Takes RA/Dec (decimal or sexagesimal) or an object name, with coordinates in the URL:
  `?ra=133.76&dec=-7.24&fov=0.1`, and `&embed=1` for embedding.
- Finds every SPHEREx exposure of the position, in all released quick releases. New releases
  are discovered from the archive's self-description, with no code change.
- Aligns each exposure on a common north-up grid and groups them into dated visits.
- Shows a video, a sum, or a difference against the first date.
- Browses all 102 bands, a false-colour composite, or all six detector arrays side by side.
- Compares any two dates side by side, with zoom and pan. Sharpening is for display only.
- Builds a spectrum or light curve on the fly for any clicked position. For saturated stars the
  light curve uses the PSF wings and is relative.
- Measures proper motion, and runs the same measurement on field stars as a control.
- Overlays Gaia DR3 stars moved to each date, and adds AllWISE from 2010 as an extra frame.
- Reports contamination flags, and can exclude flagged pixels.

## Test targets from the challenge

Barnard's Star, WISE 0855, Epsilon Indi B, RW Aurigae and R Draconis have one-click buttons.

## Limits

- Photometry is simple aperture photometry without aperture correction, and it does not separate
  close neighbours. WISE 0855 has a nearby star, so its short-wavelength flux is contaminated.
- Very bright stars saturate SPHEREx. Those points are flagged and their flux is unreliable.
- The first view of a new position waits for the IRSA cutout service. The picture fills in as
  exposures arrive, and later views come from the cache.
- A motion fit over about a year ignores parallax, which is small for these targets.

## Where it runs

The public site is on GitHub Pages: https://pythonhack000.github.io/spherex-blink/

The five challenge targets ship as static files in `static/data`, and spectra and motion run in the
browser, so they open at once with no server. Any other position is downloaded live by the FastAPI
server on the free Render plan (`render.yaml`), which sleeps after 15 minutes without traffic and
takes about a minute to wake. The `Bake frames` GitHub Action rebuilds the data weekly, which also
picks up new SPHEREx releases.

## Run locally

    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/uvicorn backend.api:app --port 8765

Tests: `.venv/bin/python -m pytest` and `node --test tests/*.mjs`.

## Data

NASA SPHEREx, AllWISE and ESA Gaia DR3, served by NASA/IPAC IRSA. Sky map by Aladin Lite (CDS).
