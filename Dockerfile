# Image for hosts that run MCP servers from a container (Glama, Smithery and
# similar). Not needed for the normal install, which is `npx -y @pokemontcgapi/mcp`.
#
# The server speaks stdio: run the container with -i and pass the key as an
# environment variable. Without PTCG_API_KEY it still starts and lists its
# tools, which is what listing checks exercise; only the calls that reach the
# API need the key.
#
#   docker build -t pokemontcgapi-mcp .
#   docker run -i --rm -e PTCG_API_KEY=... pokemontcgapi-mcp

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
