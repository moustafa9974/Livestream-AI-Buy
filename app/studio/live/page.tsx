import { redirect } from "next/navigation";

// The live studio moved to /studio; keep old links working.
export default function LegacyLive() {
  redirect("/studio");
}
