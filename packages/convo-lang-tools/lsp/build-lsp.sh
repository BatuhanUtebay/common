#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d 'server/node_modules' ]; then
    cd server
    npm i
    cd ..
fi
if [ ! -d 'client/node_modules' ]; then
    cd client
    npm i
    cd ..
fi

npx esbuild \
    server/src/server.ts \
    --platform=node \
    --format=cjs \
    --bundle \
    --packages=external \
    --tree-shaking=true\
    --outfile=server/out/server.js

npx esbuild \
    client/src/extension.ts \
    --platform=node \
    --format=cjs \
    --tree-shaking=true\
    --bundle \
    --packages=external \
    --external:'vscode' \
    --external:'path' \
    --outfile=client/out/extension.js
