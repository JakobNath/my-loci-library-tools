#!/bin/sh
# Copies core/ and sets/ from the app repository (expected next to this one).
cd "$(dirname "$0")" && node update-core.mjs
