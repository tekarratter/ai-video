#!/usr/bin/env python3
"""Image helpers for analysing a reference video (Pillow only, CPU).

  reference.py palette <img> [<img> ...]          -> JSON {"<img>": {"colors": ["#rrggbb", ...], "luma": 0..1, "sat": 0..1}}
  reference.py sheet <spec.json> <out.jpg>         -> labelled contact sheet

spec.json: {"cols": 4, "cell": 360, "title": "...", "items": [{"img": "a.jpg", "label": "00:03.2 · Mở đầu", "text": "lời nói…"}]}
"""
import json, os, sys

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

from PIL import Image, ImageDraw, ImageFont, ImageStat


def font(size, bold=False):
    names = (["arialbd.ttf", "DejaVuSans-Bold.ttf"] if bold else []) + ["arial.ttf", "segoeui.ttf", "DejaVuSans.ttf", "NotoSans-Regular.ttf"]
    dirs = [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"), "/usr/share/fonts/truetype/dejavu",
            "/usr/share/fonts/truetype/noto", "/usr/share/fonts/TTF", "/System/Library/Fonts/Supplemental", "/Library/Fonts"]
    for n in names:
        for d in dirs:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default(size=size)


def palette(path, n=5):
    im = Image.open(path).convert("RGB")
    im.thumbnail((160, 160))
    q = im.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: n * 3]
    counts = sorted(q.getcolors() or [], reverse=True)
    colors = ["#%02x%02x%02x" % tuple(pal[i * 3: i * 3 + 3]) for _, i in counts if i < n]
    luma = ImageStat.Stat(im.convert("L")).mean[0] / 255
    sat = ImageStat.Stat(im.convert("HSV")).mean[1] / 255
    return {"colors": colors, "luma": round(luma, 3), "sat": round(sat, 3)}


def wrap(draw, text, f, width, max_lines):
    words, lines, cur = (text or "").split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            if cur: lines.append(cur)
            cur = w
        if len(lines) == max_lines: break
    if cur and len(lines) < max_lines: lines.append(cur)
    if len(lines) == max_lines and " ".join(lines) != " ".join(words):
        lines[-1] = lines[-1].rstrip(".,") + "…"
    return lines


def sheet(spec, out):
    items, cols, cell = spec["items"], int(spec.get("cols", 4)), int(spec.get("cell", 360))
    if not items: raise SystemExit("sheet: no items")
    if len(items) < cols:  # few shots: fewer, bigger cells instead of an empty half-sheet
        cell = int(cell * min(1.6, cols / len(items)))
        cols = len(items)
    ims = [Image.open(it["img"]).convert("RGB") for it in items]
    ratio = ims[0].height / ims[0].width
    ih = int(cell * ratio)
    fl, ft, fh = font(max(14, cell // 18), bold=True), font(max(13, cell // 21)), font(max(18, cell // 12), bold=True)
    th = (fl.size + 6) + 3 * (ft.size + 4) + 10  # label + 3 lines of words
    pad, head = 10, (fh.size + 24 if spec.get("title") else 0)
    rows = (len(items) + cols - 1) // cols
    W, H = pad + cols * (cell + pad), head + pad + rows * (ih + th + pad)
    can = Image.new("RGB", (W, H), (18, 18, 22))
    d = ImageDraw.Draw(can)
    if head: d.text((pad, 12), spec["title"], font=fh, fill=(255, 255, 255))
    for k, (it, im) in enumerate(zip(items, ims)):
        x, y = pad + (k % cols) * (cell + pad), head + pad + (k // cols) * (ih + th + pad)
        can.paste(im.resize((cell, ih)), (x, y))
        if it.get("colors"):  # palette strip along the bottom of the frame
            sw = cell // len(it["colors"])
            for j, c in enumerate(it["colors"]):
                d.rectangle([x + j * sw, y + ih - 8, x + (j + 1) * sw, y + ih], fill=c)
        d.text((x, y + ih + 4), it.get("label", ""), font=fl, fill=(255, 214, 102))
        for j, line in enumerate(wrap(d, it.get("text", ""), ft, cell, 3)):
            d.text((x, y + ih + 8 + fl.size + j * (ft.size + 4)), line, font=ft, fill=(225, 225, 230))
    can.save(out, quality=86)
    print(out)


def shots(src, fps=8, w=64):
    """Shot changes, hard cuts and gradual ones (fades, dissolves, slides) alike.
    ffmpeg's scene score compares neighbouring frames only, so a 0.5 s cross-fade or a Ken Burns photo
    sequence scores low everywhere. Here every frame is compared with the one 1 step and 4 steps
    (0.5 s) earlier on a tiny grey copy; a change is a local peak well above the video's own baseline."""
    import subprocess
    import numpy as np
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip().split(",")
    sw, sh = int(probe[0]), int(probe[1])
    h = max(2, int(round(w * sh / sw / 2)) * 2)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", src, "-an", "-vf", f"fps={fps},scale={w}:{h},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    n = len(raw) // (w * h)
    if n < 3: return []
    f = np.frombuffer(raw[: n * w * h], dtype=np.uint8).reshape(n, h, w).astype(np.float32) / 255
    # also compare coarse layout (4x4 blocks) so a moving subject inside one shot counts less than a new picture
    blocks = f[:, : h // 4 * 4, : w // 4 * 4].reshape(n, 4, h // 4, 4, w // 4).mean(axis=(2, 4))
    lag = 4
    d1 = np.zeros(n); d4 = np.zeros(n)
    d1[1:] = np.abs(f[1:] - f[:-1]).mean(axis=(1, 2))
    d4[lag:] = 0.5 * np.abs(f[lag:] - f[:-lag]).mean(axis=(1, 2)) + 0.5 * np.abs(blocks[lag:] - blocks[:-lag]).mean(axis=(1, 2))
    base1, base4 = float(np.median(d1[1:])), float(np.median(d4[lag:])) if n > lag else 0.0
    hard_thr = max(0.11, base1 * 5)
    soft_thr = max(0.06, base4 * 3)
    cuts = []
    for i in range(1, n):  # hard cuts
        if d1[i] > hard_thr and d1[i] >= d1[max(0, i - 2): i + 3].max():
            cuts.append((i / fps, float(d1[i]), "cut"))
    for i in range(lag, n):  # gradual: peak of the 0.5 s difference, not already explained by a hard cut
        if d4[i] > soft_thr and d4[i] >= d4[max(lag, i - lag): i + lag + 1].max():
            t = (i - lag / 2) / fps  # middle of the transition window
            if all(abs(t - c[0]) > 0.6 for c in cuts):
                cuts.append((t, float(d4[i]), "transition"))
    cuts.sort()
    return [{"t": round(t, 3), "score": round(s, 3), "kind": k} for t, s, k in cuts]


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "shots":
        print(json.dumps(shots(args[0])))
    elif cmd == "palette":
        print(json.dumps({p: palette(p) for p in args}, ensure_ascii=False))
    elif cmd == "sheet":
        with open(args[0], encoding="utf-8") as f:
            sheet(json.load(f), args[1])
    else:
        raise SystemExit(__doc__)
