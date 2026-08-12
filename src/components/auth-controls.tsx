"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

export default function AuthControls() {
  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 transition-colors hover:border-orange-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-orange-400">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="rounded-lg bg-orange-700 px-3 py-1.5 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98]">
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
