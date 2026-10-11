#!/bin/sh
# Validates Envoy configs with the real binary. Files go in over stdin, so no bind mounts are needed.
set -eu
IMAGE="${ENVOY_IMAGE:-envoyproxy/envoy:v1.39.3}"
status=0
for file in "$@"; do
  # Envoy picks the parser from the extension, so keep it.
  ext="${file##*.}"
  if docker run --rm -i --entrypoint sh "$IMAGE" -c "cat > /tmp/config.$ext && envoy --mode validate -c /tmp/config.$ext" < "$file" > /tmp/envoy-validate.log 2>&1; then
    echo "ok      $file"
  else
    echo "INVALID $file"
    tail -5 /tmp/envoy-validate.log
    status=1
  fi
done
exit "$status"
