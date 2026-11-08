import { SignUp } from "@clerk/nextjs";
import { CrowdBackdrop } from "@/components/landing/CrowdBackdrop";
import { authAppearance } from "@/lib/clerk-appearance";

export default function SignUpPage() {
  return (
    <CrowdBackdrop>
      <div className="-mt-[10vh] grid justify-items-center gap-6">
        <span className="text-3xl font-semibold tracking-tight">Meetly</span>
        <SignUp appearance={authAppearance} />
      </div>
    </CrowdBackdrop>
  );
}
