.mode csv

-- -- agency.txt
-- DROP TABLE IF EXISTS agency;
-- CREATE TABLE agency (
--     agency_id TEXT NOT NULL PRIMARY KEY,
--     agency_name TEXT,
--     agency_url TEXT,
--     agency_timezone TEXT,
--     agency_lang TEXT
--     -- agency_phone TEXT,
--     -- agency_fare_url TEXT,
--     -- agency_email TEXT
-- );
-- .import {{GTFS_PATH}}/agency.txt agency

-- calendar.txt
DROP TABLE IF EXISTS calendar;
CREATE TABLE calendar (
    service_id TEXT NOT NULL PRIMARY KEY,
    monday INTEGER,
    tuesday INTEGER,
    wednesday INTEGER,
    thursday INTEGER,
    friday INTEGER,
    saturday INTEGER,
    sunday INTEGER,
    start_date INTEGER,
    end_date INTEGER
);
.import {{GTFS_PATH}}/calendar.txt calendar

-- calendar_dates.txt
DROP TABLE IF EXISTS calendar_dates;
CREATE TABLE calendar_dates (
    service_id TEXT,
    date TEXT,
    exception_type INTEGER
);
.import {{GTFS_PATH}}/calendar_dates.txt calendar_dates

-- routes.txt
DROP TABLE IF EXISTS routes;
CREATE TABLE routes (
    route_id TEXT NOT NULL PRIMARY KEY,
    agency_id TEXT,
    route_short_name TEXT,
    route_long_name TEXT,
    route_desc TEXT,
    route_type INTEGER,
    -- route_url TEXT,
    route_color TEXT
    -- route_text_color TEXT
);
.import {{GTFS_PATH}}/routes.txt routes

-- stops.txt
DROP TABLE IF EXISTS stops;
CREATE TABLE stops (
    stop_id TEXT NOT NULL PRIMARY KEY,
    -- stop_code TEXT,
    stop_name TEXT,
    -- stop_desc TEXT,
    stop_lat REAL,
    stop_lon REAL,
    -- zone_id TEXT,
    -- stop_url TEXT,
    location_type INTEGER,
    parent_station TEXT,
    -- stop_timezone TEXT,
    wheelchair_boarding INTEGER
);
.import {{GTFS_PATH}}/stops.txt stops

-- stop_times.txt
DROP TABLE IF EXISTS stop_times;
CREATE TABLE stop_times (
    trip_id TEXT,
    arrival_time TEXT,
    departure_time TEXT,
    stop_id TEXT,
    stop_sequence INTEGER,
    -- stop_headsign TEXT,
    pickup_type INTEGER,
    drop_off_type INTEGER
    -- shape_dist_traveled REAL,
    -- timepoint INTEGER
);

CREATE INDEX idx_stop_times_stop_id ON stop_times(stop_id);
CREATE INDEX idx_stop_times_trip_id ON stop_times(trip_id);

.import {{GTFS_PATH}}/stop_times.txt stop_times

-- -- transfers.txt
-- DROP TABLE IF EXISTS transfers;
-- CREATE TABLE transfers (
--     from_stop_id TEXT,
--     to_stop_id TEXT,
--     transfer_type INTEGER,
--     min_transfer_time INTEGER
-- );
-- .import {{GTFS_PATH}}/transfers.txt transfers

-- trips.txt
DROP TABLE IF EXISTS trips;
CREATE TABLE trips (
    route_id TEXT,
    service_id TEXT,
    trip_id TEXT NOT NULL PRIMARY KEY,
    trip_headsign TEXT,
    -- trip_short_name TEXT,
    -- direction_id INTEGER,
    -- block_id TEXT,
    -- shape_id TEXT,
    wheelchair_accessible INTEGER
    -- bikes_allowed INTEGER
);
.import {{GTFS_PATH}}/trips.txt trips
