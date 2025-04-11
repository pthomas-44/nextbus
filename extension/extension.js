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
const NO_BUS_STRING = '...';

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
    constructor(time, isLast = false) {
        // note that 24, 25, etc hours are used instead of 01, 02 until the next day's service
        this.normalizedTime = time % MINUTES_PER_DAY;
        this.time = time;
        this.isLast = isLast;
        this.deltaTime = -1;
    }

    setDeltaTimeWith(other) {
        this.deltaTime = (this.normalizedTime - other + MINUTES_PER_DAY) % MINUTES_PER_DAY;
        return this.deltaTime;
    }
}

function busToString(bus, isPreview) {
    if (bus == null) {
        return NO_BUS_STRING;
    }

    let formattedParts = [];

    if (bus.deltaTime > -1) {
        const diffHours = Math.floor(bus.deltaTime / 60);
        const diffMinutes = bus.deltaTime % 60;
        formattedParts.push(diffHours > 0 ? `${diffHours} h ${diffMinutes} min` : `${diffMinutes} min`);
    } else {
        console.warn('You should not call busToString without calling setDeltaTimeWith before');
    }

    if (!isPreview) {
        const hours = Math.floor(bus.normalizedTime / 60);
        const minutes = bus.normalizedTime % 60;
        formattedParts.push(`(${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")})`);
    }

    if (bus.isLast) {
        formattedParts.push(_(`(last bus)`));
    }

    return formattedParts.join(' ');
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

        this.#buses.forEach(buses => {
            buses.sort((a, b) => a.time - b.time);
            let lastBus = buses.at(-1);
            if (lastBus != null) {
                lastBus.isLast = true;
            }
        })
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

    #getNextClosestTimeIndex(currentTime, times) {
        let bestIndex = 0;
        let bestDelta = Infinity;

        for (let i = 0; i < times.length; i++) {
            const t = times[i];
            let delta = t.normalizedTime - currentTime - 1; // (-1 to avoid display 0 minutes)

            if (delta < 0) {
                delta += 24 * 60; // wrap to next day
            }

            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    #getConsecutiveNextBuses(times, fromTime, size = 3) {
        let startIndex = this.#getNextClosestTimeIndex(fromTime, times);

        const maxSize = Math.min(size, times.length);
        const result = [];
        for (let i = 0; i < maxSize; i++) {
            result.push(times[(startIndex + i) % times.length]);
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

        this.titleItem = new PopupMenu.PopupSeparatorMenuItem(this.trip.name);
        this.timeItems = Array.from({ length: this.trip.nextBusesCount }, () => new PopupMenu.PopupMenuItem(NO_BUS_STRING));
    }

    get preview() {
        return this.nextTimePreview.container;
    }

    updateBusTimes() {
        const currentTime = new Date().getHours() * 60 + new Date().getMinutes();

        const nextBuses = TripManager.instance.getNextBuses(this.trip.id, currentTime);        
        this.timeItems.forEach((item, i) => {
            const bus = nextBuses[i];
            bus?.setDeltaTimeWith(currentTime);

            item.label.text = busToString(bus, false);
            if (i == 0) {
                this.nextTimePreview.setData(bus);
            }
        });
    }
}

class NextTripPreview {
    constructor(busLabel) {
        this.container = new St.BoxLayout({ vertical: false, style_class: 'bus-preview' });
        this.busBox = new St.BoxLayout({ vertical: false, style_class: 'bus-box' });
        this.timeBox = new St.BoxLayout({ vertical: false, style_class: 'time-box' });
        this.busLabel = new St.Label({ text: busLabel, style_class: 'bus-label' });
        this.timeLabel = new St.Label({ style_class: 'time-label' });
        
        this.busBox.add_child(this.busLabel);
        this.timeBox.add_child(this.timeLabel);
        this.container.add_child(this.busBox);
        this.container.add_child(this.timeBox);
        this.bus = null;
    }

    setData(bus) {
        this.timeLabel.text = busToString(bus, true);
        this.bus = bus;
        this.#updateStyle();
    }

    #updateStyle() {
        // Supprime toutes les classes pour éviter les conflits de style
        // this.timeBox.remove_style_class_name('time-box-critical');
        // this.timeBox.remove_style_class_name('time-box-warning');
        // this.timeBox.remove_style_class_name('time-box-normal');
        // this.timeBox.remove_style_class_name('time-box-loading');
        this.timeLabel.remove_style_class_name('time-label-critical');
        this.timeLabel.remove_style_class_name('time-label-warning');
        this.timeLabel.remove_style_class_name('time-label-normal');
        this.timeLabel.remove_style_class_name('time-label-loading');

        if (this.bus == null) {
            // this.timeBox.add_style_class_name('time-box-loading');
            this.timeLabel.add_style_class_name('time-label-loading');
        } else if (this.bus.deltaTime <= 5) {
            // this.timeBox.add_style_class_name('time-box-critical');
            this.timeLabel.add_style_class_name('time-label-critical');
        } else if (this.bus.deltaTime <= 10) {
            // this.timeBox.add_style_class_name('time-box-warning');
            this.timeLabel.add_style_class_name('time-label-warning');
        } else {
            // this.timeBox.add_style_class_name('time-box-normal');
            this.timeLabel.add_style_class_name('time-label-normal');
        }
    }
}

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
            if (item.activated) {
                this.addTripItemToMenu(item);
            }
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
        this.#createNextBusButton();
        this.#createUpdater();
        this.#fetchBusStopTimes();
    }

    disable() {
        this.#destroyUpdater();
        this.#destroyNextBusButton();
    }

    update() {
        this._nextBusButton.updateBusTimes();
    }

    #createUpdater() {
        this._updateInterval = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL, () => {
            this.update();
            return true;
        });
    }

    #destroyUpdater() {
        if (this._updateInterval) {
            GLib.source_remove(this._updateInterval);
            this._updateInterval = null;
        }
    }

    #createNextBusButton() {
        if (this._nextBusButton == null) {
            this._nextBusButton = new NextBusButton();
            Main.panel.addToStatusArea(this._uuid, this._nextBusButton, 4, 'center');
        }
    }

    #destroyNextBusButton() {
        if (this._nextBusButton != null) {
            this._nextBusButton.destroy();
            this._nextBusButton = null;
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
            this.update();
        } catch (e) {
            logError(_('Error parsing JSON'), e, false);
        }
    }
}

function init(meta) {
    metadata = meta;
    return new Extension(meta.uuid);
}
