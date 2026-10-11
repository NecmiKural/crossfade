#!/bin/sh
# Renders the bootstrap with the xDS token, so the token never appears on the process command line,
# then hands over to the image entrypoint, which drops to the envoy user.
set -eu

bootstrap="${ENVOY_BOOTSTRAP:-envoy.yaml}"
case "$bootstrap" in
  envoy.yaml | envoy.behind-proxy.yaml) ;;
  *) echo "crossfade: ENVOY_BOOTSTRAP must be envoy.yaml or envoy.behind-proxy.yaml" >&2; exit 1 ;;
esac

token=$(cat /run/crossfade/xds_token)
case "$token" in
  "" | *[!A-Za-z0-9]*) echo "crossfade: /run/crossfade/xds_token must be a non-empty alphanumeric string" >&2; exit 1 ;;
esac

umask 077
sed "s/__XDS_TOKEN__/$token/g" "/etc/envoy/$bootstrap" > /tmp/envoy.yaml
chown envoy:envoy /tmp/envoy.yaml
exec /docker-entrypoint.sh envoy -c /tmp/envoy.yaml "$@"
