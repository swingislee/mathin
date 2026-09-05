import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { normalizeNewlines } from "./text-hash.mjs";

const TYPE_NAMES = {
  1: "Text", 2: "Number", 3: "SingleSelect", 4: "MultiSelect", 5: "DateTime",
  7: "Checkbox", 11: "User", 13: "Phone", 15: "Url", 17: "Attachment",
  18: "SingleLink", 19: "Lookup", 20: "Formula", 21: "DuplexLink",
  1001: "CreatedTime", 1002: "ModifiedTime", 1003: "CreatedUser",
  1004: "ModifiedUser", 1005: "AutoNumber",
};
const NAME_FIELD = /^(?:(?:学员|学生|孩子|儿童|宝贝|家长|父亲|母亲|爸爸|妈妈)(?:的)?(?:姓名|名字)|姓名|名字|家长称呼)$/u;
const PHONE_FIELD = /^(?:(?:家长|父亲|母亲|爸爸|妈妈|学员|学生|监护人|联系)(?:的)?)?(?:手机(?:号(?:码)?)?|电话(?:号(?:码)?)?|联系方式|联系电话)$/u;
const NARRATIVE_FIELD = /沟通|跟进信息|备注|说明|情况|关注|期待|共识|理念|总结|建议|初步信息|触达内容|信息内容|培养重点|反馈|文案/u;
const SYSTEM_FIELD = /自动生成|创建时间|修改时间|最后修改|录入时间/u;
const BUSINESS_DATE_FIELD = /日期|时间|月份|周次|年度|学期|周期/u;
const LINK_TYPES = new Set(["SingleLink", "DuplexLink", "Link"]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hasContent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasContent(item?.text ?? item));
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function typeName(field) {
  return field.fieldUIType || TYPE_NAMES[field.type] || `Unknown:${field.type ?? "unspecified"}`;
}

function kindOf(field) {
  const name = field.name?.trim() || "";
  if (Number(field.type) >= 1001 || SYSTEM_FIELD.test(name) || field.property?.autoFill === true) return "system";
  if (NAME_FIELD.test(name) || PHONE_FIELD.test(name)) return "identity";
  if (NARRATIVE_FIELD.test(name)) return "narrative";
  return "context";
}

// 身份匹配只接收完整号码。脱敏号和备注中的号码仍保存在原文中。
function phonesInIdentityField(text) {
  return text.split(/[\n,，;；、/|]+/u).flatMap((part) => {
    let phone = part.trim().replace(/[\s()（）-]/gu, "");
    if (/^\+86\d{11}$/u.test(phone)) phone = phone.slice(3);
    if (/^0086\d{11}$/u.test(phone)) phone = phone.slice(4);
    return /^(?:1\d{10}|0\d{9,11})$/u.test(phone) ? [phone] : [];
  });
}

function dateText(value, field, timezone, warnings) {
  if (typeof value !== "number") return plainText(value);
  if (!timezone) {
    warnings.add("DATE_TIMEZONE_MISSING: numeric date retained as source value");
    return String(value);
  }
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
    const tokens = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
    const dateFormat = field.property?.dateFormat;
    const timeFormat = field.property?.timeFormat;
    if (!dateFormat && !timeFormat) {
      warnings.add("DATE_FORMAT_MISSING: numeric date retained as source value");
      return String(value);
    }
    const format = [dateFormat, timeFormat].filter(Boolean).join(" ");
    // 未认识的格式完整保留，避免擅自把月/年精度补成某一天。
    if (/[^\s/.:年月日时分秒\-]/u.test(format.replace(/yyyy|MM|dd|HH|mm|ss/gu, ""))) {
      warnings.add("DATE_FORMAT_UNSUPPORTED: numeric date and source format retained");
      return `${value} (${format}; ${timezone})`;
    }
    const formatted = format.replace(/yyyy|MM|dd|HH|mm|ss/gu, (token) => tokens[token]);
    return timeFormat ? `${formatted} (${timezone})` : formatted;
  } catch {
    warnings.add("DATE_INVALID: numeric date retained as source value");
    return String(value);
  }
}

function plainText(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    const richText = value.every((part) => part && typeof part === "object" && ("text" in part || ["text", "url", "mention"].includes(part.type)));
    return value.map(plainText).join(richText ? "" : "\n");
  }
  if ("text" in value) {
    const text = plainText(value.text);
    const url = value.link || value.url;
    return typeof url === "string" && url !== text ? `${text} (${url})` : text;
  }
  if ("fullPhoneNum" in value) return plainText(value.fullPhoneNum);
  if (Array.isArray(value.users)) return value.users.map(plainText).join("、");
  if ("name" in value) return plainText(value.name);
  if ("value" in value) return plainText(value.value);
  if ("values" in value) return plainText(value.values);
  if ("number" in value) return plainText(value.number);
  if ("label" in value) return plainText(value.label);
  if ("url" in value) return plainText(value.url);
  return JSON.stringify(value);
}

function linkIds(value) {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(linkIds);
  if (value.recordId) return [String(value.recordId)];
  if (value.recordIds) return linkIds(value.recordIds);
  if (value.linkRecordIds) return linkIds(value.linkRecordIds);
  if (value.records) return linkIds(value.records);
  return [];
}

function cellValue(cell) {
  return cell && typeof cell === "object" && !Array.isArray(cell) && "value" in cell ? cell.value : cell ?? null;
}

function readableValue(value, field, context, trail = new Set()) {
  const type = typeName(field);
  if (["SingleSelect", "MultiSelect"].includes(type)) {
    const options = new Map((field.property?.options || []).map((option) => [String(option.id), option.name]));
    const resolve = (item) => {
      if (typeof item === "object") return plainText(item);
      if (options.has(String(item))) return String(options.get(String(item)));
      if (item != null && item !== "") context.warnings.add(`OPTION_LABEL_MISSING:${context.fieldId}`);
      return plainText(item);
    };
    return (Array.isArray(value) ? value : [value]).map(resolve).join("、");
  }
  if (type === "DateTime" || ["CreatedTime", "ModifiedTime"].includes(type)) {
    return value == null ? "" : dateText(value, field, context.timezone, context.warnings);
  }
  if (LINK_TYPES.has(type)) {
    const targetTableId = field.property?.tableId;
    return linkIds(value).map((recordId) => {
      const key = `${targetTableId}:${recordId}`;
      if (trail.has(key)) return recordId;
      const candidates = context.recordIndex.get(key) || [];
      if (!candidates.length) {
        context.warnings.add(`LINK_TARGET_MISSING:${context.fieldId}:${targetTableId || "unknown"}:${recordId}`);
        return recordId;
      }
      const nextTrail = new Set([...trail, key]);
      const labels = candidates.map(({ row, fields, timezone }) => {
        const [primaryId, primary] = Object.entries(fields).find(([, item]) => item.isPrimary) || [];
        if (!primary) return recordId;
        return readableValue(cellValue(row[primaryId]), primary, { ...context, fieldId: primaryId, timezone }, nextTrail) || recordId;
      });
      return [...new Set(labels)].join(" / ");
    }).join("、");
  }
  if (type === "Lookup") {
    const lookupKey = `lookup:${field.property?.tableId}:${field.property?.fieldId}`;
    if (trail.has(lookupKey)) {
      context.warnings.add(`LOOKUP_CYCLE:${context.fieldId}`);
      return plainText(value);
    }
    const target = context.fieldIndex.get(`${field.property?.tableId}:${field.property?.fieldId}`);
    if (target && target !== field && !LINK_TYPES.has(typeName(target))) {
      return (Array.isArray(value) ? value : [value]).map((part) => readableValue(cellValue(part), target, context, new Set([...trail, lookupKey]))).join("、");
    }
  }
  return plainText(value);
}

/** 只读取来源文件；完整档案可写入隔离演练数据，调用方负责访问控制。 */
export async function extractFeishuBase(filePath) {
  const fileText = await fs.readFile(filePath, "utf8");
  const sha256 = hash(normalizeNewlines(fileText));
  let outer;
  try { outer = JSON.parse(fileText.replace(/^\uFEFF/u, "")); } catch { throw new Error("FEISHU_BASE_INVALID_JSON"); }
  if (typeof outer.gzipSnapshot !== "string") throw new Error("FEISHU_BASE_SNAPSHOT_MISSING");
  let snapshots;
  try { snapshots = JSON.parse(gunzipSync(Buffer.from(outer.gzipSnapshot, "base64")).toString("utf8")); } catch { throw new Error("FEISHU_BASE_SNAPSHOT_INVALID"); }
  if (!Array.isArray(snapshots)) throw new Error("FEISHU_BASE_SNAPSHOT_INVALID");

  const warnings = new Set();
  const uniqueSnapshots = [];
  const snapshotKeys = new Set();
  const tableVersions = new Map();
  const baseIds = new Set();
  for (const entry of snapshots) {
    const schema = entry?.schema;
    const tableId = schema?.data?.table?.meta?.id;
    if (!tableId || !schema.data.recordMap || !schema.data.table.fieldMap) throw new Error("FEISHU_BASE_TABLE_INVALID");
    if (schema.base?.id) baseIds.add(String(schema.base.id));
    const snapshotHash = hash(canonical(schema));
    const snapshotKey = `${tableId}:${snapshotHash}`;
    if (snapshotKeys.has(snapshotKey)) {
      warnings.add(`IDENTICAL_TABLE_SNAPSHOT_DEDUPLICATED:${tableId}`);
      continue;
    }
    snapshotKeys.add(snapshotKey);
    const versions = tableVersions.get(tableId) || [];
    versions.push(snapshotHash);
    tableVersions.set(tableId, versions);
    uniqueSnapshots.push({ schema, tableId, snapshotHash });
  }
  for (const [tableId, versions] of tableVersions) {
    if (versions.length > 1) warnings.add(`MULTIPLE_TABLE_SNAPSHOTS_RETAINED:${tableId}:${versions.length}`);
  }
  const sourceId = `feishu-base:${hash(baseIds.size ? [...baseIds].sort().join("|") : sha256)}`;
  const source = { id: sourceId, filename: path.basename(filePath), sha256, format: "feishu-base" };
  const recordIndex = new Map();
  const fieldIndex = new Map();
  for (const { schema, tableId } of uniqueSnapshots) {
    const fields = schema.data.table.fieldMap;
    for (const [fieldId, field] of Object.entries(fields)) fieldIndex.set(`${tableId}:${fieldId}`, field);
    for (const [recordId, row] of Object.entries(schema.data.recordMap)) {
      const key = `${tableId}:${recordId}`;
      const entries = recordIndex.get(key) || [];
      entries.push({ row, fields, timezone: schema.base?.timezone });
      recordIndex.set(key, entries);
    }
  }

  const tableMap = new Map();
  const records = [];
  for (const { schema, tableId, snapshotHash } of uniqueSnapshots) {
    const { table, recordMap, recordMeta = {} } = schema.data;
    const tableName = schema.tableMap?.[tableId]?.name || table.meta.name || tableId;
    const summary = tableMap.get(tableId) || { id: tableId, name: tableName, rowCount: 0, contentRowCount: 0 };
    for (const [fieldId, field] of Object.entries(table.fieldMap)) {
      if (LINK_TYPES.has(typeName(field)) && !tableVersions.has(field.property?.tableId)) {
        warnings.add(`LINK_TABLE_MISSING:${tableId}:${fieldId}:${field.property?.tableId || "unknown"}`);
      }
    }
    for (const [sourceRecordId, row] of Object.entries(recordMap)) {
      const rowWarnings = new Set();
      const names = new Set();
      const phones = new Set();
      const cells = [];
      const links = [];
      const dates = [];
      const fieldMetadata = {};
      const fieldEntries = new Map(Object.entries(table.fieldMap));
      for (const fieldId of Object.keys(row)) {
        if (!fieldEntries.has(fieldId)) {
          fieldEntries.set(fieldId, { name: fieldId, fieldUIType: "Unknown" });
          rowWarnings.add(`FIELD_DEFINITION_MISSING:${fieldId}`);
        }
      }
      for (const [fieldId, field] of fieldEntries) {
        const rawCell = row[fieldId];
        const rawValue = cellValue(rawCell);
        const type = typeName(field);
        const kind = kindOf(field);
        const fieldName = field.name || fieldId;
        const text = readableValue(rawValue, field, { fieldId, recordIndex, fieldIndex, warnings: rowWarnings, timezone: schema.base?.timezone });
        cells.push({ fieldId, fieldName, type, text, rawValue, kind });
        if (rawCell && typeof rawCell === "object" && !Array.isArray(rawCell) && "value" in rawCell) {
          const metadata = Object.fromEntries(Object.entries(rawCell).filter(([key]) => key !== "value"));
          if (Object.keys(metadata).length) fieldMetadata[fieldId] = metadata;
        }
        if (kind === "identity" && NAME_FIELD.test(fieldName.trim()) && text.trim()) names.add(text.trim());
        if (kind === "identity" && PHONE_FIELD.test(fieldName.trim())) phonesInIdentityField(text).forEach((phone) => phones.add(phone));
        if (LINK_TYPES.has(type)) {
          for (const targetRecordId of linkIds(rawValue)) links.push({ fieldId, targetTableId: field.property?.tableId || "", targetRecordId });
        }
        if (kind !== "system" && BUSINESS_DATE_FIELD.test(fieldName) && !/出生|生日/u.test(fieldName) && text.trim()) {
          dates.push(`${fieldName}：${text}`);
        }
      }
      const content = cells.some((cell) => cell.kind !== "system" && hasContent(cell.rawValue));
      for (const [fieldId, fieldName, rawValue] of [
        ["__record_metadata", "来源记录元数据", recordMeta[sourceRecordId]],
        ["__cell_metadata", "来源单元格元数据", fieldMetadata],
      ]) {
        if (rawValue && Object.keys(rawValue).length) cells.push({ fieldId, fieldName, type: "SourceMetadata", text: JSON.stringify(rawValue), rawValue, kind: "system" });
      }
      const primaryId = Object.entries(table.fieldMap).find(([, field]) => field.isPrimary)?.[0];
      const label = [...names][0] || cells.find((cell) => cell.fieldId === primaryId && cell.kind !== "system")?.text || `${tableName} · ${sourceRecordId}`;
      records.push({
        id: `feishu-record:${hash(`${sourceId}|${tableId}|${sourceRecordId}|${snapshotHash}`)}`,
        sourceId, tableId, tableName, sourceRecordId, sourceRow: null, label,
        names: [...names], phones: [...phones], cells, links,
        dateLabel: dates.length ? dates.join("；") : null, hasContent: content, warnings: [...rowWarnings],
      });
      summary.rowCount += 1;
      if (content) summary.contentRowCount += 1;
    }
    tableMap.set(tableId, summary);
  }
  return { source, tables: [...tableMap.values()], records, warnings: [...warnings] };
}
