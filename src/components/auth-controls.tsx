"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

export default function AuthControls() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  if (isSignedIn) return <UserButton />;
  return (
    <SignInButton mode="modal">
      <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700">Sign in</button>
    </SignInButton>
  );
}
