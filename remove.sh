#!/bin/bash

EXTENSION_NAME="nextbus@42toolbar"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
EXTENSION_PATH="$EXTENSIONS_DIR/$EXTENSION_NAME"

if [ ! -d "$EXTENSION_PATH" ]; then
    echo "Extension '$EXTENSION_NAME' is not installed."
    exit 1
fi

echo "⚠️ The extension '$EXTENSION_NAME' is installed."
read -p "Do you want to remove it? (y/n): " choice

if [[ ! "$choice" =~ ^([Yy]|[Yy][Ee][Ss])$ ]]; then
    echo "Removal aborted."
    exit 0
fi

gnome-extensions disable "$EXTENSION_NAME"
rm -rf "$EXTENSION_PATH"

echo "✅ Extension '$EXTENSION_NAME' has been removed."
