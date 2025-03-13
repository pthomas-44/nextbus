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
USERNAME = "demo"  # Username for basic authentication
PASSWORD = "demo4dev"  # Password for basic authentication
ZIP_URL = "https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"  # URL to the GTFS ZIP file
STOP_IDS = ["2010", "2011"]  # List of stop IDs to filter
TRIP_ID_PREFIXES = ["5A_34_1_046AB", "5A_34_2_046AB", "86A_18_1_040AM", "86A_18_2_040AM"]  # List of prefixes to filter trip IDs
STOP_TIMES_FILENAME = os.path.expanduser("~/goinfre/stop_times.json")  # Path to save the stop times JSON file

# Base64 encoding for authentication
def get_base64_auth_header(username, password):
    """
    Returns a base64-encoded authentication header for Basic Auth.

    Args:
        username (str): The username for authentication.
        password (str): The password for authentication.

    Returns:
        str: Base64-encoded authorization header.
    """
    credentials = f"{username}:{password}"  # Combine username and password
    return base64.b64encode(credentials.encode()).decode()  # Return base64-encoded header

# Prepare headers with authentication
headers = {"Authorization": f"Basic {get_base64_auth_header(USERNAME, PASSWORD)}"}  # Authorization header

def download_and_extract_zip(url, headers, extract_to_filename):
    """
    Downloads a ZIP archive and extracts the specified file.

    Args:
        url (str): URL to download the ZIP file.
        headers (dict): Headers to include in the HTTP request.
        extract_to_filename (str): Name of the file to extract from the ZIP archive.

    Returns:
        list or int: Filtered rows from the extracted CSV file, or an error code.
    """
    # Send GET request to download the ZIP file
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        try:
            with zipfile.ZipFile(io.BytesIO(response.content)) as zip_ref:
                # Check if the required file is present in the ZIP
                if extract_to_filename in zip_ref.namelist():
                    with zip_ref.open(extract_to_filename) as extracted_file:
                        sys.stdout.write("ZIP file extracted successfully.\n")  # Info message
                        return filter_stop_times(extracted_file)  # Extract and filter the stop times
                else:
                    sys.stderr.write(f"Error: The file {extract_to_filename} was not found in the archive.\n")
                    return 2  # Error code for file not found
        except zipfile.BadZipFile:
            sys.stderr.write("Error: The downloaded file is not a valid ZIP archive.\n")
            return 3  # Error code for invalid ZIP file
    else:
        sys.stderr.write(f"Error downloading the archive. HTTP Code: {response.status_code}, Message: {response.text}\n")
        return 1  # Error code for failed download

    return []  # Default return if everything goes well

def filter_stop_times(extracted_file):
    """
    Filters the stop times corresponding to the specified stop IDs and trip ID prefixes.

    Args:
        extracted_file (file-like object): The extracted CSV file to process.

    Returns:
        list: A list of filtered stop time rows.
    """
    filtered_rows = []  # List to hold filtered rows
    reader = csv.DictReader(io.TextIOWrapper(extracted_file, encoding="utf-8"))  # Read the CSV file
    for row in reader:
        # Check if the stop_id is in the STOP_IDS list
        if any(row['trip_id'].startswith(prefix) for prefix in TRIP_ID_PREFIXES) and row['stop_id'] in STOP_IDS:
            filtered_rows.append(row)  # Add to filtered rows if condition is met
    sys.stdout.write(f"Filtered {len(filtered_rows)} stop times.")  # Info message
    return filtered_rows

def save_as_json(filtered_rows, filename):
    """
    Saves the filtered stop times to a JSON file.

    Args:
        filtered_rows (list): The filtered stop time rows.
        filename (str): The file path to save the data.

    Returns:
        int: Status code indicating success or failure.
    """
    if filtered_rows:
        try:
            with open(filename, "w", encoding="utf-8") as output_file:
                json.dump(filtered_rows, output_file, ensure_ascii=False, indent=4)
            sys.stderr.write(f"File {filename} saved.\n")
            sys.stdout.write(f"Stop times saved to {filename}.")  # Info message
            return 0  # Success
        except Exception as e:
            sys.stderr.write(f"Error saving the file: {e}\n")
            return 4  # Error code for saving issue
    else:
        sys.stderr.write(f"No stop times to save in {filename}.\n")
        return 5  # Error code if no data to save

def should_download_new_archive():
    """
    Checks if the archive should be downloaded based on the file's modification date.

    Returns:
        bool: True if the archive should be downloaded, False if it's up to date.
    """
    if os.path.exists(STOP_TIMES_FILENAME):
        last_modified_time = os.path.getmtime(STOP_TIMES_FILENAME)  # Get file's last modified time
        last_modified_date = datetime.fromtimestamp(last_modified_time).date()  # Convert to date
        if last_modified_date == datetime.now().date():
            sys.stdout.write("The stop_times.json file was modified today. Using the existing file.\n")
            return False  # No need to download if it's up to date
    return True  # Download if file is not up to date

# Main process
if should_download_new_archive():
    filtered_rows = download_and_extract_zip(ZIP_URL, headers, "stop_times.txt")
    if isinstance(filtered_rows, int):  # Check if an error was returned
        sys.exit(filtered_rows)  # Exit with error code
    error_code = save_as_json(filtered_rows, STOP_TIMES_FILENAME)
    if error_code == 0:  # If saving succeeds, exit successfully
        sys.exit(0)
    else:
        sys.stderr.write("The file was not updated, error during saving.\n")
        sys.exit(error_code)  # Exit with the corresponding error code
else:
    sys.stdout.write("No update needed, the file is already up to date.\n")
    sys.exit(0)  # Exit without error
