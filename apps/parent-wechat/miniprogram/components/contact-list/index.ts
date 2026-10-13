import type { ContactCard } from "../../lib/contact-card";
Component({
  properties: { rows: { type: Array, value: [] as ContactCard[] }, locale: { type: String, value: "zh" }, density: { type: String, value: "comfortable" } },
  methods: {
    phone(e: WechatMiniprogram.TouchEvent) { const contact = this.data.rows.find(c => c.id === e.currentTarget.dataset.id); if (contact?.phone) wx.makePhoneCall({ phoneNumber: contact.phone.replace(/[ -]/g, "") }); },
    preview(e: WechatMiniprogram.TouchEvent) { const contact = this.data.rows.find(c => c.id === e.currentTarget.dataset.id); if (contact?.qrImage) wx.previewImage({ urls: [contact.qrImage] }); },
  },
});
