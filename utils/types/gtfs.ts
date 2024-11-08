export interface Route {
    route_id: string;
    agency_id: string;
    route_short_name: string;
    route_long_name: string;
    route_desc: string;
    route_type: string;
    route_color: string;
    route_text_color: string;
}

export interface Shape {
    shape_id: string;
    shape_pt_lat: string;
    shape_pt_lon: string;
    shape_pt_sequence: string;
    shape_dist_traveled: string;
}

export interface Trip {
    route_id: string;
    service_id: string;
    trip_id: string;
    trip_headsign: string;
    trip_short_name: string;
    direction_id: string;
    block_id: string;
    shape_id: string;
}

export interface StopTime {
    trip_id: string;
    arrival_time: string;
    departure_time: string;
    stop_id: string;
    stop_sequence: string;
    stop_headsign: string;
    pickup_type: string;
    drop_off_type: string;
    shape_dist_traveled: string;
    timepoint: string;
}

export interface Stop {
    stop_id: string;
    stop_code: string;
    stop_name: string;
    stop_desc: string;
    stop_lat: string;
    stop_lon: string;
    zone_id: string;
    stop_url: string;
    location_type: string;
    parent_station: string;
    stop_timezone: string;
    wheelchair_boarding: string;
    platform_code: string;
}
