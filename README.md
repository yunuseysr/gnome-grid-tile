# Grid Tile

A tiny GNOME Shell extension that tiles the windows on your screen into an **equal grid** in one click —
6 windows become 3×2, 8 become 4×2, 9 become 3×3 — and puts them back where they were when you are done.

No keyboard-driven tiling mode to learn and nothing running in the background: open the top bar menu,
pick a number, done.

## Features

- **One-click presets** (2, 4, 6, 8, 9, 12) or type any count from 1 to 16 and press <kbd>Enter</kbd>.
- **Smart grid shape**: picks columns × rows so that cells are close to a 4:3 reading shape and no row is
  left empty. Works on portrait monitors too (6 → 2×3).
- **Stable cells**: windows are placed in the order they were opened, so re-tiling keeps every window in
  the same cell.
- **Undo**: “Restore previous positions” returns every window to its old size, position and maximized state.
- Only touches the **active workspace on the monitor under the pointer**; minimized and fullscreen windows
  are brought back into the grid.
- Optional **gap** between windows (GSettings key `gap`, 0–40 px).
- English UI, Turkish when your session language is Turkish.

## Install

Requires GNOME Shell 45–48.

```bash
git clone https://github.com/yunuseysr/gnome-grid-tile.git
cd gnome-grid-tile
./install.sh
```

On Wayland, log out and back in once, then:

```bash
gnome-extensions enable grid-tile@yunusemreyasar
```

### As a zip

Build an installable zip (also what you would upload to extensions.gnome.org) and install it:

```bash
./pack.sh
gnome-extensions install --force grid-tile@yunusemreyasar.shell-extension.zip
```

## Settings

```bash
# space between windows, in pixels
gsettings --schemadir ~/.local/share/gnome-shell/extensions/grid-tile@yunusemreyasar/schemas \
  set org.gnome.shell.extensions.grid-tile gap 8
```

## Development

`extension.js` is a small loader that imports `impl.js` with its modification time in the URL. GNOME Shell
caches ES modules for the whole session, so this lets you apply changes without logging out:

```bash
./reload.sh      # disables and re-enables only this extension
./pack.sh        # builds the release zip
```

Logs: `journalctl -f -o cat /usr/bin/gnome-shell`

## License

[GPL-2.0-or-later](LICENSE), like GNOME Shell itself.
