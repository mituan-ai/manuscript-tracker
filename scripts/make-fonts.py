# 生成 ui/fonts/ 里的 Mituan Serif：Source Serif 4 可变字体的西文子集。
# 用法（需要 fonttools 和 brotli，建议装在单独的虚拟环境里）：
#   python3 scripts/make-fonts.py SourceSerif4Variable-Roman.ttf.woff2 SourceSerif4Variable-Italic.ttf.woff2
# 两个输入文件取自 https://github.com/adobe-fonts/source-serif/releases （4.005R，WOFF2/VAR/ 目录）。
# 「Source」是保留字体名称，修改版按 OFL 第 3 条改名；版权、商标和许可说明原样保留。
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = os.path.join(os.path.dirname(__file__), '..', 'ui', 'fonts')
UNICODES = ('U+0020-007E,U+00A0-017F,U+0192,U+0218-021B,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0304,U+0308,U+030A,U+030C,U+0327,'
            'U+1E9E,U+2000-206F,U+2070-209F,U+20AC,U+2116,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD')
# 正体保留光学尺寸（大标题用展示字形、小字用正文字形）；斜体只用于小字号的期刊名，固定光学尺寸以减小体积
LIMITS = {'Roman': {'wght': (400, 700)}, 'Italic': {'wght': (400, 600), 'opsz': 16}}


def build(src, style):
    font = TTFont(src)
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    font = instancer.instantiateVariableFont(font, LIMITS[style])
    for rec in font['name'].names:
        if rec.nameID in (0, 7, 13, 14):
            continue
        t = rec.toUnicode()
        n = t.replace('Source Serif 4', 'Mituan Serif').replace('SourceSerif4', 'MituanSerif').replace('Source Serif', 'Mituan Serif')
        if n != t:
            rec.string = n
    font['name'].setName('Mituan Serif is a Latin subset of Source Serif 4 4.005 (Adobe, SIL OFL 1.1), renamed as the OFL requires.', 10, 3, 1, 0x409)
    font.flavor = 'woff2'
    out = os.path.join(OUT, f'MituanSerif-{style}.woff2')
    font.save(out)
    print(out, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    build(sys.argv[1], 'Roman')
    build(sys.argv[2], 'Italic')
