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
