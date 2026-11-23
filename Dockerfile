FROM ghcr.io/cedar2025/xboard-node:latest
RUN apk add --no-cache socat
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3000 8080 8443
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["-c", "/etc/xboard-node/config.yml"]
