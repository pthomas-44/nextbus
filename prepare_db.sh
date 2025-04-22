#!/bin/bash

set -e

DB_NAME=${1:-"tcl_gtfs.sqlite"}
ROUTE_NAMES=${2:-"'86','5'"}
STOP_NAMES=${2:-"'Campus Région numérique'"}

TMP_PATH="/goinfre/$USER/nextbus_tmp"
mkdir -p $TMP_PATH

#############################
### Download gtfs
#############################

ZIP_PATH="$TMP_PATH/tcl_gtfs.zip"
ZIP_URL="https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"
EXTRACT_PATH="$TMP_PATH/gtfs"
USERNAME="demo"
PASSWORD="demo4dev"

mkdir -p "$EXTRACT_PATH"
curl -u "$USERNAME:$PASSWORD" -o "$ZIP_PATH" "$ZIP_URL"
unzip "$ZIP_PATH" -d "$EXTRACT_PATH"
rm "$ZIP_PATH"

#############################
### Generate database
#############################

TMP_DB_PATH="$TMP_PATH/$DB_NAME"

echo "Generating SQLite database..."
sed \
  -e "s|{{GTFS_PATH}}|${EXTRACT_PATH}|g" \
  sql/load_gtfs.sql | sqlite3 -batch "$TMP_DB_PATH"

echo "Cleaning unused routes and stops..."
sed \
  -e "s|{{ROUTE_NAMES}}|${ROUTE_NAMES}|g" \
  -e "s|{{STOP_NAMES}}|${STOP_NAMES}|g" \
  sql/clean_db_query.sql | sqlite3 -batch "$TMP_DB_PATH"

mv "$TMP_DB_PATH" "extension/$DB_NAME"
