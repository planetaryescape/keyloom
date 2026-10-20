# Glove80 guidance

- Read the imported layout before referring to Magic, Lower or a bootloader shortcut. Those names and bindings come from the layout, not fixed positions guaranteed for every owner. Keep native behaviours and passthrough source intact.
- A home-row mod profile's `hold-trigger-key-positions` should name the opposite hand. A left-hand profile reused unchanged on the right triggers on the wrong hand; mirror its positions as well as its modifiers.
- Build against the pinned MoErgo fork and template in the board definition. Upstream ZMK features are not automatically available on that pin. Studio editing is not keyloom's apply path.
- Physical lighting is underglow with one effect across the keys on this firmware, not per-key, per-layer RGB. On-screen layer colours remain supported; use `setLayerStyle` for those, not `setLayerLighting`.
- The UF2 recipe writes the combined image to the right half, then the left. Hands-free restart needs keyloom's module already on the halves; never promise it for stock firmware. Restarting or flashing either half needs explicit permission in this session.

Evidence: [ZMK and Glove80 research](../../../docs/research/zmk-and-glove80.md), [lighting spike S21](../../../docs/research/spikes/S21.md), and [mirroring decision D-060](../../../docs/blueprint/14-decision-log.md#d-060-a-mirror-partner-is-the-key-at-the-same-height-on-the-other-half-and-mirroring-a-behaviour-keeps-each-keys-own-letter-claude-building-rung-7).
