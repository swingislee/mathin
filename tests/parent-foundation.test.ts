import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const wechatRoot = "apps/parent-wechat/miniprogram/";
const api = JSON.parse(read("contracts/parent-api/openapi.json"));

// 在独立微信运行时中执行页面，不把 wx 的全局类型引入网页编译范围。
function loadModule(file: string, runtime: Record<string, unknown>, dependencies: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(read(wechatRoot + file), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  });
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require(name: string) {
      if (!(name in dependencies)) throw new Error("Unexpected module: " + name);
      return dependencies[name];
    },
    ...runtime,
  });
  return exports;
}

describe("家长端工程基础", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("现有健康接口响应符合三端共用规范，且不返回配置或凭据", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = GET();
    const body = await response.json();
    const schema = api.components.schemas.HealthResponse;
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual([...schema.required].sort());
    for (const [key, value] of Object.entries(body)) {
      expect(typeof value).toBe(schema.properties[key].type);
      if (schema.properties[key].enum) expect(schema.properties[key].enum).toContain(value);
    }
    expect(body.environment).toBe("test");
  });

  it.each([
    ["zh_CN", "作业", ["课程", "错题", "作业", "我的"]],
    ["en_US", "Homework", ["Courses", "Review", "Homework", "Account"]],
    ["fr", "作业", ["课程", "错题", "作业", "我的"]],
  ])("微信 %s 同步页面、系统标题和底部导航，且不依赖浏览器 API", (language, title, tabs) => {
    const setData = vi.fn();
    const setNavigationBarTitle = vi.fn();
    const setTabBarItem = vi.fn();
    const wx = {
      getAppBaseInfo: () => ({ language }),
      setNavigationBarTitle,
      setTabBarItem,
    };
    const locale = loadModule("lib/locale.ts", {});
    const pageModule = loadModule("lib/placeholder-page.ts", { wx }, { "./locale": locale });
    const createPage = pageModule.createPlaceholderPage as (section: string) => {
      onShow: (this: { setData: typeof setData }) => void;
    };
    createPage("homework").onShow.call({ setData });
    expect(setData).toHaveBeenCalledWith(expect.objectContaining({ title }));
    expect(setNavigationBarTitle).toHaveBeenCalledWith({ title });
    expect(setTabBarItem.mock.calls.map(([item]) => item.text)).toEqual(tabs);
  });
});
