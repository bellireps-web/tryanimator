import leftPanel from "./assets/onboarding/left-panel.png";
import editorCard from "./assets/onboarding/editor-card.png";
import logo from "./assets/onboarding/logo.png";
import "./onboarding.css";

export default function OnboardingView({ onDone }) {
  return (
    <div class="onboarding-page" onClick={onDone}>
      <div class="onboarding-canvas">
        <div
          class="onboarding-left"
          style={`background-image:url(${leftPanel})`}
        />
        <div class="onboarding-card" onClick={(event) => event.stopPropagation()}>
          <div
            class="onboarding-card-bg"
            style={`background-image:url(${editorCard})`}
          />
          <div class="onboarding-logo-plate" />
          <img class="onboarding-logo" src={logo} alt="" />
        </div>
      </div>
    </div>
  );
}