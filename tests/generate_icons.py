"""Generate bundled icons without fonts or external media. Requires Pillow."""
from PIL import Image, ImageDraw
import math
from pathlib import Path
OUT=Path(__file__).resolve().parents[1]/'web'/'assets'
for size in (192,512):
    scale=4
    image=Image.new('RGB',(size*scale,size*scale),'#245b43')
    draw=ImageDraw.Draw(image)
    for base in (.46,.61):
        points=[]
        for index in range(401):
            x=.19+.62*index/400
            y=base-.11*math.sin(index/400*math.pi*4)
            points.append((round(x*size*scale),round(y*size*scale)))
        draw.line(points,fill='#fffef5',width=round(size*scale*.047),joint='curve')
    image.resize((size,size),Image.Resampling.LANCZOS).save(OUT/f'icon-{size}.png')
    print(f'Generated {OUT/f"icon-{size}.png"}')
