# Lean variant of moergo-sc/glove80-zmk-config@34888be Dockerfile: pre-builds the Nix
# store for ONE pinned moergo-sc/zmk ref instead of main plus the last three tags.
# Pinned by digest (the multi-arch index of nixos-23.11, read 2026-10-15) so the base can't change under a pinned firmware ref.
FROM nixpkgs/nix:nixos-23.11@sha256:11c1c37da85b27f1b47a7c0fdff8e3cf970cafaac623312dbcf243c84b8756dd
ARG ZMK_REF=ce69e85f585c724142aae37ddf8a7e019ff19e93
ENV PATH=/root/.nix-profile/bin:/usr/bin:/bin
RUN set -eu; \
    printf '%s\n' \
      'extra-substituters = https://moergo-glove80-zmk-dev.cachix.org' \
      'extra-trusted-public-keys = moergo-glove80-zmk-dev.cachix.org-1:D8fhPJ1c3gkuckuyBLRtGYarCVptIDn4g5k8u91NbyM=' >> /etc/nix/nix.conf; \
    git clone --filter=blob:none https://github.com/moergo-sc/zmk /src; \
    cd /src && git checkout -q --detach "$ZMK_REF"; \
    nix-shell --run true -A zmk ./default.nix
WORKDIR /config
ENTRYPOINT ["sh", "-c", "nix-build ./config --arg firmware 'import /src/default.nix {}' -j2 -o /tmp/combined && install -o \"$UID\" -g \"$GID\" /tmp/combined/glove80.uf2 ./glove80.uf2"]
