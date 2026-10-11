import { rememberPromotionScene } from "./lib/onboarding";

App({
  onShow(options) { rememberPromotionScene(options.query?.scene); },
});
