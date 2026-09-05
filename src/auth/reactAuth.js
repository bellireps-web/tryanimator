/**
 * React auth island for the SolidJS landing header.
 *
 * Plain JS (no JSX) on purpose: vite-plugin-solid owns the JSX transform,
 * so React.createElement calls pass through untouched.
 *
 * Single Clerk session: only @clerk/react's ClerkProvider is mounted
 * (no separate @clerk/clerk-js init), keyed by VITE_CLERK_PUBLISHABLE_KEY.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth } from "@clerk/react";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function hasClerkKey() {
  return typeof PUBLISHABLE_KEY === "string" && PUBLISHABLE_KEY.length > 0;
}

/** Auth controls driven by the useAuth() hook (v6 has no SignedIn/SignedOut). */
function AuthControls() {
  const { isSignedIn } = useAuth();
  if (isSignedIn === undefined) return null;
  if (isSignedIn) return React.createElement(UserButton, null);
  // Signed out: pill navigates to the Get-started screen (the real form
  // lives there, not in a modal).
  return React.createElement(
    "span",
    {
      className: "landing-auth",
      role: "link",
      tabIndex: 0,
      style: { cursor: "pointer" },
      onClick: () => {
        window.location.hash = "onboarding";
      },
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") window.location.hash = "onboarding";
      },
    },
    "Sign Up/Log In",
  );
}

/**
 * Mount <ClerkProvider><AuthControls/> into el.
 * Signed-out shows the same "Sign Up/Log In" pill (navigates to the
 * Get-started screen where the real form lives). Signed-in shows the
 * Clerk UserButton. Returns an unmount function for Solid's onCleanup.
 */
export function mountAuthIsland(el) {
  if (!el || !hasClerkKey()) return () => {};
  const root = createRoot(el);
  root.render(
    React.createElement(
      ClerkProvider,
      { publishableKey: PUBLISHABLE_KEY },
      React.createElement(AuthControls, null),
    ),
  );
  return () => {
    try {
      root.unmount();
    } catch {
      // Already unmounted (HMR / double cleanup): nothing to release.
    }
  };
}

/**
 * Bounces already-signed-in users straight to the editor so the
 * Get-started screen never asks them to sign in twice. Renders nothing.
 */
function SessionGate() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && isSignedIn) window.location.hash = "editor";
  }, [isLoaded, isSignedIn]);
  return null;
}

/**
 * Single mounted component + own mode switcher. Virtual routing has zero
 * URL opinions (nothing ever bounces to the hosted portal); Clerk's own
 * footer links are hidden and replaced by our switcher so sign-in AND
 * sign-up both stay inside this page.
 */
function AuthForm() {
  const [mode, setMode] = useState("sign-in");
  const base = {
    routing: "virtual",
    fallbackRedirectUrl: `${window.location.origin}/#editor`,
    fallback: React.createElement("div", { className: "auth-loading" }, "Loading sign-in…"),
    appearance: {
      elements: {
        footerAction: { display: "none" },
        footerActionLink: { display: "none" },
      },
    },
  };
  return React.createElement(
    "div",
    { className: "auth-form-wrap" },
    mode === "sign-up"
      ? React.createElement(SignUp, base)
      : React.createElement(SignIn, base),
    React.createElement(
      "button",
      {
        type: "button",
        className: "auth-mode-switch",
        onClick: () => setMode(mode === "sign-up" ? "sign-in" : "sign-up"),
      },
      mode === "sign-up" ? "Have an account? Sign in" : "Don't have an account? Sign up",
    ),
  );
}

/**
 * Mount the real Clerk auth form (hash routing via AuthForm: sign-in AND
 * sign-up stay inside the page; Clerk owns "#/..." hashes and the app
 * router ignores them). After auth Clerk lands on /#editor and the app
 * router picks it up. Includes SessionGate in the same provider (single
 * session).
 */
export function mountSignInPage(el) {
  if (!el || !hasClerkKey()) return () => {};
  const root = createRoot(el);
  root.render(
    React.createElement(
      ClerkProvider,
      { publishableKey: PUBLISHABLE_KEY },
      React.createElement(SessionGate, null),
      React.createElement(AuthForm, null),
    ),
  );
  return () => {
    try {
      root.unmount();
    } catch {
      // Already unmounted (HMR / double cleanup): nothing to release.
    }
  };
}
