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
            this.timeItems.push(new PopupMenu.PopupMenuItem('...'));
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
            this.timeItems[i].label.text = nextTimes[i] !== undefined ? nextTimes[i] + " min" : "...";
        this.nextTimePreview.update_time = nextTimes[0] !== undefined ? nextTimes[0] + " min" : "...";
    }
}

class NextTripPreview {
    constructor(busLabel) {
        this._init(busLabel);
    }

    _init(busLabel) {
        this.container = new St.BoxLayout({ vertical: false });
        this.timeLabel = new St.Label();
        this.timebox = new St.BoxLayout({ vertical: false });
        
        this.signInStatusLabel = new St.Label({ text: busLabel });
        this.signInStatusLabel.set_style('font-weight: bold; font-size: 15px;');
        
        let busbox = new St.BoxLayout({ vertical: false });
        busbox.add_child(this.signInStatusLabel);
        busbox.set_style(`
            background-color: white;
            color: rgb(236, 28, 36);
            border: 2px solid rgb(236, 28, 36);
            border-radius: 1px;
            padding-left: 4px;
            padding-right: 4px;
            margin: 5px 5px 5px 0px;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
        `);

        this.timebox.add_child(this.timeLabel);

        this.container.add_child(busbox);
        this.container.add_child(this.timebox);

        this.update_time = "...";
    }

    set_time_style() {
        var box_style = `
            border-radius: 1px;
            padding-left: 4px;
            padding-right: 4px;
            margin: 5px 5px 5px 0px;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: black; /* Fond noir constant */
        `;
        var text_style = `
            font-weight: bold;
            font-size: 15px;
        `;

        // Extraire le temps de timeLabel et vérifier si c'est un nombre
        let time = parseInt(this.timeLabel.text);
        if (isNaN(time)) {
            time = -1;
        }

        // Définir les couleurs en fonction de la valeur de time
        if (time == -1) {
            text_style += 'color: lightgray;';
            box_style += 'border: 2px solid lightgray;';
        } else if (time <= 5) {
            text_style += 'color: tomato;';
            box_style += 'border: 2px solid tomato;';
        } else if (time <= 10) {
            text_style += 'color: gold;';
            box_style += 'border: 2px solid gold;';
        } else {
            text_style += 'color: lightgreen;';
            box_style += 'border: 2px solid lightgreen;';
        }

        // Appliquer le style combiné
        this.timebox.set_style(box_style);
        this.timeLabel.set_style(text_style);
    }

    set update_time(text) {
        this.timeLabel.text = text;
        this.set_time_style();
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
class NextBusExtension extends CoreLoader.ExtensionBase {
    constructor(uuid) {
        super(uuid);
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    onEnable() {
        this.#fetchBusStopTimes(this._NextBusButton);
        this.createNextBusButton();
        // Mise à jour des horaires toutes les 5 secondes
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._NextBusButton.updateBusTimes();
            return true;
        });
    }

    onDisable() {
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

    /**
     * Exécute un script Python pour récupérer les horaires des bus et affiche le résultat dans la console.
     * Utilise `spawnCommandLineAsync` pour exécuter le script `nextbus.py` et traite les erreurs.
     */
    #fetchBusStopTimes(nextBusButton) {
        CoreLoader.handler.spawnCommandLineAsync(`python3 ${metadata.path}/nextbus.py`, (result, stdout, stderr, status) => {
            if (result && status === 0) {
                console.log(stdout);
                nextBusButton.updateBusTimes();
            }
            else
                console.error(stderr);
            return result;
        });
    }
}

/**
 * Fonction d'initialisation de l'extension.
 * @param {Object} meta - Métadonnées de l'extension.
 * @returns {Extension} Instance de l'extension.
 */
function init(meta) {
    metadata = meta;
    return new NextBusExtension(meta.uuid);
}
