FROM nginx:alpine
RUN apk add --no-cache openssl curl socat
# Install acme.sh: default install to /root/.acme.sh, then copy to /opt/acme.sh
# so it survives Docker volume mounts on /root
RUN curl -sSL https://get.acme.sh | sh -s -- --install-online --nocron \
    && cp -a /root/.acme.sh /opt/acme.sh \
    && rm -rf /root/.acme.sh
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
