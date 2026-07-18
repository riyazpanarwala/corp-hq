import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams;
  return <ResetPasswordForm token={typeof params?.token === "string" ? params.token : ""} />;
}
