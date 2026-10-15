// One background audio player for the whole Mini Program: it keeps playing when the page or app is left, and lock-screen controls work.
type Track = { id: string; title: string; subtitle: string; src: string; cover: string };
type State = { key: string; trackId: string; playing: boolean };

let playlist: Track[] = [], index = -1, loop = false, key = "", playing = false, attached = false;
const listeners = new Set<(state: State) => void>();
const manager = () => wx.getBackgroundAudioManager();
function notify() { const state = audioState(); listeners.forEach(listener => listener(state)); }
function attach() {
  if (attached) return;
  attached = true;
  const audio = manager();
  audio.onPlay(() => { playing = true; notify(); });
  audio.onPause(() => { playing = false; notify(); });
  audio.onStop(() => { playing = false; notify(); });
  audio.onError(() => { playing = false; notify(); });
  audio.onEnded(() => { if (index < playlist.length - 1 || loop) step(1); else { playing = false; notify(); } });
  audio.onNext(() => step(1));
  audio.onPrev(() => step(-1));
}
function start(i: number) {
  const track = playlist[i];
  if (!track) return;
  index = i;
  const audio = manager();
  // WeChat requires a title before the source is set; setting the source starts playback.
  audio.title = track.title || " ";
  audio.singer = track.subtitle;
  audio.epname = track.subtitle;
  if (track.cover) audio.coverImgUrl = track.cover;
  audio.src = track.src;
  notify();
}
function step(offset: number) {
  if (!playlist.length) return;
  const next = index + offset;
  start(loop ? (next + playlist.length) % playlist.length : Math.max(0, Math.min(playlist.length - 1, next)));
}

export function audioState(): State { return { key, trackId: playlist[index]?.id || "", playing }; }
export function onAudioChange(listener: (state: State) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** Plays a track of a list; `owner` identifies the block so only its list shows the playing state. */
export function playAudio(owner: string, tracks: Track[], trackId: string, repeat: boolean) {
  attach();
  const same = owner === key && playlist[index]?.id === trackId;
  if (same) { if (playing) manager().pause(); else manager().play(); return; }
  playlist = tracks.filter(track => track.src); key = owner; loop = repeat;
  start(Math.max(0, playlist.findIndex(track => track.id === trackId)));
}
export function stepAudio(offset: number) { attach(); step(offset); }
