import { beginEntryLocation, promotionScene } from "./lib/entry-location";
import { session } from "./lib/api";

App({
  onShow(options) {
    const scene = promotionScene(options.query?.scene);
    if (scene || (options.path === "pages/onboarding/index" && !session())) void beginEntryLocation(scene);
  },
});
