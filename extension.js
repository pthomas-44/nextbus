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


// Chemin du fichier JSON contenant les horaires des bus
const jsonPath = GLib.build_filenamev([GLib.get_home_dir(), 'goinfre', 'stop_times.json']);

// Identifiants des trajets de bus
const trips = [
    { id: '5A_34_1_046AB', name: '5 - Charbonnières Les Verrières' },
    { id: '5A_34_2_046AB', name: '5 - Pont Mouton' },
    { id: '86A_18_1_040AM', name: '86 - La Tour de Salvagny Chambettes' },
    { id: '86A_18_2_040AM', name: '86 - Gorge de Loup' }
];

/**
 * Classe représentant un élément de trajet.
 */
class TripItem {
    constructor(tripId, title) {
        this.tripId = tripId;
        this.titleItem = new PopupMenu.PopupSeparatorMenuItem(title);
        this.timeItems = [];
        for (let i = 0; i < 3; i++)
            this.timeItems.push(new PopupMenu.PopupMenuItem('N/A min'));
        this.activated = true;
    }

    getNextBusTimes() {
        if (!GLib.file_test(jsonPath, GLib.FileTest.EXISTS))
            return [];

        const fileContents = GLib.file_get_contents(jsonPath)[1];
        let busData;

        try {
            busData = JSON.parse(fileContents);
        } catch (e) {
            throw new Error('Erreur de parsing du JSON');
        }

        const currentTime = new Date();
        const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

        const nextTimes = busData
            .filter(bus => bus.trip_id === this.tripId)
            .map(bus => {
                const [hours, minutes] = bus.arrival_time.split(':').map(Number);
                return hours * 60 + minutes;
            })
            .filter(arrivalMinutes => arrivalMinutes > currentMinutes)
            .sort((a, b) => a - b)
            .slice(0, 3)
            .map(arrivalMinutes => arrivalMinutes - currentMinutes); // Conversion en minutes restantes

        for (let i = 0; i < 3; i++)
            this.timeItems[i].label.text = nextTimes[i] !== undefined ? nextTimes[i] + " min" : "N/A min";
    }
}

/**
 * Lit un flux de données et retourne son contenu sous forme de promesse.
 */
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

/**
 * Exécute une commande shell de manière asynchrone et retourne son résultat
 */
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

/**
 * Exécute un script Python pour récupérer les horaires des bus et affiche le résultat dans la console.
 * Utilise `spawnCommandLineAsync` pour exécuter le script `nextbus.py` et traite les erreurs.
 */
function fetchBusStopTimes(nextBusButton) {
    spawnCommandLineAsync(`python3 ${metadata.path}/nextbus.py`, (result, stdout, stderr, status) => {
        if (result && status === 0) {
            console.log(stdout);
            nextBusButton.updateBusTimes();
        }
        else
            console.error(stderr);
        return result;
    });
}

/**
 * Classe représentant le bouton du menu GNOME pour afficher les horaires des bus.
 */
const NextBusButton = GObject.registerClass(
class NextBusButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('NextBusButton'));

        this.add_child(new St.Label({ text: _('LES BUS') }));

        // Crée les item pour chaque trajet
        this.busItems = [];
        for(let i = 0; i < trips.length; i++)
            this.busItems.push(new TripItem(trips[i].id, trips[i].name));

        // Affiche les premières horaires dans la toolbar
        

        // Affiche les items dans le menu
        this.busItems.forEach(item => {
            if (item.activated)
                this.addTripItemToMenu(item);
        });

        this.updateBusTimes(); // Mise à jour immédiate des horaires des bus
    }

    addTripItemToMenu(tripItem) {
        this.menu.addMenuItem(tripItem.titleItem);
        tripItem.timeItems.forEach(item => {
            this.menu.addMenuItem(item);
        });
    }

    updateBusTimes() {
        for (let i = 0; i < this.busItems.length; i++)
            this.busItems[i].getNextBusTimes();
    }
});

/**
 * Classe représentant l'extension GNOME.
 */
class Extension {
    constructor(uuid) {
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
        this._uuid = uuid;
        fetchBusStopTimes(this._NextBusButton);
    }

    enable() {
        this.createNextBusButton();

        // Mise à jour des horaires toutes les 5 secondes
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._NextBusButton.updateBusTimes();
            return true;
        });
    }

    disable() {
        this.destroyNextBusButton();
    }

    createNextBusButton() {
        if (this._NextBusButton)
            return;
        this._NextBusButton = new NextBusButton();
        Main.panel._centerBox.add_child(this._NextBusButton.container);
    }

    destroyNextBusButton() {
        if (!this._NextBusButton)
            return;
        Main.panel._centerBox.remove_child(this._NextBusButton.container);
        this._NextBusButton.destroy();
        this._NextBusButton = null;
    }
}

/**
 * Fonction d'initialisation de l'extension.
 * @param {Object} meta - Métadonnées de l'extension.
 * @returns {Extension} Instance de l'extension.
 */
function init(meta) {
    
    metadata = meta;
    return new Extension(meta.uuid);
}
