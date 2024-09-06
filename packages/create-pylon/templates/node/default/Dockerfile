# Use the official Node.js 20 image as the base
FROM node:20-alpine as base

LABEL description="Offical docker image for Pylon services (Node.js)"
LABEL org.opencontainers.image.source="https://github.com/getcronit/pylon"
LABEL maintainer="office@cronit.io"

WORKDIR /usr/src/pylon

# install dependencies into a temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json package-lock.json /temp/dev/
RUN cd /temp/dev && npm ci

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json package-lock.json /temp/prod/
RUN cd /temp/prod && npm ci --only=production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM install AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# [optional] tests & build
ENV NODE_ENV=production

# Create .pylon folder (mkdir)
RUN mkdir -p .pylon
# RUN npm test
RUN npm run pylon build

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/pylon/.pylon .pylon
COPY --from=prerelease /usr/src/pylon/package.json .

# run the app
USER node
EXPOSE 3000/tcp
ENTRYPOINT [ "node", "/usr/src/pylon/.pylon/index.js" ]
