import { onMount, onCleanup } from "solid-js";
import { mountSignInPage } from "./auth/reactAuth.js";
import { CountdownNotice } from "./Availability.jsx";
import "./onboarding.css";

/**
 * Get-started screen: PC photo on the left, the REAL Clerk <SignIn/>
 * form (React) on the right — no image-mock form.
 *
 * Drop the side photo at public/auth-side.jpg. Until then the panel falls
 * back to a dark gradient so the page never renders broken.
 */
const SIDE_IMAGE = "/auth-side.jpg";

export default function OnboardingView({ onDone }) {
  let slot = null;
  let unmount = () => {};
  onMount(() => {
    // Virtual routing: the form renders regardless of URL, nothing to seed.
    unmount = mountSignInPage(slot);
  });
  onCleanup(() => unmount());

  return (
    <div class="onboarding-page">
      <div class="auth-visual" aria-hidden="true">
        <img
          src={SIDE_IMAGE}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <div class="auth-visual-veil" />
      </div>
      <section class="auth-panel" aria-label="Sign in">
        <div class="auth-card-slot" ref={(el) => { slot = el; }} />
        <CountdownNotice cls="auth-notice" />
        <button class="auth-skip" onClick={() => onDone && onDone()}>
          Skip <span aria-hidden="true">→</span>
        </button>
      </section>
    </div>
  );
}
