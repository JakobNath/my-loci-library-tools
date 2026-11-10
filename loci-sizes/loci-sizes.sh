#!/bin/sh
# Fills catalog heights in the data repository named in config.json.
cd "$(dirname "$0")" && node loci-sizes.mjs "$@"
