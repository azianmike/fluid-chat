import { VerifyEmail } from "@/components/verify-email";

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VerifyEmail token={token} />;
}
