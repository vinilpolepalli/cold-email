"use client";

// Sign-up is open, so the header offers both doors: sign in for people who
// have an account, sign up for everyone else.
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { buttonStyles } from "./ui";

export default function AuthControls() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className={buttonStyles.secondary}>Sign in</button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className={buttonStyles.primary}>Get started</button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
