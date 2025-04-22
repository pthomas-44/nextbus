SELECT stop_times.departure_time
FROM stop_times
WHERE stop_times.stop_id IN
    (SELECT stops.stop_id
     FROM stops
     WHERE stops.stop_name = '{{STOP_NAME}}')
  AND stop_times.trip_id IN
    (SELECT trips.trip_id
     FROM trips
     WHERE trips.trip_headsign = '{{HEADSIGN}}'
       AND (trips.service_id IN
              (SELECT calendar.service_id
               FROM calendar
               WHERE replace('{{DATE}}', '-', '') BETWEEN calendar.start_date AND calendar.end_date
                 AND ((strftime('%w', '{{DATE}}') = '0'
                       AND calendar.sunday = 1)
                      OR (strftime('%w', '{{DATE}}') = '1'
                          AND calendar.monday = 1)
                      OR (strftime('%w', '{{DATE}}') = '2'
                          AND calendar.tuesday = 1)
                      OR (strftime('%w', '{{DATE}}') = '3'
                          AND calendar.wednesday = 1)
                      OR (strftime('%w', '{{DATE}}') = '4'
                          AND calendar.thursday = 1)
                      OR (strftime('%w', '{{DATE}}') = '5'
                          AND calendar.friday = 1)
                      OR (strftime('%w', '{{DATE}}') = '6'
                          AND calendar.saturday = 1))
                 AND service_id NOT IN
                   (SELECT service_id
                    FROM calendar_dates
                    WHERE date = replace('{{DATE}}', '-', '')
                      AND exception_type = 2))
            OR trips.service_id IN
              (SELECT service_id
               FROM calendar_dates
               WHERE date = replace('{{DATE}}', '-', '')
                 AND exception_type = 1))
       AND trips.route_id IN
         (SELECT routes.route_id
          FROM routes
          WHERE routes.route_short_name = '{{ROUTE_NAME}}'))
ORDER BY stop_times.departure_time;