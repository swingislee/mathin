Component({
  options: { styleIsolation: "apply-shared" },
  properties: { heading: String, subtitle: String, status: String, participant: String, note: String, interactive: Boolean, expanded: Boolean, density: { type: String, value: "comfortable" } },
  methods: { select() { if (this.data.interactive) this.triggerEvent("select"); } },
});
