#!/bin/sh
# Imports a Logos Library export: logos-import.sh /path/to/Library.csv [--full]
cd "$(dirname "$0")" && node logos-import.mjs "$@"
