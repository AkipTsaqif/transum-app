"use client";

import Map, { NavigationControl } from "react-map-gl/maplibre";
import { useState } from "react";

const MainMapComponent = () => {
	const [viewState, setViewState] = useState({
		latitude: -6.1907,
		longitude: 106.8228,
		zoom: 11,
	});

	return (
		<Map
			{...viewState}
			onMove={(e) => setViewState(e.viewState)}
			style={{ width: "100%", height: "100vh" }}
			mapStyle={
				"https://api.maptiler.com/maps/streets/style.json?key=BrpsEqmYwqOM5P8UK511"
			}
		></Map>
	);
};

export default MainMapComponent;
