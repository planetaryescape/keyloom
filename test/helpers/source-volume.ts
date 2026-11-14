// Source copying has its own trusted container. It must not enter a fake firmware build.
export const FAKE_SOURCE_VOLUME = `
case "$1:$2" in
  volume:create|volume:rm) exit 0;;
  volume:inspect) echo "no such volume" >&2; exit 1;;
esac
case " $* " in *" keyloom-source-copy "*) exit 0;; esac
`;
