"use client";
import { useParams } from "next/navigation";

const StopDetail = () => {
	const { id } = useParams();
	return <div>Stop Detail {id}</div>;
};

export default StopDetail;
