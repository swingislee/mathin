import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";
import {
  type OrganizationLocationFixture,
  setupOrganizationLocationFixture,
} from "./support/organization-location-fixture";

const FIXTURE_FLAG_REASON = "set R1_DEV_TEST_FIXTURES=1 and use the local organization-location runner";
let activeFixture: OrganizationLocationFixture | null = null;
type BrowserPage = Parameters<typeof loginWithFixedAccount>[0];

async function expectDashboardDividerSemantics(page: BrowserPage) {
  const header = page.locator("[data-dashboard-page-header]").first();
  await expect(header).toBeVisible();
  const headerBorders = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      top: Number.parseFloat(style.borderTopWidth),
      right: Number.parseFloat(style.borderRightWidth),
      bottom: Number.parseFloat(style.borderBottomWidth),
      left: Number.parseFloat(style.borderLeftWidth),
    };
  });
  expect(headerBorders.bottom).toBeGreaterThan(0);
  expect(headerBorders.top + headerBorders.right + headerBorders.left).toBe(0);

  const commandPanels = page.locator("[data-dashboard-command-panel]");
  for (let index = 0; index < await commandPanels.count(); index += 1) {
    const borders = await commandPanels.nth(index).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .map(Number.parseFloat);
    });
    expect(borders.reduce((sum, width) => sum + width, 0)).toBe(0);
  }
}

async function expectDashboardTablesUseSharedShell(page: BrowserPage) {
  const tables = page.locator("main table");
  for (let index = 0; index < await tables.count(); index += 1) {
    expect(await tables.nth(index).evaluate((table) => Boolean(table.closest("[data-dashboard-table-shell]")))).toBe(true);
  }
}

test.afterEach(async () => {
  if (!activeFixture) return;
  await activeFixture.cleanup();
  activeFixture = null;
});

async function addRoom(
  page: Parameters<typeof loginWithFixedAccount>[0],
  name: string,
  capacity: number,
) {
  await page.getByRole("button", { name: "新增教室", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增教室" });
  await dialog.getByLabel("教室名称", { exact: true }).fill(name);
  await dialog.getByLabel("容量（选填）", { exact: true }).fill(String(capacity));
  await expect(dialog.getByLabel("教室代码", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("教室已添加", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

async function addSession(
  page: Parameters<typeof loginWithFixedAccount>[0],
  title: string,
) {
  await page.getByRole("button", { name: "添加课次", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "添加自由课次" });
  await createDialog.getByLabel("课次名称", { exact: true }).fill(title);
  await createDialog.getByRole("button", { name: "添加课次", exact: true }).click();

  const closedDayDialog = page.getByRole("dialog", { name: "确认安排在停课日" });
  const success = page.getByText("课次已添加。", { exact: true }).last();
  await expect.poll(async () => {
    if (await closedDayDialog.isVisible()) return "closed";
    if (await success.isVisible()) return "created";
    return "waiting";
  }).not.toBe("waiting");

  if (await closedDayDialog.isVisible()) {
    await closedDayDialog.getByLabel("安排原因", { exact: true }).fill("本机隔离验收：验证停课日人工确认链路");
    await closedDayDialog.getByRole("button", { name: "确认并保存", exact: true }).click();
  }
  await expect(success).toBeVisible();
  await expect(page.locator("li").filter({ hasText: title }).first()).toBeVisible();
}

async function openSessionManager(
  page: Parameters<typeof loginWithFixedAccount>[0],
  title: string,
) {
  const row = page.locator("li").filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "快速管理", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: title }).first();
  await expect(sheet).toBeVisible();
  return sheet;
}

test("administrator completes the organization, room, class, calendar, and archive journey without codes", async ({ page }) => {
  test.setTimeout(300_000);
  const admin = loadFixedAccountForMode("admin");
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!admin || !teacher, FIXED_ACCOUNT_SKIP_REASON);
  test.skip(process.env.R1_DEV_TEST_FIXTURES !== "1", FIXTURE_FLAG_REASON);
  if (!admin || !teacher) return;

  const fixture = await setupOrganizationLocationFixture({ teacher });
  activeFixture = fixture;
  try {
    await loginWithFixedAccount(page, admin, "/zh/dashboard/organization");
    await expect(page.getByRole("heading", { name: "机构资料", exact: true })).toBeVisible();
    await expect(page.getByLabel("机构名称", { exact: true })).toBeVisible();
    await expect(page.getByLabel("IANA 时区", { exact: true })).toHaveValue(/^[A-Za-z_]+\/[A-Za-z_+-]+$/);
    await expect(page.getByText("中文是产品固定默认语言，不需要管理员配置。", { exact: true })).toBeVisible();
    await expect(page.getByLabel("默认语言", { exact: true })).toHaveCount(0);

    await page.goto("/zh/dashboard/campuses");
    await expect(page.getByRole("heading", { name: "校区与教室", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增校区", exact: true }).click();
    const campusDialog = page.getByRole("dialog", { name: "新增校区" });
    await campusDialog.getByLabel("校区名称", { exact: true }).fill(fixture.campusName);
    await campusDialog.getByLabel("地址（选填）", { exact: true }).fill(fixture.campusAddress);
    await expect(campusDialog.getByLabel("校区代码", { exact: true })).toHaveCount(0);
    await campusDialog.getByRole("button", { name: "创建", exact: true }).click();
    await page.waitForURL((url) => /^\/zh\/dashboard\/campuses\/[0-9a-f-]{36}$/.test(url.pathname), {
      waitUntil: "domcontentloaded",
    });
    const campusId = page.url().match(/\/dashboard\/campuses\/([0-9a-f-]{36})$/)?.[1];
    if (!campusId) throw new Error("Created campus URL did not contain a UUID");
    fixture.trackCampus(campusId);
    await expect(page.getByRole("heading", { name: fixture.campusName, exact: true })).toBeVisible();
    await expect(page.getByText(fixture.campusAddress, { exact: true })).toBeVisible();

    await addRoom(page, fixture.roomAName, 12);
    await addRoom(page, fixture.roomBName, 40);
    const rooms = await fixture.readRooms();
    const roomA = rooms.find((room) => room.name === fixture.roomAName);
    const roomB = rooms.find((room) => room.name === fixture.roomBName);
    if (!roomA || !roomB) throw new Error("Created room IDs were not found");
    await expect(page.getByText(roomA.code, { exact: true })).toHaveCount(0);
    await expect(page.getByText(roomB.code, { exact: true })).toHaveCount(0);

    await page.goto(`/en/dashboard/campuses/${campusId}`);
    await expect(page.getByRole("heading", { name: fixture.campusName, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /code/i })).toHaveCount(0);

    await page.goto("/zh/dashboard/classes/new");
    await page.getByRole("button", { name: "测试数据", exact: true }).click();
    await page.getByRole("button", { name: "自由建班", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("班级名", { exact: true }).fill(fixture.className);
    await page.locator("#primary-teacher").click();
    await page.getByRole("option", { name: fixture.teacherDisplayName, exact: true }).click();
    await page.getByLabel("容量", { exact: true }).fill("30");
    await page.locator("#class-room").click();
    await expect(page.getByText(fixture.campusName, { exact: true }).last()).toBeVisible();
    await page.getByRole("option").filter({ hasText: fixture.roomAName }).click();
    await expect(page.getByText("班级容量 30 超过教室容量 12。可继续保存，但排课时应人工确认。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.locator("#school-term").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByText(`${fixture.campusName} · ${fixture.roomAName}`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "创建班级", exact: true }).click();
    await page.waitForURL((url) => /^\/zh\/dashboard\/classes\/[0-9a-f-]{36}$/.test(url.pathname), {
      waitUntil: "domcontentloaded",
    });
    const classId = page.url().match(/\/dashboard\/classes\/([0-9a-f-]{36})$/)?.[1];
    if (!classId) throw new Error("Created classroom URL did not contain a UUID");
    fixture.trackClassroom(classId);
    const classHref = `/zh/dashboard/classes/${classId}?tab=sessions`;
    const classError = page.getByRole("heading", { name: "这里暂时出了点问题", exact: true });
    const addSessionButton = page.getByRole("button", { name: "添加课次", exact: true });
    await expect(addSessionButton.or(classError)).toBeVisible({ timeout: 15_000 });
    await expect(classError).toHaveCount(0);
    await expect(addSessionButton).toBeVisible();

    for (const sessionName of fixture.sessionNames) await addSession(page, sessionName);
    await expect.poll(async () => (await fixture.readClassroomState()).sessions.length).toBe(3);
    const initialState = await fixture.readClassroomState();
    expect(initialState.defaultRoomId).toBe(roomA.id);
    expect(initialState.sessions.every((session) => session.roomId === roomA.id && session.roomAssignmentOrigin === "class_default")).toBe(true);

    let sheet = await openSessionManager(page, fixture.sessionNames[0]);
    await sheet.locator("#edit-session-room").click();
    await page.getByRole("option").filter({ hasText: fixture.roomBName }).click();
    await sheet.getByRole("button", { name: "保存课次", exact: true }).click();
    await expect(page.getByText("课次已保存。", { exact: true }).last()).toBeVisible();
    const lifecycle = sheet.getByRole("heading", { name: "生命周期", exact: true }).locator("..");
    await lifecycle.getByPlaceholder("取消/作废原因（选填）").fill("本机隔离验收：保留已取消课次地点");
    await lifecycle.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByText("课次已取消。", { exact: true })).toBeVisible();

    await page.goto(classHref);
    sheet = await openSessionManager(page, fixture.sessionNames[2]);
    await sheet.locator("#edit-session-room").click();
    await page.getByRole("option", { name: "待定", exact: true }).click();
    await sheet.getByRole("button", { name: "保存课次", exact: true }).click();
    await expect(page.getByText("课次已保存。", { exact: true }).last()).toBeVisible();

    await page.goto(classHref);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settingsSheet = page.getByRole("dialog", { name: "设置" });
    await settingsSheet.getByRole("button", { name: "编辑班级", exact: true }).click();
    const classDialog = page.getByRole("dialog", { name: "编辑班级" });
    await classDialog.getByRole("combobox").last().click();
    await page.getByRole("option").filter({ hasText: fixture.roomBName }).click();
    await classDialog.getByRole("button", { name: "应用到未开课课次", exact: true }).click();
    const applyDialog = page.getByRole("alertdialog", { name: "应用班级默认教室" });
    await expect(applyDialog.getByText("将更新 1 节仍来源于班级默认且尚未开课的课次。显式覆盖和显式待定不会改变。", { exact: true })).toBeVisible();
    await applyDialog.getByRole("button", { name: "确认应用", exact: true }).click();
    await expect(page.getByText("班级默认教室已保存。", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const state = await fixture.readClassroomState();
      return {
        defaultRoomId: state.defaultRoomId,
        sessions: Object.fromEntries(state.sessions.map((session) => [session.title, {
          roomId: session.roomId,
          origin: session.roomAssignmentOrigin,
          cancelled: session.cancelled,
        }])),
      };
    }).toEqual({
      defaultRoomId: roomB.id,
      sessions: {
        [fixture.sessionNames[0]]: { roomId: roomB.id, origin: "session_override", cancelled: true },
        [fixture.sessionNames[1]]: { roomId: roomB.id, origin: "class_default", cancelled: false },
        [fixture.sessionNames[2]]: { roomId: null, origin: "session_override", cancelled: false },
      },
    });

    await page.goto("/zh/dashboard/academic-years");
    await expect(page.getByRole("heading", { name: "学年与教学日历", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "添加日期规则", exact: true }).click();
    const calendarDialog = page.getByRole("dialog", { name: "添加教学日期规则" });
    await expect(calendarDialog.getByText(/此范围已有 \d+ 节未来课次，涉及 \d+ 个班级；另有 \d+ 节历史、已开始或已取消课次只读保留。/)).toBeVisible();
    await calendarDialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: fixture.campusName, exact: true }).click();
    await expect(calendarDialog.getByText(/此范围已有 \d+ 节未来课次/)).toBeVisible();
    await calendarDialog.getByRole("button", { name: "取消", exact: true }).click();

    await expect(page.getByLabel("默认课次时长（分钟）", { exact: true })).toHaveValue("90");
    await expect(page.getByText("冲突策略", { exact: true })).toBeVisible();
    await expect(page.getByText("警告", { exact: true })).toBeVisible();

    await page.goto("/zh/dashboard/system-health/capabilities");
    await expect(page.getByRole("heading", { name: "能力发布", exact: true })).toBeVisible();
    const capabilitySelect = page.getByRole("combobox").first();
    await capabilitySelect.click();
    await page.getByRole("option", { name: "财务", exact: true }).click();
    await expect(page.getByText("财务发布门在 1.0 中只读关闭，不能创建或回滚版本。", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "旧业务规则历史", exact: true })).toBeVisible();

    await page.goto(`/zh/dashboard/campuses/${campusId}`);
    await page.getByRole("button", { name: "归档校区", exact: true }).click();
    const archiveDialog = page.getByRole("alertdialog", { name: "归档校区" });
    await expect(archiveDialog.getByText("将停用 2 间子教室，清空 1 个班级默认教室和 1 节未开课课次的地点。1 节历史课次保留原地点。重新启用后不会自动恢复。", { exact: true })).toBeVisible();
    await archiveDialog.getByRole("button", { name: "归档校区", exact: true }).click();
    await expect(page.getByText("校区已归档，未来课次地点已按确认结果清空", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const state = await fixture.readClassroomState();
      return {
        defaultRoomId: state.defaultRoomId,
        sessions: Object.fromEntries(state.sessions.map((session) => [session.title, {
          roomId: session.roomId,
          origin: session.roomAssignmentOrigin,
          cancelled: session.cancelled,
        }])),
      };
    }).toEqual({
      defaultRoomId: null,
      sessions: {
        [fixture.sessionNames[0]]: { roomId: roomB.id, origin: "session_override", cancelled: true },
        [fixture.sessionNames[1]]: { roomId: null, origin: "class_default", cancelled: false },
        [fixture.sessionNames[2]]: { roomId: null, origin: "session_override", cancelled: false },
      },
    });
    expect((await fixture.readRooms()).every((room) => room.status === "inactive")).toBe(true);

    await page.goto(classHref);
    await expect(page.getByText("待定", { exact: true }).first()).toBeVisible();
    const cancelledGroup = page.getByText("已取消（1）", { exact: true });
    await cancelledGroup.click();
    sheet = await openSessionManager(page, fixture.sessionNames[0]);
    await expect(sheet.getByText(`${fixture.campusName} · ${fixture.roomBName}`, { exact: true })).toBeVisible();

    await page.goto(classHref);
    sheet = await openSessionManager(page, fixture.sessionNames[1]);
    await expect(sheet.locator("#edit-session-room")).toContainText("待定");
  } finally {
    await fixture.cleanup();
    activeFixture = null;
  }
});

test("dashboard uses functional navigation, scalable class views, and ten-item asset pages", async ({ page }) => {
  test.setTimeout(180_000);
  const admin = loadFixedAccountForMode("admin");
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!admin || !teacher, FIXED_ACCOUNT_SKIP_REASON);
  if (!admin || !teacher) return;

  await loginWithFixedAccount(page, admin, "/zh/dashboard");
  const sidebar = page.getByRole("navigation", { name: "后台导航" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator("p")).toHaveText(["学科运营", "教学", "教研", "组织管理", "系统管理"]);
  await expect(sidebar.getByRole("link", { name: "学年", exact: true })).toHaveAttribute("href", "/zh/dashboard/academic-years");
  await expect(sidebar.getByRole("link", { name: "排课默认", exact: true })).toHaveCount(0);
  await expect(sidebar.locator('a[href*="organization-settings"], a[href*="schedule/calendar"], a[href*="schedule/defaults"]')).toHaveCount(0);

  const iconMarkup = await Promise.all(
    ["总览", "协同记录", "学年", "课表"].map((label) =>
      sidebar.getByRole("link", { name: label, exact: true }).locator("svg").evaluate((icon) => icon.innerHTML),
    ),
  );
  expect(new Set(iconMarkup).size).toBe(iconMarkup.length);

  await page.goto("/zh/dashboard/organization");
  await expect(page.getByRole("heading", { name: "机构资料", exact: true })).toBeVisible();
  await expectDashboardDividerSemantics(page);
  const profileForm = page.locator("[data-organization-profile-form]");
  await expect(profileForm).toBeVisible();
  const fieldDividerCount = await profileForm.locator("*").evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    const top = Number.parseFloat(style.borderTopWidth);
    const right = Number.parseFloat(style.borderRightWidth);
    const bottom = Number.parseFloat(style.borderBottomWidth);
    const left = Number.parseFloat(style.borderLeftWidth);
    return right + left === 0 && top + bottom > 0;
  }).length);
  expect(fieldDividerCount).toBe(0);

  await page.goto("/zh/dashboard/campuses");
  await expect(page.getByRole("heading", { name: "校区与教室", exact: true })).toBeVisible();
  await expectDashboardDividerSemantics(page);
  await expectDashboardTablesUseSharedShell(page);

  await page.goto("/zh/dashboard/students");
  await expect(page.getByRole("heading", { name: "学生", exact: true })).toBeVisible();
  await expectDashboardDividerSemantics(page);
  await expectDashboardTablesUseSharedShell(page);

  await page.goto("/zh/dashboard/academic-years");
  await expect(page.getByRole("heading", { name: "学年与教学日历", exact: true })).toBeVisible();
  await expect(page.getByLabel("默认课次时长（分钟）", { exact: true })).toHaveValue("90");
  await expectDashboardDividerSemantics(page);
  await expectDashboardTablesUseSharedShell(page);

  await page.goto("/zh/dashboard/classes?scope=all");
  await expect(page.getByRole("link", { name: "全部班级", exact: true })).toHaveAttribute("aria-current", "page");
  const allClassroomsTable = page.locator('[data-classroom-table="all"]');
  await expect(allClassroomsTable).toBeVisible();
  await expect(allClassroomsTable).toHaveClass(/rounded-2xl/);
  await expect(allClassroomsTable).toHaveClass(/border-line/);
  await expect(allClassroomsTable.locator("table")).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(0);
  await expectDashboardDividerSemantics(page);
  await expectDashboardTablesUseSharedShell(page);
  expect(await allClassroomsTable.locator("thead").evaluate((element) => Number.parseFloat(getComputedStyle(element).borderBottomWidth))).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zh/dashboard/classes?scope=all");
  const mobileTable = page.locator('[data-classroom-table="all"]');
  await expect(mobileTable).toBeVisible();
  const mobileBounds = await mobileTable.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect((mobileBounds?.x ?? 0) + (mobileBounds?.width ?? 0)).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.context().clearCookies();
  await loginWithFixedAccount(page, teacher, "/zh/dashboard/classes");
  await expect(page.getByRole("link", { name: "我任教的班级", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.locator("main article").count()).toBeGreaterThan(0);
  await expect(page.locator("main table")).toHaveCount(0);

  await page.context().clearCookies();
  await loginWithFixedAccount(page, admin, "/zh/dashboard/courseware-assets");
  await expect(page.getByRole("heading", { name: "课件资源库", exact: true })).toBeVisible();
  await expectDashboardDividerSemantics(page);
  await expectDashboardTablesUseSharedShell(page);
  const assetRows = page.locator("main tbody tr");
  expect(await assetRows.count()).toBeGreaterThan(0);
  expect(await assetRows.count()).toBeLessThanOrEqual(10);

  await page.goto("/en/dashboard/academic-years");
  await expect(page.getByRole("heading", { name: "Academic year & teaching calendar", exact: true })).toBeVisible();
  await expectDashboardDividerSemantics(page);
  await expectDashboardTablesUseSharedShell(page);
});
