#!/usr/bin/env python3
"""Zip / unzip with UTF-8 file names (Vietnamese "ảnh đẹp.jpg" etc.) — used on Windows, which has no Info-ZIP
and whose built-in tar.exe crashes on non-ASCII names.
   ziputil.py zip <folder>              → zip of the folder's contents to stdout (follows symlinks/junctions)
   ziputil.py unzip <file.zip> <dir>    → extract; entries escaping <dir> (../, absolute paths) are refused"""
import os
import sys
import zipfile

STORED_EXT = {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic',
              '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wav', '.zip'}


class _Out:
    """Non-seekable wrapper around stdout so zipfile writes data descriptors (streaming)."""
    def __init__(self, f):
        self.f, self.n = f, 0

    def write(self, b):
        self.f.write(b)
        self.n += len(b)
        return len(b)

    def tell(self):
        return self.n

    def flush(self):
        self.f.flush()


def do_zip(folder):
    out = _Out(sys.stdout.buffer)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, dirs, files in os.walk(folder, followlinks=True):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, folder).replace(os.sep, '/')
                ext = os.path.splitext(name)[1].lower()
                z.write(full, rel, zipfile.ZIP_STORED if ext in STORED_EXT else zipfile.ZIP_DEFLATED)
    out.flush()


def do_unzip(file, dest):
    dest = os.path.realpath(dest)
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(file) as z:
        for info in z.infolist():
            name = info.filename.replace('\\', '/')
            target = os.path.realpath(os.path.join(dest, name))
            if os.path.isabs(name) or not (target == dest or target.startswith(dest + os.sep)):
                print(f'skip unsafe entry: {info.filename}', file=sys.stderr)
                continue
            z.extract(info, dest)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'zip':
        do_zip(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == 'unzip':
        do_unzip(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
