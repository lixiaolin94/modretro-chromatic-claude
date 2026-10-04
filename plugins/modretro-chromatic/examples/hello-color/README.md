# Game Boy Color toolchain smoke test

`main.c` is an original, interactive Game Boy Color program. It displays the
currently pressed controller button and uses a custom four-color CGB palette.

Copy this folder to a writable location. From that copy, build with the `lcc`
executable from your installed official GBDK-2020 toolchain:

```sh
/absolute/path/to/gbdk/bin/lcc -Wl-yt0x00 -Wl-yo2 -Wm-yC -Wm-ynCHROMATICHELLO -o hello-color.gbc main.c
```

The command replaces `hello-color.gbc` in your copy. Use the
[setup guide](../../docs/setup.md) to locate or prepare a compiler. This is a
standalone C example; it does not use a native game project or the plugin's
`rom_build` tool.
