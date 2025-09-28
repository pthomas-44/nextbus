#!/bin/bash

DB_NAME=${1:-"tcl_gtfs.sqlite"}
STOP_NAME=${2:-"Campus Région numérique"}
HEADSIGN=${3:-"Gorge de Loup"}
ROUTE_NAME=${4:-"86"}
DATE=${5:-"2025-09-28"}

sed \
  -e "s/{{STOP_NAME}}/${STOP_NAME}/g" \
  -e "s/{{HEADSIGN}}/${HEADSIGN}/g" \
  -e "s/{{ROUTE_NAME}}/${ROUTE_NAME}/g" \
  -e "s/{{DATE}}/${DATE}/g" \
  sql/today_times_query.sql | sqlite3 "$DB_NAME"
