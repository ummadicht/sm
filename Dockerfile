# Stage 1: Build Expo Web Variants (store & check)
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends bash git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN bash scripts/export-web.sh all

# Stage 2: Internal Static File Server (Serves /app/store, /app/check, and /downloads/*.apk)
FROM caddy:2.9-alpine AS runner
COPY --from=builder /app/dist-web /dist-web

RUN cat << 'EOF2' > /etc/caddy/Caddyfile
:80 {
    @apk path_regexp apk ^/downloads/swapup-(store|check)\.apk$
    handle @apk {
        root * /var/www/swapup-downloads
        uri strip_prefix /downloads
        header Content-Type "application/vnd.android.package-archive"
        header Cache-Control "no-cache"
        file_server
    }

    redir /app/store /app/store/?{query} 308
    redir /app/check /app/check/?{query} 308

    handle /app/store/* {
        @store_hashed {
            path /_expo/static/*
            file
        }
        @store_fresh not path /_expo/static/*
        @store_spa {
            not file
            not path /_expo/* /assets/*
        }
        route {
            uri strip_prefix /app/store
            root * /var/www/swapup-web/store
            header @store_hashed Cache-Control "public, max-age=31536000, immutable"
            header @store_fresh Cache-Control "no-cache"
            rewrite @store_spa /index.html
            file_server
        }
    }

    handle /app/check/* {
        @check_hashed {
            path /_expo/static/*
            file
        }
        @check_fresh not path /_expo/static/*
        @check_spa {
            not file
            not path /_expo/* /assets/*
        }
        route {
            uri strip_prefix /app/check
            root * /var/www/swapup-web/check
            header @check_hashed Cache-Control "public, max-age=31536000, immutable"
            header @check_fresh Cache-Control "no-cache"
            rewrite @check_spa /index.html
            file_server
        }
    }
}
EOF2

EXPOSE 80
CMD ["sh", "-c", "mkdir -p /var/www/swapup-web/store /var/www/swapup-web/check /var/www/swapup-downloads && rm -rf /var/www/swapup-web/store/* /var/www/swapup-web/check/* && cp -r /dist-web/store/* /var/www/swapup-web/store/ && cp -r /dist-web/check/* /var/www/swapup-web/check/ && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
