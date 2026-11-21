FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS test
COPY . .
CMD ["sh", "-c", "npm run lint && npm run typecheck && npm test && npm run build"]

FROM dependencies AS build
COPY . .
RUN npm run build

FROM build AS recovery-web
# Private local/test acceptance uses Vite DEV; production auth stays disabled.
USER node
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5174", "--strictPort"]

FROM nginx:stable-alpine@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
USER 101:101
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
