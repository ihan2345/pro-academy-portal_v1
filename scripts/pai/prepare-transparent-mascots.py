"""Prepare lossless animated WebP display copies from the supplied GIFs.
Only edge-connected, bright neutral matte pixels are removed. Source GIFs stay untouched.
Usage: python3 scripts/pai/prepare-transparent-mascots.py first.gif second.gif
Requires Pillow. Output is public/pai-mascots/{1,2}.webp and matching final PNGs.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageOps, ImageDraw

out = Path('public/pai-mascots')
out.mkdir(parents=True, exist_ok=True)
for number, filename in enumerate(sys.argv[1:], 1):
    frames, durations = [], []
    with Image.open(filename) as source:
        count = source.n_frames
        for index in range(count):
            source.seek(index)
            rgb = source.convert('RGB')
            r, g, b = rgb.split()
            low = ImageChops.darker(ImageChops.darker(r, g), b)
            high = ImageChops.lighter(ImageChops.lighter(r, g), b)
            neutral = ImageChops.subtract(high, low).point(lambda p: 255 if p <= 22 else 0)
            bright = low.point(lambda p: 255 if p >= 190 else 0)
            candidates = ImageChops.multiply(neutral, bright)
            connected = ImageOps.expand(candidates, border=1, fill=255)
            ImageDraw.floodfill(connected, (0, 0), 128)
            alpha = connected.crop((1, 1, rgb.width + 1, rgb.height + 1)).point(lambda p: 0 if p == 128 else 255)
            frame = rgb.convert('RGBA')
            frame.putalpha(alpha)
            frames.append(frame)
            durations.append(round((index + 1) * 5000 / count) - round(index * 5000 / count))
    frames[0].save(out / f'{number}.webp', save_all=True, append_images=frames[1:], duration=durations, loop=0, lossless=True, method=6)
    frames[-1].save(out / f'{number}-last.png')
    print(f'{number}: {count} frames, {sum(durations)}ms, alpha {frames[-1].getchannel("A").getextrema()}')
