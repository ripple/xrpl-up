FROM ubuntu:22.04

ARG CHANNEL=deb-develop
ARG VERSION

RUN test -n "$VERSION" \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && echo "deb [trusted=yes] https://packages.xrplf.org/repository/${CHANNEL} any main" \
         > /etc/apt/sources.list.d/xrplf.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
         -o Dpkg::Options::=--force-confold "xrpld=${VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /dev/stdout /var/log/xrpld/debug.log

EXPOSE 5005 6006 51235

ENTRYPOINT ["/usr/bin/xrpld"]
CMD ["--net", "--silent", "--conf", "/etc/xrpld/xrpld.cfg"]
