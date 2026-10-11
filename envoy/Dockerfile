# Bakes the bootstraps into the image, so the stack needs no host bind mounts.
FROM envoyproxy/envoy:v1.39.3
COPY envoy.yaml envoy.behind-proxy.yaml /etc/envoy/
