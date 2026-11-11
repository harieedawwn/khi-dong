# PNG nền trong (shots/thumbs) -> assets/thumbs/<id>.webp: cắt sát vật, khung 256x160, chất lượng giảm dần tới khi <= 8 KB
import sys, io
from PIL import Image
for id in sys.argv[1:]:
    im = Image.open(f'shots/thumbs/{id}.png').convert('RGBA'); bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, im.width, im.height)
    c = im.crop(bb); W, H, m = 256, 160, 10; k = min((W - 2 * m) / c.width, (H - 2 * m) / c.height); c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0)); out.alpha_composite(c, ((W - c.width) // 2, (H - c.height) // 2))
    for q in (90, 82, 74, 66, 58, 50, 40, 30):
        b = io.BytesIO(); out.save(b, 'WEBP', quality=q, method=6)
        if b.tell() <= 8000: break
    open(f'assets/thumbs/{id}.webp', 'wb').write(b.getvalue()); print(id, b.tell(), 'B q', q)
