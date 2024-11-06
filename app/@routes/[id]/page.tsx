"use client";
import { useParams } from "next/navigation";

const RouteDetail = () => {
	const { id } = useParams();
	return <div>Route Detail {id}</div>;
};

export default RouteDetail;
