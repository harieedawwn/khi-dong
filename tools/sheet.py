# ghép shots/sheet/*.png thành docs/contact-sheet.png (3 x 2, có nhãn)
import json
from PIL import Image, ImageDraw, ImageFont
L = json.load(open('shots/sheet/list.json'))
W, H = 800, 500
im = Image.new('RGB', (W * 3, H * 2), (20, 22, 26))
try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception: f = ImageFont.load_default()
d = ImageDraw.Draw(im)
for i, (p, label) in enumerate(L):
    x, y = (i % 3) * W, (i // 3) * H
    im.paste(Image.open(p).convert('RGB'), (x, y))
    d.rectangle([x + 10, y + 10, x + 10 + 12 * len(label) + 16, y + 44], fill=(20, 22, 26)); d.text((x + 18, y + 14), label, fill=(240, 236, 226), font=f)
im.save('docs/contact-sheet.png', optimize=True); print('docs/contact-sheet.png', im.size)
