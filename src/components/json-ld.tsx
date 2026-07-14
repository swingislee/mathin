/** schema.org 数据的注入点（doc15 §2.5）。只被爬虫读取，不参与渲染，也不执行。
 *  `<` 转义是必须的：正文里的一个 `</script>` 就能提前闭合脚本标签。 */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
