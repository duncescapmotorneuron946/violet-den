FROM nginx:alpine
RUN apk add --no-cache openssl curl socat
# Install acme.sh for Let's Encrypt DNS-01 cert automation
RUN curl -sSL https://get.acme.sh | sh -s email=noreply@violetden.local \
    && ln -s /root/.acme.sh/acme.sh /usr/local/bin/acme.sh
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
