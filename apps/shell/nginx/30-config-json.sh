#!/bin/sh
# Runs before nginx starts: the remote entries come from the container's environment, not the bundle.
set -eu
envsubst '${PEOPLE_REMOTE_ENTRY} ${DELIVERY_REMOTE_ENTRY}' \
  < /etc/baseline/config.json.template \
  > /usr/share/nginx/html/config.json
echo "30-config-json.sh: remotes -> ${PEOPLE_REMOTE_ENTRY}, ${DELIVERY_REMOTE_ENTRY}"
