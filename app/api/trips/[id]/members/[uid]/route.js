import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentUser, requireMember, isSiteAdmin } from "@/lib/auth";

// Promote/demote a member between 'member' and 'admin'. Owner (or site
// admin) only. The owner role itself is never changed here.
export async function PATCH(req, { params }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;
  if (role !== "owner" && !isSiteAdmin(u))
    return NextResponse.json({ error: "Only the trip owner can change roles." }, { status: 403 });
  const { role: newRole } = await req.json();
  if (!["member", "admin", "viewer"].includes(newRole))
    return NextResponse.json({ error: "Role must be viewer, member, or admin." }, { status: 400 });
  const [target] = await q(
    "SELECT role FROM trip_members WHERE trip_id=$1 AND user_id=$2", [params.id, params.uid]);
  if (!target) return NextResponse.json({ error: "Not a member of this trip." }, { status: 404 });
  if (target.role === "owner")
    return NextResponse.json({ error: "The owner role cannot be changed." }, { status: 400 });
  await q("UPDATE trip_members SET role=$3 WHERE trip_id=$1 AND user_id=$2",
    [params.id, params.uid, newRole]);
  return NextResponse.json({ ok: true });
}
