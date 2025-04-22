DELETE FROM routes WHERE route_short_name NOT IN ({{ROUTE_NAMES}});

DELETE FROM stops WHERE stop_name NOT IN ({{STOP_NAMES}});

DELETE FROM trips WHERE route_id NOT IN (SELECT route_id FROM routes);

DELETE FROM stop_times WHERE trip_id NOT IN (SELECT trip_id FROM trips);
DELETE FROM stop_times WHERE stop_id NOT IN (SELECT stop_id FROM stops);

DELETE FROM calendar WHERE service_id NOT IN (SELECT DISTINCT service_id FROM trips);

DELETE FROM calendar_dates WHERE service_id NOT IN (SELECT DISTINCT service_id FROM trips);

-- DELETE FROM transfers WHERE from_stop_id NOT IN (SELECT stop_id FROM stops) AND to_stop_id NOT IN (SELECT stop_id FROM stops);

VACUUM; -- reclaim disc space
