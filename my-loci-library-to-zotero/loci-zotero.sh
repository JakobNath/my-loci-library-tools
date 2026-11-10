#!/bin/sh
# Sends the catalog one way into Zotero (see the tools README).
cd "$(dirname "$0")" && node loci-zotero.mjs "$@"
