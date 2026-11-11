import json
from PIL import Image
d = json.load(open('shots/look/list.json')); rows, px, out = d['rows'], d['px'], d['out']
im = Image.new('RGB', (px * len(rows[0]), px * len(rows)), (217, 219, 222))
for r, files in enumerate(rows):
    for c, f in enumerate(files):
        t = Image.open(f).convert('RGBA'); bg = Image.new('RGBA', t.size, (217, 219, 222, 255)); bg.alpha_composite(t); im.paste(bg.convert('RGB'), (c * px, r * px))
im.save(out); print(out, im.size)
