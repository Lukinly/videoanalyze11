FROM dxflrs/garage:v2.5.0 AS garage
FROM alpine:3
COPY --from=garage /garage /garage
COPY infra/storage/entrypoint.sh /entrypoint.sh
RUN mkdir -p /var/lib/garage/meta /var/lib/garage/data \
    && chown -R 1000:1000 /var/lib/garage \
    && chmod +x /entrypoint.sh
USER 1000:1000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["server", "--single-node", "--default-bucket"]
