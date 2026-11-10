#!/bin/sh
# The daily backup of My Loci Library (see the tools README). Add --archive /media/drive for the yearly archive.
cd "$(dirname "$0")" && node loci-backup.mjs "$@"
