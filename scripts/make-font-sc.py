# 生成官网标题用的中文衬线字体 site/font/MituanSerifSC.woff2：思源宋体（Noto Serif SC）里只保留官网标题用到的汉字。
# 标题指 site/*.html 里 h1、h2、h3、summary、dt、th、strong 中的文字；官网 CSS 只让这些元素用这款字体（--display）。
# 改了这些元素里的中文后要重新生成，否则新字会落到系统字体上、和其他字不一样。build-site.sh 会用 chars.txt 检查漏字。
# 用法（需要 fonttools 和 brotli，建议装在单独的虚拟环境里）：
#   python3 scripts/make-font-sc.py NotoSerifSC[wght].ttf
#   python3 scripts/make-font-sc.py --check      只检查有没有字体里没有的新字（只用标准库，build-site.sh 调用）
# 输入文件取自 https://github.com/google/fonts/tree/main/ofl/notoserifsc 。
# 修改版改名为 Mituan Serif SC，与原字体区分；版权和许可说明原样保留，见 site/font/OFL.txt。
import os
import sys
from html.parser import HTMLParser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SITE = os.path.join(ROOT, 'site')
OUT = os.path.join(SITE, 'font')
TAGS = {'h1', 'h2', 'h3', 'summary', 'dt', 'th', 'strong'}
WEIGHT = 600


def is_cjk(ch):
    o = ord(ch)
    return 0x2E80 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF or 0xFF00 <= o <= 0xFFEF or 0x3000 <= o <= 0x303F or ch in '“”‘’…—·'


class Collect(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.chars = set()

    def handle_starttag(self, tag, attrs):
        if tag in TAGS:
            self.depth += 1

    def handle_endtag(self, tag):
        if tag in TAGS and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.chars.update(ch for ch in data if is_cjk(ch))


def heading_chars():
    c = Collect()
    for name in sorted(os.listdir(SITE)):
        if name.endswith('.html'):
            with open(os.path.join(SITE, name), encoding='utf-8') as f:
                c.feed(f.read())
    return ''.join(sorted(c.chars))


def check():
    with open(os.path.join(OUT, 'chars.txt'), encoding='utf-8') as f:
        have = set(f.read().strip())
    missing = ''.join(sorted(set(heading_chars()) - have))
    if missing:
        sys.exit(f'标题里有中文衬线字体没有的字：{missing}\n重新生成：python3 scripts/make-font-sc.py NotoSerifSC[wght].ttf')


def build(src):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    chars = heading_chars()
    font = TTFont(src)
    font = instancer.instantiateVariableFont(font, {'wght': WEIGHT})
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    for rec in font['name'].names:
        t = rec.toUnicode()
        n = t.replace('Noto Serif SC', 'Mituan Serif SC').replace('NotoSerifSC', 'MituanSerifSC')
        if n != t:
            rec.string = n
    font['name'].setName('Mituan Serif SC is a subset of Noto Serif SC (SIL OFL 1.1) for the headings of tracker.eonmaze.com, renamed as the OFL requires.', 10, 3, 1, 0x409)
    font.flavor = 'woff2'
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, 'MituanSerifSC.woff2')
    font.save(out)
    with open(os.path.join(OUT, 'chars.txt'), 'w', encoding='utf-8') as f:
        f.write(chars + '\n')
    print(out, len(chars), '字', os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    check() if sys.argv[1] == '--check' else build(sys.argv[1])
