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
const SECONDS_PER_DAY = 24 * 3600;
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

async function spawnCommandLineAsync(commandLine, working_directory = null, callback = () => { }) {
    let success, argv, pid, stdin, stdout, stderr;

    try {
        [success, argv] = GLib.shell_parse_argv(commandLine);
        if (!success) throw new Error("Échec du parsing de la commande");

        [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            working_directory, argv, null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );

        GLib.close(stdin);
        const outStream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stdout, close_fd: true }) });
        const errStream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stderr, close_fd: true }) });
        const [out, err] = await Promise.all([readStream(outStream), readStream(errStream)]);

        callback(true, out ?? "", err ?? "", 0);
    } catch (error) {
        console.error("Erreur lors de l'exécution de la commande :", error);
        callback(false, "", "", -1);
    }
}

function upperBound(arr, target, mapper = e => e) {
    let lo = 0, hi = arr.length - 1;
    let res = arr.length;
    while (lo <= hi) {
        let mid = lo + Math.floor((hi - lo) / 2);
        if (mapper(arr[mid]) > target) {
            res = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return res;
}

function parseTime(hms) {
    const [hours, minutes, seconds] = hms.split(':').map(e => parseInt(e));
    return (hours * 3600) + (minutes * 60) + seconds;
}

function dateTimeToDate(dateTime) {
    const tmp = new Date(dateTime); // Modulo on miliseconds is not working (wrong timezones)
    tmp.setHours(0, 0, 0, 0);
    return tmp.getTime();
}
// #endregion

class Trip {
    constructor(stop, destination, route, nextBusesCount) {
        this.uuid = GLib.uuid_string_random();
        this.stop = stop;
        this.destination = destination;
        this.route = route;
        this.nextBusesCount = nextBusesCount;
    }
}

class Bus {
    constructor(time, isLast = false) {
        // note that 24, 25, etc hours are used instead of 01, 02 until the next day's service
        this.normalizedTime = time % SECONDS_PER_DAY;
        this.time = time;
        this.isLast = isLast;
        this.deltaTime = -1;
    }

    setDeltaTimeWith(other) {
        this.deltaTime = (this.normalizedTime - other + SECONDS_PER_DAY) % SECONDS_PER_DAY;
        return this.deltaTime;
    }
}

function busToString(bus, isPreview) {
    if (bus == null) {
        return NO_BUS_STRING;
    }

    let formattedParts = [];

    if (bus.deltaTime > -1) {
        const modifiedDelta = bus.deltaTime + (1 * 60);
        const diffHours = Math.floor(modifiedDelta / 3600);
        const diffMinutes = Math.floor((modifiedDelta % 3600) / 60) % 60;
        formattedParts.push(diffHours > 0 ? `${diffHours} h ${diffMinutes} min` : `${diffMinutes} min`);
    } else {
        console.warn('You should not call busToString without calling setDeltaTimeWith before');
    }

    if (!isPreview) {
        const hours = Math.floor(bus.normalizedTime / 3600);
        const minutes = Math.floor((bus.normalizedTime % 3600) / 60) % 60;
        formattedParts.push(`(${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")})`);
    }

    if (bus.isLast) {
        formattedParts.push(_(`(last bus)`));
    }

    return formattedParts.join(' ');
}

class TripManager {
    static instance;

    #trips = new Map(); // Map of trip uuid -> trip
    #buses = new Map(); // Map of trip uuid -> list of buses

    constructor(trips) {
        this.#trips = trips.reduce((acc, trip) => {
            acc.set(trip.uuid, trip);
            return acc;
        }, new Map());

        TripManager.instance = this;
    }

    setTimesForTrip(trip, times) {
        this.#buses.set(trip.uuid, times.map((time, i, array) => new Bus(time, (i == array.length - 1))));
    }

    getTrips() {
        return this.#trips.values();
    }

    getTrip(tripUuid) {
        return this.#trips.get(tripUuid);
    }

    getBuses(tripUuid) {
        return this.#buses.get(tripUuid);
    }

    getNextBuses(tripUuid, fromTime) {
        const trip = this.getTrip(tripUuid);
        if (trip == null) {
            console.warn("Trying to get a non-existing trip")
            return [];
        }

        return this.#getConsecutiveNextBuses(this.#buses.get(tripUuid) ?? [], fromTime, trip.nextBusesCount);
    }

    #getConsecutiveNextBuses(times, fromTime, count = 3) {
        const startIndex = upperBound(times, fromTime, e => e.time);
        return times.slice(startIndex, startIndex + count);
    }
}

class TripItem {
    constructor(trip) {
        this.trip = trip;
        this.activated = true;
        this.nextTimePreview = new NextTripPreview(trip.route);

        this.titleItem = new PopupMenu.PopupSeparatorMenuItem(this.trip.name);
        this.timeItems = Array.from({ length: this.trip.nextBusesCount }, () => new PopupMenu.PopupMenuItem(NO_BUS_STRING));
    }

    get preview() {
        return this.nextTimePreview.container;
    }

    updateBusTimes(date) {
        const currentTime = (date.getHours() * 3600) + (date.getMinutes() * 60) + date.getSeconds();

        const nextBuses = TripManager.instance.getNextBuses(this.trip.uuid, currentTime);
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
        this.#updateStyle();
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
        } else if (this.bus.deltaTime <= (5 * 60)) {
            // this.timeBox.add_style_class_name('time-box-critical');
            this.timeLabel.add_style_class_name('time-label-critical');
        } else if (this.bus.deltaTime <= (10 * 60)) {
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
        }

        addTripItemToMenu(tripItem) {
            this.menu.addMenuItem(tripItem.titleItem);
            tripItem.timeItems.forEach(item => {
                this.menu.addMenuItem(item);
            });
            this.mainContainer.add_child(tripItem.preview);
        }

        updateBusTimes(date) {
            for (let tripItem of this.busItems)
                tripItem.updateBusTimes(date);
        }
    });

new TripManager([
    new Trip('Campus Région numérique', 'Gorge de Loup', '86', 4),
    new Trip('Campus Région numérique', 'Pont Mouton', '5', 2),
]);

class Extension {
    #lastFetchedDate = null;

    constructor(uuid) {
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
        this._uuid = uuid;
    }

    enable() {
        this.#createNextBusButton();
        this.#createUpdater();
        this.update();
    }

    disable() {
        this.#destroyUpdater();
        this.#destroyNextBusButton();
    }

    update() {
        const date = new Date();
        if (this.#shouldFetchTimes(date)) {
            this.#fetchBusStopTimes(date);
        } else {
            this._nextBusButton.updateBusTimes(date);
        }
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

    #shouldFetchTimes(todayDate) {
        return this.#lastFetchedDate != dateTimeToDate(todayDate);
    }

    #fetchBusStopTimes(todayDate) {
        this.#lastFetchedDate = dateTimeToDate(todayDate);

        const year = todayDate.getFullYear();
        const month = String(todayDate.getMonth() + 1).padStart(2, '0');
        const day = String(todayDate.getDate()).padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;

        for (const trip of TripManager.instance.getTrips()) {
            spawnCommandLineAsync(`sh get_times.sh "tcl_gtfs.sqlite" "${trip.stop}" "${trip.destination}" "${trip.route}" "${formattedDate}"`, metadata.path, (result, stdout, stderr, status) => {
                if (result && status === 0) {
                    const times = stdout.trim().split('\n').map(parseTime);
                    TripManager.instance.setTimesForTrip(trip, times);
                    this.update(todayDate);
                } else {
                    logError(_('Error fetching bus stop times'), stderr, true)
                    console.error(stderr);
                }
            });
        }
    }
}

function init(meta) {
    metadata = meta;
    return new Extension(meta.uuid);
}
