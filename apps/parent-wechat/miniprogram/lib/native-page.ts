import { configuration, refreshConfiguration } from "./miniapp-configuration";
import { nativeScreenPresentation, nativeScreens, type NativeScreenId } from "./miniapp-native";
import { localText } from "./miniapp-experience";
import { currentLocale } from "./page";

/** Keep all business lifecycle hooks and commands intact; only supply published presentation data. */
export function configuredPage(id: NativeScreenId): typeof Page {
  const active = new WeakMap<object, number>();
  return options => Page({
    ...options,
    data: { ...options.data, screen: nativeScreenPresentation(configuration().experience?.screens, id, currentLocale()) },
    onShow() {
      const generation = (active.get(this) || 0) + 1;
      active.set(this, generation);
      const apply = () => {
        if (active.get(this) !== generation) return;
        const screen = nativeScreenPresentation(configuration().experience?.screens, id, currentLocale());
        // The wrapper adds this field to every registered page's data above.
        this.setData({ screen } as unknown as Partial<typeof options.data> & WechatMiniprogram.IAnyObject);
        wx.setNavigationBarTitle({ title: screen.title || localText(nativeScreens.find(s => s.id === id)?.title, currentLocale()) });
      };
      const result = options.onShow?.call(this);
      apply();
      void refreshConfiguration().then(apply);
      return result;
    },
    onHide() { active.set(this, (active.get(this) || 0) + 1); return options.onHide?.call(this); },
    onUnload() { active.set(this, (active.get(this) || 0) + 1); return options.onUnload?.call(this); },
  });
}
