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

class Trip {
    constructor(id, name, tag) {
        this.id = id;
        this.name = name;
        this.tag = tag;
    }
}

// Identifiants des trajets de bus
const trips = [
    new Trip('86A_18_2_040AM', '86 - Gorge de Loup', '86'),
    // new Trip('86A_18_1_040AM', '86 - La Tour de Salvagny Chambettes', '86'),
    new Trip('5A_34_2_046AB', '5 - Pont Mouton', '5'),
    // new Trip('5A_34_1_046AB', '5 - Charbonnières Les Verrières', '5'),
];


/**
 * Classe représentant un élément de trajet.
 */
class TripItem {
    constructor(trip) {
        this.trip = trip;
        this.activated = true;

        this.init_menu();
        this.nextTimePreview = new NextTripPreview(this.trip.tag);
    }

    init_menu() {
        this.titleItem = new PopupMenu.PopupSeparatorMenuItem(this.trip.name);
        this.timeItems = [];
        for (let i = 0; i < 3; i++)
            this.timeItems.push(new PopupMenu.PopupMenuItem('N/A min'));
    }

    get_preview() {
        return this.nextTimePreview.container;
    }

    getNextBusTimes() {
        if (!GLib.file_test(jsonPath, GLib.FileTest.EXISTS))
            return [];

        const [isOk, fileContent] = GLib.file_get_contents(jsonPath); 
        let busData;

        try {
            busData = JSON.parse(fileContent);
        } catch (e) {
            throw new Error('Erreur de parsing du JSON');
        }

        const currentTime = new Date();
        const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

        const nextTimes = busData
            .filter(bus => bus.trip_id === this.trip.id)
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
        this.nextTimePreview.update_time = nextTimes[0] !== undefined ? nextTimes[0] + " min" : "N/A min";
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

class NextTripPreview {
    constructor(busLabel) {
        this._init(busLabel);
    }

    _init(busLabel) {
        this.container = new St.BoxLayout({ vertical: false });
        let busbox = new St.BoxLayout({ vertical: false });
        let timebox = new St.BoxLayout({ vertical: false });

        this.signInStatusLabel = new St.Label({ text: busLabel });
        this.signInStatusLabel.set_style('font-weight: bold; font-size: 15px;');

        this.timeLabel = new St.Label({ text: "N/A min" });
        this.timeLabel.set_style('color: white; font-weight: bold; font-size: 15px;');

        busbox.add_child(this.signInStatusLabel);
        busbox.set_style(`
            background-color: white;
            color: rgb(236, 28, 36);
            border: 2px solid rgb(236, 28, 36);
            border-radius: 1px;
            padding-left: 4px;
            padding-right: 4px;
            margin: 5px;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
        `);

        timebox.add_child(this.timeLabel);
        timebox.set_style(`
            background-color: darkgreen;
            border-radius: 1px;
            padding-left: 4px;
            padding-right: 4px;
            margin: 5px;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
        `);

        this.container.add_child(busbox);
        this.container.add_child(timebox);
    }

    set update_time(text) {
        this.timeLabel.text = text;
    }
}

/**
 * Classe représentant le bouton du menu GNOME pour afficher les horaires des bus.
 */
const NextBusButton = GObject.registerClass(
class NextBusButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('NextBusButton'));
        this.mainContainer = new St.BoxLayout({ vertical: false });
        this.set_style(`
            border-radius: 1px;
            display: flex;
            align-items: center;
            justify-content: center;
        `);

        // Crée les item pour chaque trajet
        this.busItems = [];
        for(let i = 0; i < trips.length; i++)
            this.busItems.push(new TripItem(trips[i]));

        // Affiche les items dans le menu
        this.busItems.forEach(item => {
            if (item.activated)
                this.addTripItemToMenu(item);
        });

        this.add_child(this.mainContainer);
        this.updateBusTimes(); // Mise à jour immédiate des horaires des bus
    }

    addTripItemToMenu(tripItem) {
        this.menu.addMenuItem(tripItem.titleItem);
        tripItem.timeItems.forEach(item => {
            this.menu.addMenuItem(item);
        });
        this.mainContainer.add_child(tripItem.get_preview());
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
    }

    enable() {
        this.createNextBusButton();
        fetchBusStopTimes(this._NextBusButton);
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
