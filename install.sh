#!/bin/bash

EXTENSION_NAME="nextbus@42toolbar"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
EXTENSION_PATH="$EXTENSIONS_DIR/$EXTENSION_NAME"

echo "Checking dependencies..."
if ! command -v gnome-extensions &> /dev/null; then
    echo "The GNOME Extensions tool is not installed."
    echo "Please install it using:"
    echo "    sudo apt install -y gnome-shell-extension-prefs gnome-shell-extensions"
    exit 1
fi

if [ -d "$EXTENSION_PATH" ]; then
    echo "⚠️  The extension '$EXTENSION_NAME' is already installed."
    read -p "Do you want to reinstall it? (y/n): " choice

    if [[ ! "$choice" =~ ^([Yy]|[Yy][Ee][Ss])$ ]]; then
        echo "Installation aborted."
        exit 0
    fi

    echo "Removing old extension..."
    rm -rf "$EXTENSION_PATH"
fi

echo "Installing extension..."
mkdir -p "$EXTENSION_PATH"
cp extension/* "$EXTENSION_PATH"
cp remove.sh "$EXTENSION_PATH"

echo "🔄 Restarting GNOME and activating the extension..."
killall -HUP gnome-shell
gnome-extensions enable "$EXTENSION_NAME"

echo "✅ Installation complete!"
echo "🚀 You can now remove this repository."
