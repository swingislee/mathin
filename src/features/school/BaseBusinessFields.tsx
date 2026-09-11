import { BASE_BUSINESS_SECTIONS, baseBusinessMessages, type BaseBusinessField } from "./base-business-fields-contract";

/** 每个区块仍属于一条来源记录；同名字段可并列核对，不计算跨记录的当前状态。 */
export function BaseBusinessFields({ fields, locale }: { fields: readonly BaseBusinessField[]; locale: string }) {
  const m = baseBusinessMessages(locale);
  const presented = fields.flatMap(field => [field, ...(field.projections ?? []).map((projection, index) => ({ ...field, ...projection,
    fieldId: `${field.fieldId}:projection:${index}`, review: [], projections: undefined }))]).map(field => {
      if (field.status === "pending") return { ...field, display: m.pending };
      const value = field.value;
      if (field.kind !== "grade" || !value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.children)) return field;
      const children = value.children.flatMap((child, index) => {
        if (!child || typeof child !== "object" || Array.isArray(child) || typeof child.gradeLabel !== "string") return [];
        const relation = typeof child.relation === "string" ? m.childRelation(child.relation) : m.child(index + 1);
        const name = typeof child.name === "string" && child.name ? child.name : `${relation}（${m.childName}：${m.pending}）`;
        return [`${name}：${child.gradeLabel}`];
      });
      return children.length ? { ...field, display: children.join("\n") } : field;
    });
  return <div className="space-y-5" data-base-business-fields>
    {BASE_BUSINESS_SECTIONS.map(section => {
      const values = presented.filter(field => field.section === section);
      if (!values.length) return null;
      return <section key={section}>
        <h4 className="mb-2 text-sm font-medium">{m.sections[section]}</h4>
        <dl className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
          {values.map(field => <div key={field.fieldId} className="contents">
            <dt className="break-words text-muted">{field.label ? m.fieldLabel(field.key, field.label) : field.name}</dt>
            <dd className="whitespace-pre-wrap break-words">
              {field.display || field.originalText || m.rawOnly}
              {field.value && typeof field.value === "object" && !Array.isArray(field.value) && field.value.familyKey ? <span className="mt-1 block text-xs text-muted">{m.familyChildren}</span> : null}
              {field.display && field.originalText.trim() && (field.display !== field.originalText.trim() || field.label && field.label !== field.name) ? <span className="mt-1 block text-xs text-muted">{m.original}{field.label ? `（${field.name}）` : ''}：{field.originalText}</span> : null}
              {(field.review ?? (field.status === "unparsed" ? ["unrecognized" as const] : [])).map(reason => <span key={reason} className="mt-1 block text-xs text-muted">{m.review[reason]}</span>)}
            </dd>
          </div>)}
        </dl>
      </section>;
    })}
  </div>;
}
