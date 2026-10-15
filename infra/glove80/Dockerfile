# Lean variant of moergo-sc/glove80-zmk-config@34888be Dockerfile: pre-builds the Nix
# store for ONE pinned moergo-sc/zmk ref instead of main plus the last three tags.
FROM nixpkgs/nix:nixos-23.11
ARG ZMK_REF=ce69e85f585c724142aae37ddf8a7e019ff19e93
ENV PATH=/root/.nix-profile/bin:/usr/bin:/bin
RUN set -eu; \
    nix-env -iA cachix -f https://cachix.org/api/v1/install; \
    cachix use moergo-glove80-zmk-dev; \
    git clone --filter=blob:none https://github.com/moergo-sc/zmk /src; \
    cd /src && git checkout -q --detach "$ZMK_REF"; \
    nix-shell --run true -A zmk ./default.nix
WORKDIR /config
ENTRYPOINT ["sh", "-c", "nix-build ./config --arg firmware 'import /src/default.nix {}' -j2 -o /tmp/combined && install -o \"$UID\" -g \"$GID\" /tmp/combined/glove80.uf2 ./glove80.uf2"]
