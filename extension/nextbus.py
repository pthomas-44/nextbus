#!/usr/bin/python3

import requests
import zipfile
import io
import csv
import base64
import os
import sys
import json
from datetime import datetime

# Configuration parameters
USERNAME = "demo"
PASSWORD = "demo4dev"
ZIP_URL = "https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"
STOP_IDS = ["2010", "2011"]
TRIP_ID_PREFIXES = ["5A_34_1_046AB", "5A_34_2_046AB", "86A_18_1_040AM", "86A_18_2_040AM"]
STOP_TIMES_FILENAME = os.path.expanduser("~/goinfre/stop_times.json")

def get_base64_auth_header(username, password):
    credentials = f"{username}:{password}"
    return base64.b64encode(credentials.encode()).decode()

headers = {"Authorization": f"Basic {get_base64_auth_header(USERNAME, PASSWORD)}"}

def extract_trip_prefix(trip_id):
    for prefix in TRIP_ID_PREFIXES:
        if trip_id.startswith(prefix):
            return prefix
    return trip_id  # If no prefix matches, keep original trip_id

def download_and_extract_zip(url, headers, extract_to_filename):
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        try:
            with zipfile.ZipFile(io.BytesIO(response.content)) as zip_ref:
                if extract_to_filename in zip_ref.namelist():
                    with zip_ref.open(extract_to_filename) as extracted_file:
                        sys.stdout.write("ZIP file extracted successfully.\n")
                        return filter_stop_times(extracted_file)
                else:
                    sys.stderr.write(f"Error: The file {extract_to_filename} was not found in the archive.\n")
                    return 2
        except zipfile.BadZipFile:
            sys.stderr.write("Error: The downloaded file is not a valid ZIP archive.\n")
            return 3
    else:
        sys.stderr.write(f"Error downloading the archive. HTTP Code: {response.status_code}, Message: {response.text}\n")
        return 1

def filter_stop_times(extracted_file):
    filtered_rows = []
    reader = csv.DictReader(io.TextIOWrapper(extracted_file, encoding="utf-8"))
    for row in reader:
        if any(row['trip_id'].startswith(prefix) for prefix in TRIP_ID_PREFIXES) and row['stop_id'] in STOP_IDS:
            row['trip_id'] = extract_trip_prefix(row['trip_id'])  # Replace trip_id with its prefix
            filtered_rows.append(row)
    sys.stdout.write(f"Filtered {len(filtered_rows)} stop times.\n")
    return filtered_rows

def save_as_json(filtered_rows, filename):
    if filtered_rows:
        try:
            with open(filename, "w", encoding="utf-8") as output_file:
                json.dump(filtered_rows, output_file, ensure_ascii=False, indent=4)
            sys.stderr.write(f"File {filename} saved.\n")
            sys.stdout.write(f"Stop times saved to {filename}.\n")
            return 0
        except Exception as e:
            sys.stderr.write(f"Error saving the file: {e}\n")
            return 4
    else:
        sys.stderr.write(f"No stop times to save in {filename}.\n")
        return 5

def should_download_new_archive():
    if os.path.exists(STOP_TIMES_FILENAME):
        last_modified_time = os.path.getmtime(STOP_TIMES_FILENAME)
        last_modified_date = datetime.fromtimestamp(last_modified_time).date()
        if last_modified_date == datetime.now().date():
            sys.stdout.write("The stop_times.json file was modified today. Using the existing file.\n")
            return False
    return True

if should_download_new_archive():
    filtered_rows = download_and_extract_zip(ZIP_URL, headers, "stop_times.txt")
    if isinstance(filtered_rows, int):
        sys.exit(filtered_rows)
    error_code = save_as_json(filtered_rows, STOP_TIMES_FILENAME)
    if error_code == 0:
        sys.exit(0)
    else:
        sys.stderr.write("The file was not updated, error during saving.\n")
        sys.exit(error_code)
else:
    sys.stdout.write("No update needed, the file is already up to date.\n")
    sys.exit(0)
