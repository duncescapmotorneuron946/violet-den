FROM nginx:alpine
RUN apk add --no-cache openssl curl socat
# Install acme.sh manually to /opt/acme.sh (avoids installer flag issues)
RUN mkdir -p /opt/acme.sh \
    && curl -sSL https://github.com/acmesh-official/acme.sh/archive/master.tar.gz \
       | tar xz --strip-components=1 -C /opt/acme.sh
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
