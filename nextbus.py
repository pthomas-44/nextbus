import requests
import zipfile
import io
import csv
import base64
import os
from datetime import datetime

# Paramètres de configuration
USERNAME = "demo"
PASSWORD = "demo4dev"
ZIP_URL = "https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"
STOP_ID = "2010"
TRIP_ID_PREFIXES = ["86A_18_2_040AM", "5A_34_2_046AB"]  # Préfixes des trip_id
STOP_TIMES_FILENAME = os.path.expanduser("~/goinfre/stop_times.txt")  # Chemin du fichier

# Encodage en base64 pour l'authentification
def get_base64_auth_header(username, password):
    """Retourne un en-tête d'authentification encodé en base64."""
    credentials = f"{username}:{password}"
    return base64.b64encode(credentials.encode()).decode()

# Préparer les headers avec authentification
headers = {"Authorization": f"Basic {get_base64_auth_header(USERNAME, PASSWORD)}"}

def download_and_extract_zip(url, headers, extract_to_filename):
    """Télécharge et extrait l'archive ZIP, puis sauvegarde le fichier stop_times.txt filtré."""
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        try:
            with zipfile.ZipFile(io.BytesIO(response.content)) as zip_ref:
                if extract_to_filename in zip_ref.namelist():
                    with zip_ref.open(extract_to_filename) as extracted_file:
                        return filter_stop_times(extracted_file)
                else:
                    print(f"Le fichier {extract_to_filename} est introuvable dans l'archive.")
        except zipfile.BadZipFile:
            print("Erreur : Le fichier téléchargé n'est pas une archive ZIP valide.")
    else:
        print(f"Erreur lors du téléchargement de l'archive. Code HTTP: {response.status_code}, Message: {response.text}")
    return []

def filter_stop_times(extracted_file):
    """Filtre les horaires des arrêts correspondant aux préfixes de trip_id."""
    filtered_rows = []
    reader = csv.DictReader(io.TextIOWrapper(extracted_file, encoding="utf-8"))
    for row in reader:
        if any(row["trip_id"].startswith(prefix) for prefix in TRIP_ID_PREFIXES):
            filtered_rows.append(row)
    return filtered_rows

def save_stop_times(filtered_rows, filename):
    """Sauvegarde les horaires filtrés dans un fichier CSV."""
    if filtered_rows:
        with open(filename, "w", newline="", encoding="utf-8") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=filtered_rows[0].keys())
            writer.writeheader()
            writer.writerows(filtered_rows)
        print(f"Fichier {filename} enregistré.")
    else:
        print(f"Aucun horaire à sauvegarder dans {filename}.")

def get_next_buses(stop_id, file_path):
    """Récupère et affiche les trois prochains horaires de bus pour un arrêt donné."""
    horaires = []
    now = datetime.now().time()

    with open(file_path, encoding="utf-8") as file:
        reader = csv.DictReader(file)
        for row in reader:
            if row["stop_id"] == stop_id and any(row["trip_id"].startswith(prefix) for prefix in TRIP_ID_PREFIXES):
                try:
                    horaire = datetime.strptime(row["arrival_time"], "%H:%M:%S").time()
                    if horaire > now:
                        horaires.append(horaire)
                except ValueError:
                    continue

    horaires.sort()
    return horaires[:3]

def should_download_new_archive():
    """Vérifie si le fichier doit être téléchargé en fonction de la date de modification."""
    if os.path.exists(STOP_TIMES_FILENAME):
        last_modified_time = os.path.getmtime(STOP_TIMES_FILENAME)
        last_modified_date = datetime.fromtimestamp(last_modified_time).date()
        if last_modified_date == datetime.now().date():
            print("Le fichier stop_times.txt a été modifié aujourd'hui. Utilisation du fichier existant.")
            return False
    return True

if should_download_new_archive():
    filtered_rows = download_and_extract_zip(ZIP_URL, headers, "stop_times.txt")
    save_stop_times(filtered_rows, STOP_TIMES_FILENAME)

if os.path.exists(STOP_TIMES_FILENAME):
    horaires_86 = get_next_buses(STOP_ID, STOP_TIMES_FILENAME)
    horaires_5 = get_next_buses(STOP_ID, STOP_TIMES_FILENAME)

    if horaires_86 or horaires_5:
        print(f"Prochains bus de la ligne 86 :")
        for horaire in horaires_86:
            print(f" - {horaire}")
        print(f"Prochains bus de la ligne 5 :")
        for horaire in horaires_5:
            print(f" - {horaire}")
        print("RAPPEL : Le bus 5 met ~15min de plus à arriver à Valmy que la correspondance bus 86 + métro D.")
    else:
        print("Aucun horaire à venir pour cet arrêt et ces lignes aujourd'hui.")
else:
    print("Le fichier stop_times.txt est introuvable.")
