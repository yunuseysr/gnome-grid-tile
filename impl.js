// SPDX-License-Identifier: GPL-2.0-or-later
// Owned by the loader in extension.js, which re-imports this file on every enable
// so updates apply with a disable/enable of this extension alone (no logout needed).

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// UI text follows the session language: Turkish for tr_*, English otherwise.
const TR = (GLib.get_language_names()[0] ?? '').startsWith('tr');
const _ = (en, tr) => (TR ? tr : en);

const MAX_CELLS = 16;
const PRESETS = [2, 4, 6, 8, 9, 12];
// Preferred cell width/height ratio; a browser page reads well around 4:3.
const TARGET_ASPECT = 4 / 3;
// Unmaximizing on Wayland restores the old size asynchronously and can override
// a resize sent right after it, so the geometry is applied once more after this delay.
const REAPPLY_MS = 200;

// Picks columns × rows for n cells: no fully empty row/column, few empty cells,
// and cells as close to TARGET_ASPECT as possible. 6 → 3×2, 8 → 4×2 on 16:9.
export function bestGrid(n, width, height) {
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        if ((rows - 1) * cols >= n)
            continue;
        const aspect = (width / cols) / (height / rows);
        const score = Math.abs(Math.log(aspect / TARGET_ASPECT)) + 0.5 * (cols * rows - n);
        if (!best || score < best.score)
            best = {cols, rows, score};
    }
    return best;
}

const GridButton = GObject.registerClass(
class GridButton extends PanelMenu.Button {
    _init(tiler) {
        super._init(0.5, 'Grid Tile');
        this._tiler = tiler;

        this.add_child(new St.Icon({
            icon_name: 'view-grid-symbolic',
            style_class: 'system-status-icon',
        }));

        this._info = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._info);

        // Count entry: type a number and press Enter.
        const entryItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        entryItem.add_child(new St.Label({
            text: _('Windows:', 'Parça sayısı:'),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._entry = new St.Entry({
            style_class: 'grid-tile-entry',
            can_focus: true,
            hint_text: '1–16',
            x_expand: true,
        });
        this._entry.clutter_text.connect('activate', () => this._tileFromEntry());
        entryItem.add_child(this._entry);
        const goButton = new St.Button({
            style_class: 'button grid-tile-go',
            label: _('Tile', 'Böl'),
            can_focus: true,
        });
        goButton.connect('clicked', () => this._tileFromEntry());
        entryItem.add_child(goButton);
        this.menu.addMenuItem(entryItem);

        // Presets: one click tiles.
        const presetItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const presetBox = new St.BoxLayout({style_class: 'grid-tile-presets', x_expand: true});
        for (const n of PRESETS) {
            const b = new St.Button({
                style_class: 'button grid-tile-preset',
                label: String(n),
                can_focus: true,
                x_expand: true,
            });
            b.connect('clicked', () => this._run(n));
            presetBox.add_child(b);
        }
        presetItem.add_child(presetBox);
        this.menu.addMenuItem(presetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._restoreItem = this.menu.addAction(_('Restore previous positions', 'Eski konumlara geri al'), () => tiler.restore());

        this.menu.connect('open-state-changed', (_m, open) => {
            if (!open)
                return;
            this._entry.set_text(String(tiler.count));
            const windows = tiler.candidateWindows().length;
            this._info.label.text = _(`${windows} window${windows === 1 ? '' : 's'} on this screen`, `Bu ekranda ${windows} pencere`);
            this._restoreItem.setSensitive(tiler.canRestore());
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this.menu.isOpen) {
                    this._entry.grab_key_focus();
                    this._entry.clutter_text.set_selection(0, -1);
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _tileFromEntry() {
        const n = parseInt(this._entry.get_text(), 10);
        if (!Number.isFinite(n) || n < 1 || n > MAX_CELLS) {
            this._entry.set_text(String(this._tiler.count));
            this._entry.clutter_text.set_selection(0, -1);
            return;
        }
        this._run(n);
    }

    _run(n) {
        this.menu.close();
        this._tiler.tile(n);
    }
});

export class GridTile {
    constructor(ext) {
        this._ext = ext;
    }

    get count() {
        return this._settings.get_int('tile-count');
    }

    enable() {
        this._settings = this._ext.getSettings();
        this._saved = new Map(); // MetaWindow -> {rect, maximized}
        this._timeouts = new Set();

        this._button = new GridButton(this);
        Main.panel.addToStatusArea(this._ext.uuid, this._button);
    }

    disable() {
        this._timeouts.forEach(id => GLib.source_remove(id));
        this._timeouts.clear();
        this._saved.clear();
        this._button.destroy();
        this._button = null;
        this._settings = null;
    }

    // Normal windows of the active workspace on the monitor under the pointer,
    // most recently used first.
    candidateWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        const monitor = global.display.get_current_monitor();
        return global.display.get_tab_list(Meta.TabList.NORMAL, workspace).filter(w =>
            w.get_window_type() === Meta.WindowType.NORMAL &&
            !w.get_transient_for() &&
            !w.skip_taskbar &&
            w.get_monitor() === monitor);
    }

    tile(n) {
        this._settings.set_int('tile-count', n);

        const monitor = global.display.get_current_monitor();
        const area = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(monitor);
        const {cols, rows} = bestGrid(n, area.width, area.height);
        const gap = this._settings.get_int('gap');

        // The n most recently used windows, laid out in opening order so that
        // re-tiling keeps every window in the same cell.
        const windows = this.candidateWindows().slice(0, n)
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        if (windows.length === 0)
            return;

        this._saved.clear();
        windows.forEach((win, i) => {
            this._saved.set(win, {
                rect: win.get_frame_rect(),
                maximized: win.get_maximized(),
            });

            const col = i % cols;
            const row = Math.floor(i / cols);
            const x1 = area.x + Math.round(col * area.width / cols);
            const x2 = area.x + Math.round((col + 1) * area.width / cols);
            const y1 = area.y + Math.round(row * area.height / rows);
            const y2 = area.y + Math.round((row + 1) * area.height / rows);
            const rect = {
                x: x1 + gap,
                y: y1 + gap,
                width: x2 - x1 - 2 * gap,
                height: y2 - y1 - 2 * gap,
            };

            if (win.minimized)
                win.unminimize();
            if (win.fullscreen)
                win.unmake_fullscreen();
            if (win.get_maximized())
                win.unmaximize(Meta.MaximizeFlags.BOTH);
            this._place(win, rect);
        });
    }

    _place(win, rect) {
        const apply = () => win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        apply();
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REAPPLY_MS, () => {
            this._timeouts.delete(id);
            if (win.get_compositor_private())
                apply();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    canRestore() {
        return [...this._saved.keys()].some(w => w.get_compositor_private());
    }

    restore() {
        for (const [win, {rect, maximized}] of this._saved) {
            if (!win.get_compositor_private())
                continue; // closed since tiling
            win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
            if (maximized)
                win.maximize(maximized);
        }
        this._saved.clear();
    }
}
