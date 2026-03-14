FROM nginx:alpine
RUN apk add --no-cache openssl curl socat
# Install acme.sh to /opt/acme.sh (not /root/.acme.sh which is a Docker volume)
RUN curl -sSL https://get.acme.sh | sh -s -- --install-online --nocron --home /opt/acme.sh \
    && ln -s /opt/acme.sh/acme.sh /usr/local/bin/acme.sh
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
