"use client";

// Sign-up is invite-only: the Clerk instance runs in allowlist mode, so the
// header offers sign-in only and everyone else goes through the waitlist.
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { buttonStyles } from "./ui";

export default function AuthControls() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className={buttonStyles.secondary}>Sign in</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
