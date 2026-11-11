import json
from PIL import Image, ImageDraw, ImageFont
d = json.load(open('shots/look/list.json')); rows, px, out, grid, ids = d['rows'], d['px'], d['out'], d.get('grid', 0), d.get('ids', [])
BG = (217, 219, 222)
if grid:  # lưới các mô hình (một hướng nhìn mỗi ô), có nhãn id
    n = len(rows); cols = grid; rws = (n + cols - 1) // cols; im = Image.new('RGB', (px * cols, px * rws), BG); dr = ImageDraw.Draw(im)
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
    except Exception: f = ImageFont.load_default()
    for i, files in enumerate(rows):
        t = Image.open(files[0]).convert('RGBA'); bg = Image.new('RGBA', t.size, BG + (255,)); bg.alpha_composite(t); x, y = (i % cols) * px, (i // cols) * px
        im.paste(bg.convert('RGB'), (x, y)); dr.text((x + 10, y + 8), ids[i], fill=(40, 44, 50), font=f)
    im.save(out, optimize=True); print(out, im.size); raise SystemExit
im = Image.new('RGB', (px * len(rows[0]), px * len(rows)), BG)
for r, files in enumerate(rows):
    for c, f in enumerate(files):
        t = Image.open(f).convert('RGBA'); bg = Image.new('RGBA', t.size, BG + (255,)); bg.alpha_composite(t); im.paste(bg.convert('RGB'), (c * px, r * px))
im.save(out); print(out, im.size)
