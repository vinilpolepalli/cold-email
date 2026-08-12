"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

export default function AuthControls() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  if (isSignedIn) return <UserButton />;
  return (
    <SignInButton mode="modal">
      <button className="rounded-lg bg-orange-700 px-3 py-1.5 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98]">
        Sign in
      </button>
    </SignInButton>
  );
}
