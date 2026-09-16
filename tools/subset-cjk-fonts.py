#!/usr/bin/env python3
"""Regenerate the checked-in Noto Serif CJK SC GB2312 subsets.

Source fonts (Debian fonts-noto-cjk package):
  /usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc
  /usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc
Face index 2 = Noto Serif CJK SC.
Charset: GB2312 (6763 hanzi) plus font-cmap punctuation/fullwidth blocks
(U+00B0-BF, U+2010-203B, U+2460-24FF, U+3000-303F, U+FF00-FFEF) and ASCII.
HarfBuzz subset flags: no-hinting | no-layout-closure (0x201).
Outputs: rust/typst-abi/fonts/NotoSerifCJKsc-{Regular,Bold}-GB2312.otf
"""
import ctypes as C
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "rust" / "typst-abi" / "fonts"
SOURCES = {
    "Regular": Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
    "Bold": Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"),
}
SC_INDEX = 2
FLAGS = 0x201
PUNCT_BLOCKS = ((0x00B0, 0x00BF), (0x2010, 0x203B), (0x2460, 0x24FF),
                (0x3000, 0x303F), (0xFF00, 0xFFEF))


def proto(lib, name, restype, *argtypes):
    fn = getattr(lib, name)
    fn.restype = restype
    fn.argtypes = argtypes
    return fn


hb = C.CDLL("libharfbuzz.so.0")
hbs = C.CDLL("libharfbuzz-subset.so.0")
blob_from_file = proto(hbs, "hb_blob_create_from_file_or_fail", C.c_void_p, C.c_char_p)
blob_get_data = proto(hbs, "hb_blob_get_data", C.POINTER(C.c_char), C.c_void_p, C.POINTER(C.c_uint))
blob_destroy = proto(hbs, "hb_blob_destroy", None, C.c_void_p)
face_create = proto(hbs, "hb_face_create", C.c_void_p, C.c_void_p, C.c_uint)
face_destroy = proto(hbs, "hb_face_destroy", None, C.c_void_p)
face_reference_blob = proto(hbs, "hb_face_reference_blob", C.c_void_p, C.c_void_p)
face_collect_unicodes = proto(hb, "hb_face_collect_unicodes", None, C.c_void_p, C.c_void_p)
set_create = proto(hb, "hb_set_create", C.c_void_p)
set_add = proto(hb, "hb_set_add", None, C.c_void_p, C.c_uint)
set_destroy = proto(hb, "hb_set_destroy", None, C.c_void_p)
set_population = proto(hb, "hb_set_get_population", C.c_uint, C.c_void_p)
set_next_many = proto(hb, "hb_set_next_many", C.c_uint, C.c_void_p, C.c_uint, C.POINTER(C.c_uint), C.c_uint)
input_create = proto(hbs, "hb_subset_input_create_or_fail", C.c_void_p)
input_unicode_set = proto(hbs, "hb_subset_input_unicode_set", C.c_void_p, C.c_void_p)
input_set_flags = proto(hbs, "hb_subset_input_set_flags", None, C.c_void_p, C.c_uint)
input_destroy = proto(hbs, "hb_subset_input_destroy", None, C.c_void_p)
subset_or_fail = proto(hbs, "hb_subset_or_fail", C.c_void_p, C.c_void_p, C.c_void_p)
font_create = proto(hb, "hb_font_create", C.c_void_p, C.c_void_p)
font_destroy = proto(hb, "hb_font_destroy", None, C.c_void_p)
nominal_glyph = proto(hb, "hb_font_get_nominal_glyph", C.c_int, C.c_void_p, C.c_uint, C.POINTER(C.c_uint))


def codepoints_of(face):
    values = set_create()
    face_collect_unicodes(face, values)
    count = set_population(values)
    output = (C.c_uint * count)()
    got = set_next_many(values, 0xFFFFFFFF, output, count)
    set_destroy(values)
    return set(output[:got])


def charset(face):
    gb2312 = set()
    for lead in range(0xA1, 0xF8):
        for trail in range(0xA1, 0xFF):
            try:
                gb2312.add(ord(bytes((lead, trail)).decode("gb2312")))
            except UnicodeDecodeError:
                continue
    punctuation = {cp for cp in codepoints_of(face)
                   if any(start <= cp <= end for start, end in PUNCT_BLOCKS)}
    return sorted(gb2312 | punctuation | set(range(0x20, 0x7F)))


def subset(source, codepoints, destination):
    blob = blob_from_file(str(source).encode())
    face = face_create(blob, SC_INDEX)
    inp = input_create()
    input_set_flags(inp, FLAGS)
    values = input_unicode_set(inp)
    for cp in codepoints:
        set_add(values, cp)
    output_face = subset_or_fail(face, inp)
    output_blob = face_reference_blob(output_face)
    length = C.c_uint(0)
    data = blob_get_data(output_blob, C.byref(length))
    destination.write_bytes(C.string_at(data, length.value))
    for fn, obj in ((blob_destroy, output_blob), (face_destroy, output_face),
                    (input_destroy, inp), (face_destroy, face), (blob_destroy, blob)):
        fn(obj)
    return length.value


def verify_coverage(path, codepoints):
    blob = blob_from_file(str(path).encode())
    face = face_create(blob, 0)
    font = font_create(face)
    gid = C.c_uint(0)
    missing = [cp for cp in codepoints
               if not nominal_glyph(font, cp, C.byref(gid)) or gid.value == 0]
    font_destroy(font)
    face_destroy(face)
    blob_destroy(blob)
    return missing


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for path in SOURCES.values():
        if not path.exists():
            raise SystemExit(f"source font not found: {path}")
        print(f"{path} sha256={hashlib.sha256(path.read_bytes()).hexdigest()}")
    source_blob = blob_from_file(str(SOURCES["Regular"]).encode())
    source_face = face_create(source_blob, SC_INDEX)
    codepoints = charset(source_face)
    face_destroy(source_face)
    blob_destroy(source_blob)
    print(f"charset: {len(codepoints)} codepoints")
    for weight, source in SOURCES.items():
        destination = OUT / f"NotoSerifCJKsc-{weight}-GB2312.otf"
        size = subset(source, codepoints, destination)
        missing = verify_coverage(destination, codepoints)
        if missing:
            raise SystemExit(f"{destination.name}: missing {len(missing)} glyphs: {missing[:8]}")
        print(f"{destination.name}: {size} bytes, coverage 0 missing")


if __name__ == "__main__":
    main()
