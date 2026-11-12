#!/bin/sh
# Checks that the book sources still answer as recorded (SOURCES.md).
cd "$(dirname "$0")" && node check-sources.mjs "$@"
