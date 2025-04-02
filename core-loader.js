const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const ExtensionUtils = imports.misc.extensionUtils;
const ExtensionManager = Main.extensionManager;

const CORE_42TOOLBAR_UUID = "core@42toolbar";

var handler = null;

var ExtensionBase = class ExtensionBase {
    #enabled = false;

    constructor(uuid) {
        this._uuid = uuid;
    }

    enable() {
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 0.1, () => !this.#tryRegisterExtension());
    }

    onExtensionRegistered() {
        this.#enabled = true;
        this.onEnable?.();
    }

    disable() {
        if (this.#enabled) {
            try {
                handler?.unregisterExtension(this);
            } catch (error) {
            }
            this.onDisable?.();
            this.#enabled = false;
        }
    }

    #tryRegisterExtension() {
        let coreToolbarExtension = this.#getExtensionImports(CORE_42TOOLBAR_UUID);
        if (coreToolbarExtension) {
            let handlerGetter = coreToolbarExtension["getToolbarHandler"];
            if (handlerGetter == null) {
                console.error(`Failed to get a valid ${CORE_42TOOLBAR_UUID} instance. Are you up-to-date?`);
                return true; // core extension found but invalid, do not retry
            }

            handler = handlerGetter();

            if (handler.registerExtension == null) {
                console.error(`Failed to get a valid ${CORE_42TOOLBAR_UUID} instance. Are you up-to-date?`);
                return true; // core extension found but invalid, do not retry
            }

            handler.registerExtension(this);
            return true;
        }
        return false;
    }

    #getExtensionImports(uuid) {
        let extension = ExtensionManager.lookup(uuid);
        if (extension?.state === ExtensionUtils.ExtensionState.ENABLED) {
            try {
                return extension.imports?.extension;
            } catch (e) {
                logError(e, `Failed to call function ${functionName} from extension ${uuid}`);
            }
        }
        return null;
    }
}
