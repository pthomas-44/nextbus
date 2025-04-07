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
const UPDATE_INTERVAL = 5;
const STOP_TIMES_JSON_PATH = GLib.build_filenamev([GLib.get_home_dir(), 'goinfre', 'stop_times.json']);
const WARNING_TIME = 10;
const CRITICAL_TIME = 5;
const MINUTES_PER_DAY = 24 * 60;
const NO_BUS = Number.NEGATIVE_INFINITY;

// #region utils
function logError(error, message, notify) {
    if (notify)
        Main.notifyError(error, message);
    else
        log(`${error}: ${message}`);
}

async function readStream(stream) {
    return new Promise((resolve, reject) => {
        stream.read_upto_async('\0', 1, GLib.PRIORITY_LOW, null, (src, res) => {
            try {
                const [str] = src.read_upto_finish(res);
                src.close(null);
                resolve(str);
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function spawnCommandLineAsync(commandLine, callback = () => {}) {
    let success, argv, pid, stdin, stdout, stderr;

    try {
        [success, argv] = GLib.shell_parse_argv(commandLine);
        if (!success) throw new Error("Échec du parsing de la commande");

        [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            null, argv, null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );

        GLib.close(stdin);
        const outStream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stdout, close_fd: true }) });
        const errStream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stderr, close_fd: true }) });
        const [out, err] = await Promise.all([readStream(outStream), readStream(errStream)]);

        callback(true, out, err, 0);
    } catch (error) {
        console.error("Erreur lors de l'exécution de la commande :", error);
        callback(false, "", "", -1);
    }
}
// #endregion

class Trip {
    constructor(id, name, tag, nextBusesCount) {
        this.id = id;
        this.name = name;
        this.tag = tag;
        this.nextBusesCount = nextBusesCount;
    }
}

class Bus {
    constructor(time) {
        // note that 24, 25, etc hours are used instead of 01, 02 until the next day's service
        this.normalizedTime = time % MINUTES_PER_DAY;
        this.time = time;
    }
}

class TripManager {
    static instance;

    #trips = new Map(); // Map of tripId -> trip
    #buses = new Map(); // Map of tripId -> list of buses

    constructor(trips) {
        this.#trips = trips.reduce((acc, trip) => {
            acc.set(trip.id, trip);
            return acc;
        }, new Map());

        TripManager.instance = this;
    }

    reloadFromBuses(rawBuses) {
        for (const rawBus of rawBuses) {
            const tripId = rawBus['trip_id'];
            if (this.#trips.has(tripId)) {
                this.#insertBus(tripId, this.#parseBus(rawBus));
            }
        }

        this.#buses.forEach(buses => buses.sort((a, b) => a.time - b.time))
    }

    getTrips() {
        return this.#trips.values();
    }

    getTrip(tripId) {
        return this.#trips.get(tripId);
    }

    getBuses(tripId) {
        return this.#buses.get(tripId);
    }

    getNextBuses(tripId, fromTime) {
        const trip = this.#trips.get(tripId);
        if (trip == null) {
            console.warn("Trying to get a non-existing trip")
            return [];
        }

        return this.#getConsecutiveNextBuses(this.#buses.get(tripId) ?? [], fromTime, trip.nextBusesCount);
    }

    #getConsecutiveNextBuses(arr, fromTime, size = 3) {
        let startIndex = 0;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].normalizedTime > fromTime) {
                startIndex = i;
                break;
            }
        }

        const maxSize = Math.min(size, arr.length);
        const result = [];
        for (let i = 0; i < maxSize; i++) {
            result.push(arr[(startIndex + i) % arr.length]);
        }
        return result;
    }

    #parseBus(bus) {
        const [hours, minutes] = bus['arrival_time'].split(':').map(Number);
        return new Bus(hours * 60 + minutes)
    }

    #insertBus(tripId, Bus) {
        if (!this.#buses.has(tripId)) {
            this.#buses.set(tripId, [Bus]);
        } else {
            this.#buses.get(tripId).push(Bus);
        }
    }
}

class TripItem {
    constructor(trip) {
        this.trip = trip;
        this.activated = true;
        this.nextTimePreview = new NextTripPreview(trip.tag);
        this._initMenu();
    }

    _initMenu() {
        this.titleItem = new PopupMenu.PopupSeparatorMenuItem(this.trip.name);
        this.timeItems = Array.from({ length: this.trip.nextBusesCount }, () => new PopupMenu.PopupMenuItem('...'));
    }

    get preview() {
        return this.nextTimePreview.container;
    }

    updateBusTimes() {
        function formatTime(busTime, difference) {
            const hours = Math.floor(busTime / 60);
            const minutes = busTime % 60;
            const busTimeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`

            const diffHours = Math.floor(difference / 60);
            const diffMinutes = difference % 60;

            if (diffHours > 0) {
                return `${diffHours} h ${diffMinutes} min (${busTimeStr})`;
            } else {
                return `${diffMinutes} min (${busTimeStr})`;
            }
        }

        const currentTime = new Date().getHours() * 60 + new Date().getMinutes();

        const nextBuses = TripManager.instance.getNextBuses(this.trip.id, currentTime);        
        this.timeItems.forEach((item, i) => {
            const bus = nextBuses[i];

            if (bus == null) {
                item.label.text = _('...');
                if (i == 0) {
                    this.nextTimePreview.updateTime = NO_BUS;
                }
            } else {
                const busTime = bus.normalizedTime;
                const difference = (busTime - currentTime + MINUTES_PER_DAY) % MINUTES_PER_DAY;

                item.label.text = formatTime(busTime, difference);
                if (i == 0) {
                    this.nextTimePreview.updateTime = difference;
                }
            }
        });
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
        this.timeLabel = new St.Label({ style_class: 'time-label' });
        
        this.busBox.add_child(this.busLabel);
        this.timeBox.add_child(this.timeLabel);
        this.container.add_child(this.busBox);
        this.container.add_child(this.timeBox);
        this.updateTime = NO_BUS;
    }

    _update_time_style() {
        // Supprime toutes les classes pour éviter les conflits de style
        // this.timeBox.remove_style_class_name('time-box-critical');
        // this.timeBox.remove_style_class_name('time-box-warning');
        // this.timeBox.remove_style_class_name('time-box-normal');
        // this.timeBox.remove_style_class_name('time-box-loading');
        this.timeLabel.remove_style_class_name('time-label-critical');
        this.timeLabel.remove_style_class_name('time-label-warning');
        this.timeLabel.remove_style_class_name('time-label-normal');
        this.timeLabel.remove_style_class_name('time-label-loading');

        if (this.difference == NO_BUS) {
            // this.timeBox.add_style_class_name('time-box-loading');
            this.timeLabel.add_style_class_name('time-label-loading');
        } if (this.difference <= 5) {
            // this.timeBox.add_style_class_name('time-box-critical');
            this.timeLabel.add_style_class_name('time-label-critical');
        } else if (this.difference <= 10) {
            // this.timeBox.add_style_class_name('time-box-warning');
            this.timeLabel.add_style_class_name('time-label-warning');
        } else {
            // this.timeBox.add_style_class_name('time-box-normal');
            this.timeLabel.add_style_class_name('time-label-normal');
        }
    }

    set updateTime(difference) {
        function formatTime(difference) {
            const diffHours = Math.floor(difference / 60);
            const diffMinutes = difference % 60;

            if (diffHours > 0) {
                return `${diffHours} h ${diffMinutes} min`;
            } else {
                return `${diffMinutes} min`;
            }
        }

        this.difference = difference;
        if (difference == NO_BUS)
            this.timeLabel.text = '...';
        else
            this.timeLabel.text = formatTime(difference);
        this._update_time_style();
    }
}

// this.add_style_class_name('nextbus-button');

const NextBusButton = GObject.registerClass(
class NextBusButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('NextBusButton'));
        this.mainContainer = new St.BoxLayout({ vertical: false, style_class: 'main-button' });

        this.busItems = [];
        for (const trip of TripManager.instance.getTrips()) {
            this.busItems.push(new TripItem(trip));
        }

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

new TripManager([
    new Trip('86A_18_2_040AM', '86 - Gorge de Loup', '86', 4),
    // new Trip('86A_18_1_040AM', '86 - La Tour de Salvagny Chambettes', '86', 4),
    new Trip('5A_34_2_046AB', '5 - Pont Mouton', '5', 2),
    // new Trip('5A_34_1_046AB', '5 - Charbonnières Les Verrières', '5', 2),
]);

class Extension {
    constructor(uuid) {
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
        this._uuid = uuid;
    }

    enable() {
        this.createNextBusButton();
        this.createUpdater();
        this.#fetchBusStopTimes();
    }

    disable() {
        this.destroyNextBusButton();
    }

    createNextBusButton() {
        if (this._nextBusButton)
            return;
        this._nextBusButton = new NextBusButton();
        Main.panel._centerBox.add_child(this._nextBusButton.container);
    }

    createUpdater() {
        this._updateInterval = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL, () => {
            this._nextBusButton.updateBusTimes();
            return true;
        });
    }

    destroyNextBusButton() {
        if (!this._nextBusButton)
            return;
        Main.panel._centerBox.remove_child(this._nextBusButton.container);
        this._nextBusButton.destroy();
        this._nextBusButton = null;
    }

    destroyUpdater() {
        if (this._updateInterval) {
            GLib.source_remove(this._updateInterval);
            this._updateInterval = null;
        }
    }

    #fetchBusStopTimes() {
        spawnCommandLineAsync(`python3 ${metadata.path}/nextbus.py`, (result, stdout, stderr, status) => {
            if (result && status === 0) {
                this.#loadBusesStopsFile();
            } else {
                logError(_('Error fetching bus stop times'), stderr, true)
                console.error(stderr);
            }
        });
    }

    #loadBusesStopsFile() {
        if (!GLib.file_test(STOP_TIMES_JSON_PATH, GLib.FileTest.EXISTS))
            return;
        
        const [isOk, fileContent] = GLib.file_get_contents(STOP_TIMES_JSON_PATH);
        if (!isOk) return;
        
        try {
            const busData = JSON.parse(fileContent);
            TripManager.instance.reloadFromBuses(busData);
        } catch (e) {
            logError(_('Error parsing JSON'), e, false);
        }
    }
}

function init(meta) {
    metadata = meta;
    return new Extension(meta.uuid);
}
