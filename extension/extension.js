/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'nextbus';
const { GObject, St, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const _ = ExtensionUtils.gettext;

let metadata;

const Me = ExtensionUtils.getCurrentExtension();
const CoreLoader = Me.imports["core-loader"];

const UPDATE_INTERVAL = 5;
const STOP_TIMES_JSON_PATH = GLib.build_filenamev([GLib.get_home_dir(), 'goinfre', 'stop_times.json']);
const WARNING_TIME = 10;
const CRITICAL_TIME = 5;

class Trip {
    constructor(id, name, tag) {
        this.id = id;
        this.name = name;
        this.tag = tag;
    }
}

const trips = [
    new Trip('86A_18_2_040AM', '86 - Gorge de Loup', '86'),
    // new Trip('86A_18_1_040AM', '86 - La Tour de Salvagny Chambettes', '86'),
    new Trip('5A_34_2_046AB', '5 - Pont Mouton', '5'),
    // new Trip('5A_34_1_046AB', '5 - Charbonnières Les Verrières', '5'),
];

class TripItem {
    constructor(trip) {
        this.trip = trip;
        this.activated = true;
        this._initMenu();
        this.nextTimePreview = new NextTripPreview(this.trip.tag);
    }

    _initMenu() {
        this.titleItem = new PopupMenu.PopupSeparatorMenuItem(this.trip.name);
        this.timeItems = Array.from({ length: 3 }, () => new PopupMenu.PopupMenuItem(_('N/A min')));
    }

    get preview() {
        return this.nextTimePreview.container;
    }

    updateBusTimes() {
        function formatTime(timeInMinutes) {
            if (timeInMinutes === undefined) return _('N/A min');
        
            const hours = Math.floor(timeInMinutes / 60);
            const minutes = timeInMinutes % 60;

            if (hours > 0) {
                return `${hours} h ${minutes} min`;
            } else {
                return `${minutes} min`;
            }
        }

        if (!GLib.file_test(STOP_TIMES_JSON_PATH, GLib.FileTest.EXISTS))
            return;

        const [isOk, fileContent] = GLib.file_get_contents(STOP_TIMES_JSON_PATH);
        if (!isOk) return;

        try {
            const busData = JSON.parse(fileContent);
            const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
            
            const nextTimes = busData
                .filter(bus => bus.trip_id === this.trip.id)
                .map(bus => {
                    const [hours, minutes] = bus.arrival_time.split(':').map(Number);
                    return hours * 60 + minutes;
                })
                .filter(arrivalMinutes => arrivalMinutes > currentMinutes)
                .sort((a, b) => a - b)
                .slice(0, 3)
                .map(arrivalMinutes => arrivalMinutes - currentMinutes);
            
            this.timeItems.forEach((item, i) => {
                item.label.text = formatTime(nextTimes[i]);
            });

            this.nextTimePreview.updateTime = this.timeItems[0].label.text;
        } catch (e) {
            logError(_('Error parsing JSON'), e, false);
        }
    }
}

class NextTripPreview {
    constructor(busLabel) {
        this._init(busLabel);
    }

    _init(busLabel) {
        this.container = new St.BoxLayout({ vertical: false });
        this.busBox = new St.BoxLayout({ vertical: false, style_class: 'bus-box' });
        this.timeBox = new St.BoxLayout({ vertical: false, style_class: 'time-box' });
        this.busLabel = new St.Label({ text: busLabel, style_class: 'bus-label' });
        this.timeLabel = new St.Label({ text: "N/A min", style_class: 'time-label' });

        this.busBox.add_child(this.busLabel);
        this.timeBox.add_child(this.timeLabel);
        this.container.add_child(this.busBox);
        this.container.add_child(this.timeBox);
    }

    _update_time_style() {
        let time = parseInt(this.timeLabel.text, 10);
        if (isNaN(time)) time = 0;

        // Supprime toutes les classes pour éviter les conflits de style
        // this.timeBox.remove_style_class_name('time-box-critical');
        // this.timeBox.remove_style_class_name('time-box-warning');
        // this.timeBox.remove_style_class_name('time-box-normal');
        this.timeLabel.remove_style_class_name('time-label-critical');
        this.timeLabel.remove_style_class_name('time-label-warning');
        this.timeLabel.remove_style_class_name('time-label-normal');

        if (time <= 5) {
            // this.timeBox.add_style_class_name('time-box-critical');
            this.timeLabel.add_style_class_name('time-label-critical');
        } else if (time <= 10) {
            // this.timeBox.add_style_class_name('time-box-warning');
            this.timeLabel.add_style_class_name('time-label-warning');
        } else {
            // this.timeBox.add_style_class_name('time-box-normal');
            this.timeLabel.add_style_class_name('time-label-normal');
        }
    }

    set updateTime(text) {
        this.timeLabel.text = text;
        this._update_time_style();
    }
}

// this.add_style_class_name('nextbus-button');

const NextBusButton = GObject.registerClass(
class NextBusButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('NextBusButton'));
        this.mainContainer = new St.BoxLayout({ vertical: false, style_class: 'main-button' });

        this.busItems = trips.map(trip => new TripItem(trip));
        this.busItems.forEach(item => {
            if (item.activated)
                this.addTripItemToMenu(item);
        });
        this.add_child(this.mainContainer);
        this.updateBusTimes();
    }

    addTripItemToMenu(tripItem) {
        this.menu.addMenuItem(tripItem.titleItem);
        tripItem.timeItems.forEach(item => {
            this.menu.addMenuItem(item);
        });
        this.mainContainer.add_child(tripItem.preview);
    }

    updateBusTimes() {
        for (let tripItem of this.busItems)
            tripItem.updateBusTimes();
    }
});

class NextBusExtension extends CoreLoader.ExtensionBase {
    constructor(uuid) {
        super(uuid);
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    onEnable() {
        this.#fetchBusStopTimes(this._nextBusButton);
        this.createNextBusButton();
        // Mise à jour des horaires toutes les 5 secondes
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._nextBusButton.updateBusTimes();
            return true;
        });
    }

    onDisable() {
        this.destroyNextBusButton();
    }

    createNextBusButton() {
        if (this._nextBusButton)
            return;
        this._nextBusButton = new NextBusButton();
        Main.panel._centerBox.add_child(this._nextBusButton.container);
    }

    destroyNextBusButton() {
        if (!this._nextBusButton)
            return;
        Main.panel._centerBox.remove_child(this._nextBusButton.container);
        this._nextBusButton.destroy();
        this._nextBusButton = null;
    }

    #fetchBusStopTimes(nextBusButton) {
        CoreLoader.handler.spawnCommandLineAsync(`python3 ${metadata.path}/nextbus.py`, (result, stdout, stderr, status) => {
            if (result && status === 0) {
                console.log(stdout);
                nextBusButton.updateBusTimes();
            } else {
                console.error(stderr);
            }
            return result;
        });
    }
}

function init(meta) {
    metadata = meta;
    return new NextBusExtension(meta.uuid);
}
