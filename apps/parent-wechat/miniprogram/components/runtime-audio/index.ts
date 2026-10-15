import { audioState, onAudioChange, playAudio, stepAudio } from "../../lib/runtime-audio";
type Block = { id: string; tracks: { id: string; title: string; subtitle: string; src: string; cover: string }[]; loop: boolean };
const subscriptions = new WeakMap<object, () => void>();

// A track list played by the shared background audio player.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: { block: { type: Object, value: {} }, strings: { type: Object, value: {} } },
  data: { current: "", playing: false },
  lifetimes: {
    attached() { this.sync(audioState()); subscriptions.set(this, onAudioChange(state => this.sync(state))); },
    detached() { subscriptions.get(this)?.(); subscriptions.delete(this); },
  },
  methods: {
    sync(state: { key: string; trackId: string; playing: boolean }) {
      const mine = state.key === (this.data.block as Block).id;
      this.setData({ current: mine ? state.trackId : "", playing: mine && state.playing });
    },
    play(e: WechatMiniprogram.TouchEvent) {
      const block = this.data.block as Block;
      playAudio(block.id, block.tracks, String(e.currentTarget.dataset.id || block.tracks[0]?.id || ""), block.loop);
    },
    toggle() { const block = this.data.block as Block; playAudio(block.id, block.tracks, this.data.current || block.tracks[0]?.id || "", block.loop); },
    previous() { if (this.data.current) stepAudio(-1); },
    next() { if (this.data.current) stepAudio(1); },
    login() { this.triggerEvent("action", { action: { type: "login" } }); },
  },
});
