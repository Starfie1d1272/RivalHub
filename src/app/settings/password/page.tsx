import { redirect } from "next/navigation";

export default async function ChangePasswordPage() {
  redirect("/settings/security");
}
