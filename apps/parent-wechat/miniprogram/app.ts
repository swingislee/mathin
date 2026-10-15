import { rememberPromotionScene } from "./lib/onboarding";
import { rememberLaunchScene, watchForUpdate } from "./lib/runtime";

App({
  onLaunch(options) { watchForUpdate(); rememberLaunchScene(options.query?.scene); },
  onShow(options) { rememberPromotionScene(options.query?.scene); },
});
