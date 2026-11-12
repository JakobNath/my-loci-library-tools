#!/bin/sh
# The admin page of My Loci Library (see the tools README): opens it in the browser. Press Ctrl+C to stop it.
cd "$(dirname "$0")" && node admin.mjs "$@"
