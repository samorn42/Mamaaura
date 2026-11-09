"""Prototip sayfasından stil dosyasını ve logoları üretir. Kullanım: python3 tools/varliklar.py <prototip.html>"""
import base64, io, re, sys
from pathlib import Path
from PIL import Image

src = Path(sys.argv[1]).read_text(encoding='utf8')
pub = Path(__file__).resolve().parent.parent / "docs"
css = re.search(r'<style>(.*?)</style>', src, re.S).group(1)
uris = re.findall(r'url\("(data:image/png;base64,[^"]+)"\)', css)
assert len(uris) == 2
for uri, name in zip(uris, ('logo-acik.png', 'logo-koyu.png')):
    (pub / name).write_bytes(base64.b64decode(uri.split(',', 1)[1]))
    css = css.replace(uri, name)
(pub / 'app.css').write_text(css.strip() + '\n\n' + (pub / 'ek.css').read_text(encoding='utf8'), encoding='utf8')

# Ana ekran simgesi: beyaz kare üzerinde logo
logo = Image.open(pub / 'logo-acik.png')
for size in (192, 512):
    icon = Image.new('RGB', (size, size), 'white')
    w = int(size * .8); l = logo.resize((w, round(w * logo.height / logo.width)), Image.LANCZOS)
    icon.paste(l, ((size - w) // 2, (size - l.height) // 2), l)
    icon.save(pub / f'simge-{size}.png', optimize=True)
print('tamam', len(css))
