import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getTasksByUser,
  createTask,
  getTasksWithSubtasksByUser,
} from "@/lib/db/queries";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const withSubtasks = request.nextUrl.searchParams.get("withSubtasks") === "1";
  if (withSubtasks) {
    const data = await getTasksWithSubtasksByUser(auth.user.id);
    return NextResponse.json(data);
  }

  const userTasks = await getTasksByUser(auth.user.id);
  return NextResponse.json(userTasks);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const task = await createTask(auth.user.id, title);
  return NextResponse.json(task, { status: 201 });
}
