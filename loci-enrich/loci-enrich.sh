#!/bin/sh
# Fills empty book fields in the data repository named in config.json.
cd "$(dirname "$0")" && node loci-enrich.mjs "$@"
