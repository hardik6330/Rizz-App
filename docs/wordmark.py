#!/usr/bin/env python3
"""Regenerate assets/icons/wordmark.png — the splash lockup's app name.

    curl -sSL -o cd.zip https://api.fontshare.com/v2/fonts/download/clash-display
    unzip -q cd.zip -d cd
    pip install pillow
    python3 docs/wordmark.py cd/ClashDisplay_Complete/Fonts/OTF/ClashDisplay-Semibold.otf

**The font is not in this repo, and must not be added to it.** Clash Display is
free for commercial use in apps, but the Fontshare EULA forbids modifying the
font software (so the file cannot be subsetted) and grants embedding only in
read-only documents — while explicitly permitting you to "use the Font Software
to create logos and other graphic elements [and] static images". This rendered
PNG is squarely inside that grant. A `.ttf` bundled in an APK, extractable by
anyone who unzips it, is not clearly inside it.

Shipping a picture instead of a font is also the better build: `expo-font` loads
asynchronously, and a font load gating the splash animation would make the
splash take longer in order to look nicer.

If the output size changes, update NAME_RATIO in components/SplashIntro.tsx —
it is the source aspect ratio and the lockup's geometry is derived from it.
"""

import sys

from PIL import Image, ImageDraw, ImageFont

TEXT = "RizzCoach"
# 160px renders ~5x the 30pt on-screen height, so it stays crisp at 3x density.
SIZE = 160
# palette.textPrimary. The splash ground is palette.ink, so this is the same
# near-white every other headline in the app uses, not a pure #FFF.
COLOR = (247, 247, 250, 255)
OUT = "assets/icons/wordmark.png"


def main(font_path: str) -> None:
    font = ImageFont.truetype(font_path, SIZE)
    pad = 40
    # Draw onto a canvas comfortably larger than the text, then crop to the
    # alpha bounding box: PIL's text metrics include font-wide ascent/descent,
    # which would bake uneven transparent padding into the asset and throw the
    # lockup's centring off by a few points.
    canvas = Image.new("RGBA", (SIZE * len(TEXT) + pad * 2, SIZE * 2), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text((pad, pad), TEXT, font=font, fill=COLOR)
    box = canvas.getbbox()
    if box is None:
        raise SystemExit("nothing rendered — check the font path")
    out = canvas.crop(box)
    out.save(OUT)
    w, h = out.size
    print(f"{OUT}  {w}x{h}  NAME_RATIO = {w / h:.4f}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
