import { uploadRuntimeFile } from "../../lib/api";
import type { RuntimeField } from "../../lib/runtime-contract";

type Media = { id: string; path: string; kind: "image" | "video" | "file"; name: string };
type Pending = { key: string; path: string; kind: "image" | "video" | "file"; name: string };
const previews = new Map<string, Media>();

// One question of a runtime form. The value is owned by the form; files upload as soon as they are chosen.
Component({
  options: { styleIsolation: "apply-shared" },
  properties: {
    field: { type: Object, value: {} }, value: { type: null, value: "" }, error: Boolean, disabled: Boolean, strings: { type: Object, value: {} },
  },
  data: { text: "", list: [] as string[], pickerLabels: [] as string[], pickerIndex: 0, stars: [] as number[], rating: 0, media: [] as Media[], pending: [] as Pending[], canAdd: false },
  observers: {
    "field, value, strings"(field: RuntimeField, value: string | string[], strings: Record<string, string>) {
      if (!field || !field.kind) return;
      const list = Array.isArray(value) ? value : [], text = typeof value === "string" ? value : "";
      const index = field.options.findIndex(option => option.value === text);
      const media = field.kind === "media" ? list.map(id => previews.get(id) || { id, path: "", kind: "file" as const, name: "" }) : [];
      this.setData({ text, list, pickerLabels: [strings.choose || "请选择", ...field.options.map(option => option.label)], pickerIndex: index + 1,
        stars: field.kind === "rating" ? Array.from({ length: Math.max(1, Math.min(10, field.max || 5)) }, (_, i) => i + 1) : [], rating: Number(text) || 0,
        media, canAdd: media.length + this.data.pending.length < Math.min(9, field.max || 9) });
    },
  },
  methods: {
    emit(value: string | string[]) { if (!this.data.disabled) this.triggerEvent("change", { value }); },
    input(e: WechatMiniprogram.Input) { this.emit(e.detail.value); },
    pick(e: WechatMiniprogram.PickerChange) {
      const field = this.data.field as RuntimeField, index = Number(e.detail.value);
      this.emit(field.kind === "select" ? field.options[index - 1]?.value || "" : String(e.detail.value));
    },
    choose(e: WechatMiniprogram.TouchEvent) {
      const field = this.data.field as RuntimeField, value = String(e.currentTarget.dataset.value || "");
      const option = field.options.find(row => row.value === value);
      if (!option || option.disabled) return;
      if (field.kind === "multiselect") this.emit(this.data.list.includes(value) ? this.data.list.filter(row => row !== value) : [...this.data.list, value]);
      else this.emit(this.data.text === value && !field.required ? "" : value);
    },
    check(e: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
      const field = this.data.field as RuntimeField;
      if (field.kind === "consent") this.emit(e.detail.value.includes("yes") ? "yes" : "");
      else this.emit(e.detail.value);
    },
    rate(e: WechatMiniprogram.TouchEvent) { this.emit(String(e.currentTarget.dataset.value)); },
    address() {
      if (this.data.disabled) return;
      wx.chooseAddress({ success: row => this.emit([row.userName, row.telNumber, `${row.provinceName}${row.cityName}${row.countyName}${row.detailInfo}`].filter(Boolean).join(" ")) });
    },
    /** Images and videos come from the album or camera; files come from a WeChat chat. */
    add() {
      if (this.data.disabled || !this.data.canAdd) return;
      const field = this.data.field as RuntimeField, accept = field.accept.length ? field.accept : ["image"];
      const room = Math.min(9, field.max || 9) - this.data.media.length - this.data.pending.length;
      const media = accept.filter(kind => kind !== "file") as ("image" | "video")[];
      const pickMedia = () => wx.chooseMedia({ count: room, mediaType: media, sourceType: ["album", "camera"], sizeType: ["compressed"],
        success: result => this.upload(result.tempFiles.map(file => ({ path: file.tempFilePath, kind: file.fileType === "video" ? "video" as const : "image" as const, name: "" }))) });
      const pickFile = () => wx.chooseMessageFile({ count: room, type: "file", extension: ["pdf", "jpg", "jpeg", "png"],
        success: result => this.upload(result.tempFiles.map(file => ({ path: file.path, kind: "file" as const, name: file.name }))) });
      if (media.length && accept.includes("file")) {
        const strings = this.data.strings as Record<string, string>;
        wx.showActionSheet({ itemList: [strings.upload || "添加", "微信聊天文件"], success: result => result.tapIndex === 0 ? pickMedia() : pickFile() });
      } else if (media.length) pickMedia(); else pickFile();
    },
    async upload(files: { path: string; kind: "image" | "video" | "file"; name: string }[]) {
      const pending = files.map((file, index) => ({ ...file, key: Date.now() + "-" + index }));
      this.setData({ pending: [...this.data.pending, ...pending], canAdd: false });
      let ids = [...this.data.list];
      for (const file of pending) {
        try {
          const uploaded = await uploadRuntimeFile(file.path);
          previews.set(uploaded.id, { id: uploaded.id, path: file.path, kind: uploaded.kind, name: file.name || uploaded.name });
          ids = [...ids, uploaded.id];
          this.emit(ids);
        } catch { wx.showToast({ title: (this.data.strings as Record<string, string>).uploadFailed || "上传失败", icon: "none" }); }
        this.setData({ pending: this.data.pending.filter(row => row.key !== file.key) });
      }
      const field = this.data.field as RuntimeField;
      this.setData({ canAdd: ids.length + this.data.pending.length < Math.min(9, field.max || 9) });
    },
    remove(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id); this.emit(this.data.list.filter(row => row !== id)); },
    preview(e: WechatMiniprogram.TouchEvent) {
      const urls = this.data.media.filter(row => row.kind === "image" && row.path).map(row => row.path), current = String(e.currentTarget.dataset.path || "");
      if (current && urls.includes(current)) wx.previewImage({ urls, current });
    },
  },
});
