# Demo upstreams and traffic generator. Scripts are baked in, so no host bind mounts are needed.
FROM node:24.21.0-alpine
WORKDIR /demo
COPY shop.mjs traffic.mjs ./
USER node
CMD ["node", "shop.mjs"]
