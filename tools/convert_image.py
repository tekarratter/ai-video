#!/usr/bin/env python3
"""Convert any image Pillow can open (incl. HEIC/HEIF via pillow-heif) to a browser-friendly JPG/PNG.
   convert_image.py <input> <output> [--max 3840]"""
import argparse
from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

ap = argparse.ArgumentParser()
ap.add_argument("input")
ap.add_argument("output")
ap.add_argument("--max", type=int, default=3840)
a = ap.parse_args()

im = ImageOps.exif_transpose(Image.open(a.input))
im.thumbnail((a.max, a.max), Image.LANCZOS)
if a.output.lower().endswith(".png"):
    im.save(a.output, optimize=True)
else:
    im.convert("RGB").save(a.output, quality=92, optimize=True)
print(f"{im.width}x{im.height}")
