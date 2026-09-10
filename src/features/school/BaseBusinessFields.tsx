import { BASE_BUSINESS_SECTIONS, baseBusinessMessages, type BaseBusinessField } from "./base-business-fields-contract";

/** 每个区块仍属于一条来源记录；同名字段可并列核对，不计算跨记录的当前状态。 */
export function BaseBusinessFields({ fields, locale }: { fields: readonly BaseBusinessField[]; locale: string }) {
  const m = baseBusinessMessages(locale);
  return <div className="space-y-5" data-base-business-fields>
    {BASE_BUSINESS_SECTIONS.map(section => {
      const values = fields.filter(field => field.section === section);
      if (!values.length) return null;
      return <section key={section}>
        <h4 className="mb-2 text-sm font-medium">{m.sections[section]}</h4>
        <dl className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
          {values.map(field => <div key={field.fieldId} className="contents">
            <dt className="break-words text-muted">{field.name}</dt>
            <dd className="whitespace-pre-wrap break-words">
              {field.display || field.originalText || m.rawOnly}
              {field.display && field.originalText.trim() && field.display !== field.originalText.trim() ? <span className="mt-1 block text-xs text-muted">{m.original}：{field.originalText}</span> : null}
            </dd>
          </div>)}
        </dl>
      </section>;
    })}
  </div>;
}
