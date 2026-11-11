# Pair a ZMK keyboard with another computer

Select an empty Bluetooth profile on the keyboard, then pair from the new computer. This applies to the ZMK boards keyloom supports: the Glove80, the foostan Corne and the Keebart Corne.

A ZMK keyboard keeps one computer per profile, and the keyboard chooses which profile it serves. Disconnecting it in a computer's Bluetooth settings doesn't free it. The keyboard starts advertising again, and the computer it is paired with reconnects within a second. The Keebart Corne has five profiles.

## Find the profile keys on your layout

```sh
keyloom --format table layout show "My layout" --layer "Lighting & setup"
```

Profile keys show as `BT 1` to `BT 5`. The key that forgets the current profile's computer shows as `Unpair`. keyloom counts profiles from 1, so `BT 1` sends `&bt BT_SEL 0`.

## Pair the new computer

1. On the keyboard, press the profile key for a profile no computer uses.
2. On the new computer, open the Bluetooth settings and connect to the keyboard. The Keebart Corne appears as `Corne Choc BT`.
3. Type something to check. While the keyboard is on the new profile, the first computer gets no keys. Press its profile key to switch back.

The computer doesn't ask for a code. Keebart Corne firmware built by keyloom v0.72.5 waited for a six-digit code typed on the keyboard; build and flash with v0.73.0 or later to remove it. To turn the code back on, switch on **Pairing passkey** in the layout's firmware settings. `keyloom layout settings "My layout"` prints the current value.

## If the computer can't pair

- It spins, then gives up: another computer probably holds that profile. Press a different profile key and try again.
- To free a profile, select it and press `Unpair`. The keyboard forgets that profile's computer. Remove the keyboard from that computer's Bluetooth list before you pair it again.

## Add profile keys to a layout that has none

Write the keys as a change, check it, then apply it. This example puts profile 2 and `Unpair` on two keys of a layer called `numbers`:

```sh
cat > bt-keys.json <<'EOF'
[
  {"op":"setBinding","at":{"layerId":"numbers","position":0},
   "binding":{"kind":"native","firmware":"zmk","source":"&bt BT_SEL 1","label":"BT 2"}},
  {"op":"setBinding","at":{"layerId":"numbers","position":12},
   "binding":{"kind":"native","firmware":"zmk","source":"&bt BT_CLR","label":"Unpair"}}
]
EOF
keyloom --format table change check "My layout" --ops bt-keys.json
```

`change check` saves nothing. It warns that `Unpair` forgets a computer:

```text
ok: the change is valid
warnings (1):
  risky_native: layer "numbers", position 12: &bt BT_CLR would forget the Bluetooth device paired on the current profile  [numbers:12]
changes 2 slots: numbers:0 numbers:12
```

Then save it, apply it and put it on the keyboard:

```sh
keyloom change propose "My layout" --ops bt-keys.json --explain "Bluetooth profile and Unpair keys"
keyloom change apply <change-set-id>   # the ID propose printed on its first line
keyloom sync run "My layout"
```

Put `Unpair` away from keys you press out of habit. On a layer you toggle on, a key under your Space thumb forgets a computer the first time you reach for Space.

## See also

- [Bluetooth pairing: one computer per profile](blueprint/06-firmware-zmk.md#bluetooth-pairing-one-computer-per-profile), the firmware details behind this page
- [The Corne waited for a typed passkey](issues/corne-pairing-waits-for-passkey.md)
